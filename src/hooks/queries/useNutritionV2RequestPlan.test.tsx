import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-11. Requesting a generated plan is gated like every V2 action — a
  signed-in adult with a known age — and is online only, with no offline
  queue. One explicit action is one request with a new request id, carrying
  `{ requestId }` and nothing else. Nothing is written to the cache before the
  server answers; an answer refetches the state and the generation reads, and
  a succeeded one also the plans and slot heads. There is no cancel.
*/

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
}));

const callable = vi.hoisted(() => ({ callNutritionRequestPlan: vi.fn() }));

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));
vi.mock("@/lib/nutrition/v2/generationCallable", () => callable);

import { NutritionV2RequestPlanUnavailableError, useNutritionV2RequestPlan } from "./useNutritionV2RequestPlan";
import { queryKeys } from "@/lib/queryKeys";

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ANSWER = { ok: true, requestId: "00000000-0000-4000-8000-000000000011", status: "running", resultPlanId: null, errorCode: null, replay: false };

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useNutritionV2RequestPlan(), { wrapper }) };
};

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
};

const seed = (client: QueryClient, key: readonly unknown[]) => client.setQueryData(key, ["seeded"]);
const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated ?? false;

const ACCOUNT_KEYS = {
  state: queryKeys.nutrition.state("alice"),
  activeGeneration: queryKeys.nutrition.generation.byId("alice", "00000000-0000-4000-8000-000000000011"),
  plan: queryKeys.nutrition.plans.byId("alice", "plan-1"),
  planForDate: queryKeys.nutrition.plans.forDate("alice", "2026-09-28", "plan-1"),
  slots: queryKeys.nutrition.slots.byPlan("alice", "plan-1"),
};
const NEVER_TOUCHED = [
  queryKeys.nutrition.entries.byDate("alice", "2026-09-28"),
  queryKeys.nutrition.entries.range("alice", "2026-09-23", "2026-09-29"),
  queryKeys.nutrition.targets.byId("alice", "target-1"),
  queryKeys.nutrition.suggestions("alice", "plan-1", "2026-09-28", "lunch"),
  queryKeys.nutritionLegacy.latest("alice"),
  queryKeys.profile.me("alice"),
  queryKeys.nutrition.state("bob"),
  queryKeys.nutrition.generation.byId("bob", "00000000-0000-4000-8000-000000000011"),
  queryKeys.nutrition.plans.byId("bob", "plan-1"),
  ["workout-plans", "alice"],
  ["workout-logs", "alice"],
];

beforeEach(() => {
  session.user = { uid: "alice", id: "alice" };
  session.profile = { status: "success", data: { id: "alice", age: 30 } };
  callable.callNutritionRequestPlan.mockReset();
  callable.callNutritionRequestPlan.mockResolvedValue(ANSWER);
});

afterEach(() => {
  delete (navigator as { onLine?: boolean }).onLine;
  // TanStack Query follows these events; leave it online for the next test.
  window.dispatchEvent(new Event("online"));
});

describe("requesting a plan", () => {
  it("sends exactly a new lower-case request id, once per action", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.submit();
      await result.current.submit();
    });

    const calls = callable.callNutritionRequestPlan.mock.calls.map(([request]) => request);
    expect(calls).toHaveLength(2);
    expect(calls.map((request) => Object.keys(request))).toEqual([["requestId"], ["requestId"]]);
    expect(calls.every((request) => LOWER_UUID.test(request.requestId))).toBe(true);
    expect(calls[0].requestId).not.toBe(calls[1].requestId);
    expect(JSON.stringify(calls)).not.toMatch(/alice|plan-|target|kind|initial|regenerate|provider|prompt/);
  });

  it("answers what the server answered", async () => {
    const { result } = mount();
    let answer: unknown;
    await act(async () => {
      answer = await result.current.submit();
    });
    expect(answer).toEqual(ANSWER);
  });

  it.each([
    ["signed out", () => (session.user = null), "signedOut"],
    ["the profile is loading", () => (session.profile = { status: "pending", data: undefined }), "pending"],
    ["the profile read failed", () => (session.profile = { status: "error", data: undefined }), "error"],
    ["the age is missing", () => (session.profile = { status: "success", data: { id: "alice" } }), "ineligible"],
    ["the person is 17", () => (session.profile = { status: "success", data: { id: "alice", age: 17 } }), "ineligible"],
  ])("refuses when %s and calls nothing", async (_label, arrange, reason) => {
    arrange();
    const { result } = mount();
    expect(result.current.availability).toEqual({ status: "unavailable", reason });
    await expect(result.current.submit()).rejects.toBeInstanceOf(NutritionV2RequestPlanUnavailableError);
    expect(callable.callNutritionRequestPlan).not.toHaveBeenCalled();
  });

  it("is online only: offline it refuses, and nothing is queued or sent", async () => {
    setOnline(false);
    const { result } = mount();
    expect(result.current.online).toBe(false);
    await expect(result.current.submit()).rejects.toMatchObject({ reason: "offline" });
    expect(callable.callNutritionRequestPlan).not.toHaveBeenCalled();
    expect(localStorage.getItem("FITSSAI_OFFLINE_QUEUE")).toBeNull();
  });

  it.each([
    ["running", ANSWER],
    ["failed", { ...ANSWER, status: "failed", errorCode: "PROVIDER_FAILED" }],
    ["discarded", { ...ANSWER, status: "discarded_stale", errorCode: "STALE_ACTIVE_PLAN" }],
  ])("a %s answer refetches the account's state and generation reads only", async (_label, answer) => {
    callable.callNutritionRequestPlan.mockResolvedValue(answer);
    const { client, result } = mount();
    for (const key of [...Object.values(ACCOUNT_KEYS), ...NEVER_TOUCHED]) seed(client, key);

    await act(async () => {
      await result.current.submit();
    });

    expect(invalidated(client, ACCOUNT_KEYS.state)).toBe(true);
    expect(invalidated(client, ACCOUNT_KEYS.activeGeneration)).toBe(true);
    for (const key of [ACCOUNT_KEYS.plan, ACCOUNT_KEYS.planForDate, ACCOUNT_KEYS.slots, ...NEVER_TOUCHED]) {
      expect(invalidated(client, key), JSON.stringify(key)).toBe(false);
    }
  });

  it("a succeeded answer also refetches the plans and slot heads — never entries, targets, legacy or Training", async () => {
    callable.callNutritionRequestPlan.mockResolvedValue({ ...ANSWER, status: "succeeded", resultPlanId: "plan-2" });
    const { client, result } = mount();
    for (const key of [...Object.values(ACCOUNT_KEYS), ...NEVER_TOUCHED]) seed(client, key);

    await act(async () => {
      await result.current.submit();
    });

    for (const key of Object.values(ACCOUNT_KEYS)) expect(invalidated(client, key), JSON.stringify(key)).toBe(true);
    for (const key of NEVER_TOUCHED) expect(invalidated(client, key), JSON.stringify(key)).toBe(false);
  });

  it("writes nothing to the cache itself: no optimistic plan, state or request", async () => {
    let release: (value: unknown) => void = () => undefined;
    callable.callNutritionRequestPlan.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { client, result } = mount();

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.submit();
    });
    expect(client.getQueryCache().getAll()).toEqual([]);
    await act(async () => {
      release({ ...ANSWER, status: "succeeded", resultPlanId: "plan-2" });
      await pending;
    });
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it("invalidates nothing when the server refuses (the production answer)", async () => {
    const refusal = Object.assign(new Error("GENERATION_PROVIDER_NOT_CONFIGURED"), { code: "GENERATION_PROVIDER_NOT_CONFIGURED" });
    callable.callNutritionRequestPlan.mockRejectedValue(refusal);
    const { client, result } = mount();
    seed(client, ACCOUNT_KEYS.state);

    await act(async () => {
      await expect(result.current.submit()).rejects.toBe(refusal);
    });
    expect(invalidated(client, ACCOUNT_KEYS.state)).toBe(false);
  });

  it("calls nothing on mount or render, and offers no cancel", () => {
    const { result, rerender } = mount();
    rerender();
    expect(callable.callNutritionRequestPlan).not.toHaveBeenCalled();
    expect(Object.keys(result.current).sort()).toEqual(["availability", "isSubmitting", "online", "submit"]);
  });
});
