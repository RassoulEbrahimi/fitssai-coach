import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-09. Repeating a plan is gated like every V2 action — a signed-in adult
  with a known age — and is online only. One explicit action is one request
  with a new request id, carrying `{ requestId }` and nothing else. A success
  refetches the account's state, plans and slot heads and nothing else.
*/

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
}));

const callable = vi.hoisted(() => ({ callNutritionRepeatPlan: vi.fn() }));

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));
vi.mock("@/lib/nutrition/v2/planCallable", () => callable);

import { NutritionV2RepeatPlanUnavailableError, useNutritionV2RepeatPlan } from "./useNutritionV2RepeatPlan";
import { queryKeys } from "@/lib/queryKeys";

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useNutritionV2RepeatPlan(), { wrapper }) };
};

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
};

const seed = (client: QueryClient, key: readonly unknown[]) => client.setQueryData(key, ["seeded"]);
const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated ?? false;

beforeEach(() => {
  session.user = { uid: "alice", id: "alice" };
  session.profile = { status: "success", data: { id: "alice", age: 30 } };
  callable.callNutritionRepeatPlan.mockReset();
  callable.callNutritionRepeatPlan.mockResolvedValue({ ok: true, planId: "plan-2", replay: false });
});

afterEach(() => {
  delete (navigator as { onLine?: boolean }).onLine;
  // TanStack Query follows these events; leave it online for the next test.
  window.dispatchEvent(new Event("online"));
});

describe("repeating a plan", () => {
  it("sends exactly a new lower-case request id, once per action", async () => {
    const { result } = mount();

    await act(async () => {
      await result.current.submit();
      await result.current.submit();
    });

    const calls = callable.callNutritionRepeatPlan.mock.calls.map(([request]) => request);
    expect(calls).toHaveLength(2);
    expect(calls.map((request) => Object.keys(request))).toEqual([["requestId"], ["requestId"]]);
    expect(calls.every((request) => LOWER_UUID.test(request.requestId))).toBe(true);
    expect(calls[0].requestId).not.toBe(calls[1].requestId);
    expect(JSON.stringify(calls)).not.toMatch(/alice|plan-|target|date/);
  });

  it("answers what the server answered", async () => {
    const { result } = mount();
    let answer: unknown;
    await act(async () => {
      answer = await result.current.submit();
    });
    expect(answer).toEqual({ ok: true, planId: "plan-2", replay: false });
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
    await expect(result.current.submit()).rejects.toBeInstanceOf(NutritionV2RepeatPlanUnavailableError);
    expect(callable.callNutritionRepeatPlan).not.toHaveBeenCalled();
  });

  it("is online only: offline it refuses, and nothing is queued or sent", async () => {
    setOnline(false);
    const { result } = mount();

    expect(result.current.online).toBe(false);
    await expect(result.current.submit()).rejects.toMatchObject({ reason: "offline" });
    expect(callable.callNutritionRepeatPlan).not.toHaveBeenCalled();
    expect(localStorage.getItem("FITSSAI_OFFLINE_QUEUE")).toBeNull();
  });

  it("refetches the account's state, plans and slot heads, and nothing else", async () => {
    const { client, result } = mount();
    const touched = [
      queryKeys.nutrition.state("alice"),
      queryKeys.nutrition.plans.byId("alice", "plan-1"),
      queryKeys.nutrition.plans.active("alice"),
      queryKeys.nutrition.slots.byPlan("alice", "plan-1"),
    ];
    const untouched = [
      queryKeys.nutrition.entries.byDate("alice", "2026-09-26"),
      queryKeys.nutrition.entries.range("alice", "2026-09-23", "2026-09-29"),
      queryKeys.nutrition.targets.byId("alice", "target-1"),
      queryKeys.nutritionLegacy.latest("alice"),
      queryKeys.profile.me("alice"),
      queryKeys.nutrition.state("bob"),
      queryKeys.nutrition.plans.byId("bob", "plan-1"),
      queryKeys.nutrition.slots.byPlan("bob", "plan-1"),
      ["workout-plans", "alice"],
      ["workout-logs", "alice"],
    ];
    for (const key of [...untouched, ...touched]) seed(client, key);

    await act(async () => {
      await result.current.submit();
    });

    for (const key of touched) expect(invalidated(client, key), JSON.stringify(key)).toBe(true);
    for (const key of untouched) expect(invalidated(client, key), JSON.stringify(key)).toBe(false);
  });

  it("invalidates nothing when the server refuses", async () => {
    const refusal = Object.assign(new Error("PLAN_VALIDATION_POLICY_NOT_CONFIGURED"), {
      code: "PLAN_VALIDATION_POLICY_NOT_CONFIGURED",
    });
    callable.callNutritionRepeatPlan.mockRejectedValue(refusal);
    const { client, result } = mount();
    seed(client, queryKeys.nutrition.state("alice"));
    seed(client, queryKeys.nutrition.plans.byId("alice", "plan-1"));

    await act(async () => {
      await expect(result.current.submit()).rejects.toBe(refusal);
    });
    expect(invalidated(client, queryKeys.nutrition.state("alice"))).toBe(false);
    expect(invalidated(client, queryKeys.nutrition.plans.byId("alice", "plan-1"))).toBe(false);
  });

  it("calls nothing on mount or render", () => {
    const { rerender } = mount();
    rerender();
    expect(callable.callNutritionRepeatPlan).not.toHaveBeenCalled();
  });
});

describe("the slot-head account prefix", () => {
  it("is the prefix of every byPlan key of the account, and of no other account's", () => {
    const all = queryKeys.nutrition.slots.all("alice");
    const byPlan = queryKeys.nutrition.slots.byPlan("alice", "plan-1");
    expect(byPlan.slice(0, all.length)).toEqual([...all]);
    expect(byPlan).toEqual(["nutrition-v2", "alice", "slots", "plan-1"]);
    expect(queryKeys.nutrition.slots.byPlan("bob", "plan-1").slice(0, all.length)).not.toEqual([...all]);
  });
});
