import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-08. Setting a target is gated like every V2 action — a signed-in adult
  with a known age — and is online only. One explicit action is one request
  with a new request id, carrying `{ mode, requestId }` and nothing else. A
  success refetches the account's state and targets and nothing else.
  Freshness is derived from the cached profile and writes nothing.
*/

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
}));

const callable = vi.hoisted(() => ({ callNutritionSetTarget: vi.fn() }));

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));
vi.mock("@/lib/nutrition/v2/targetCallable", () => callable);

import {
  NutritionV2TargetUnavailableError,
  useNutritionV2TargetFreshness,
  useNutritionV2TargetMutation,
} from "./useNutritionV2Target";
import { queryKeys } from "@/lib/queryKeys";
import { computeNutritionTargetFingerprint, parseNutritionProfile, type TargetVersion } from "@shared/nutrition";
import { webSha256Hex } from "@/lib/nutrition/v2/sha256";
import { makeTarget } from "@/test/nutritionV2Fixtures";

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const mountMutation = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useNutritionV2TargetMutation(), { wrapper }) };
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
  callable.callNutritionSetTarget.mockReset();
  callable.callNutritionSetTarget.mockResolvedValue({ ok: true, targetVersionId: "tv-new", replay: false });
});

afterEach(() => {
  delete (navigator as { onLine?: boolean }).onLine;
  // TanStack Query follows these events; leave it online for the next test.
  window.dispatchEvent(new Event("online"));
});

describe("setting a target", () => {
  it("sends exactly the mode and a new lower-case request id, once per action", async () => {
    const { result } = mountMutation();

    await act(async () => {
      await result.current.submit("calculated");
      await result.current.submit("manual");
    });

    const calls = callable.callNutritionSetTarget.mock.calls.map(([request]) => request);
    expect(calls).toHaveLength(2);
    expect(calls.map((request) => Object.keys(request).sort())).toEqual([
      ["mode", "requestId"],
      ["mode", "requestId"],
    ]);
    expect(calls.map((request) => request.mode)).toEqual(["calculated", "manual"]);
    expect(calls.every((request) => LOWER_UUID.test(request.requestId))).toBe(true);
    expect(calls[0].requestId).not.toBe(calls[1].requestId);
    // No uid and no profile value ever leaves with it.
    expect(JSON.stringify(calls)).not.toMatch(/alice|"age"|weight|height/);
  });

  it.each([
    ["signed out", () => (session.user = null), "signedOut"],
    ["the profile is loading", () => (session.profile = { status: "pending", data: undefined }), "pending"],
    ["the profile read failed", () => (session.profile = { status: "error", data: undefined }), "error"],
    ["the age is missing", () => (session.profile = { status: "success", data: { id: "alice" } }), "ineligible"],
    ["the person is 17", () => (session.profile = { status: "success", data: { id: "alice", age: 17 } }), "ineligible"],
  ])("refuses when %s and calls nothing", async (_label, arrange, reason) => {
    arrange();
    const { result } = mountMutation();

    expect(result.current.availability).toEqual({ status: "unavailable", reason });
    await expect(result.current.submit("calculated")).rejects.toBeInstanceOf(NutritionV2TargetUnavailableError);
    expect(callable.callNutritionSetTarget).not.toHaveBeenCalled();
  });

  it("is online only: offline it refuses and nothing is queued or sent", async () => {
    setOnline(false);
    const { result } = mountMutation();

    expect(result.current.online).toBe(false);
    await expect(result.current.submit("manual")).rejects.toMatchObject({ reason: "offline" });
    expect(callable.callNutritionSetTarget).not.toHaveBeenCalled();
    expect(localStorage.getItem("FITSSAI_OFFLINE_QUEUE")).toBeNull();
  });

  it("refetches the state and the targets, and nothing else", async () => {
    const { client, result } = mountMutation();
    const untouched = [
      queryKeys.nutrition.entries.byDate("alice", "2026-09-26"),
      queryKeys.nutrition.plans.byId("alice", "plan-1"),
      queryKeys.nutrition.slots.byPlan("alice", "plan-1"),
      queryKeys.nutritionLegacy.latest("alice"),
      queryKeys.profile.me("alice"),
      queryKeys.nutrition.state("bob"),
      ["workout-plan", "alice"],
      ["workout-logs", "alice"],
    ];
    const touched = [queryKeys.nutrition.state("alice"), queryKeys.nutrition.targets.byId("alice", "tv-1")];
    for (const key of [...untouched, ...touched]) seed(client, key);

    await act(async () => {
      await result.current.submit("calculated");
    });

    for (const key of touched) expect(invalidated(client, key), JSON.stringify(key)).toBe(true);
    for (const key of untouched) expect(invalidated(client, key), JSON.stringify(key)).toBe(false);
  });

  it("invalidates nothing when the server refuses", async () => {
    const refusal = Object.assign(new Error("TARGET_POLICY_NOT_CONFIGURED"), { code: "TARGET_POLICY_NOT_CONFIGURED" });
    callable.callNutritionSetTarget.mockRejectedValue(refusal);
    const { client, result } = mountMutation();
    seed(client, queryKeys.nutrition.state("alice"));

    await act(async () => {
      await expect(result.current.submit("calculated")).rejects.toBe(refusal);
    });
    expect(invalidated(client, queryKeys.nutrition.state("alice"))).toBe(false);
  });

  it("calls nothing on mount or render", () => {
    const { rerender } = mountMutation();
    rerender();
    expect(callable.callNutritionSetTarget).not.toHaveBeenCalled();
  });
});

describe("freshness", () => {
  const PROFILE_DATA = {
    id: "alice",
    age: 30,
    height: 172.5,
    weight: 68.25,
    biological_sex: "female",
    activity_level: "moderatelyActive",
    fitness_goal: "loseFat",
    dietary_preference: "vegan",
  };
  const FIELDS = ["activityLevel", "biologicalSex", "fitnessGoal", "height", "weight"] as const;

  const targetFor = async (data: Record<string, unknown>): Promise<TargetVersion> => {
    const profile = parseNutritionProfile({
      height: data.height,
      weight: data.weight,
      biologicalSex: data.biological_sex,
      activityLevel: data.activity_level,
      fitnessGoal: data.fitness_goal,
    });
    const values = Object.fromEntries(
      FIELDS.map((field) => [field, (profile[field] as { value?: unknown }).value])
    );
    const policy = { id: "test-fixture-calculated", version: 1 };
    return makeTarget("tv-1", {
      mode: "calculated",
      policy,
      profileFingerprint: await computeNutritionTargetFingerprint(
        { mode: "calculated", policy, fields: FIELDS, values },
        webSha256Hex
      ),
    });
  };

  const mountFreshness = (target: TargetVersion | null) =>
    renderHook(({ current }) => useNutritionV2TargetFreshness(current), { initialProps: { current: target } });

  it("is fresh for an unchanged profile", async () => {
    session.profile = { status: "success", data: PROFILE_DATA };
    const { result } = mountFreshness(await targetFor(PROFILE_DATA));

    expect(result.current).toEqual({ status: "checking" });
    await waitFor(() => expect(result.current).toEqual({ status: "fresh" }));
  });

  it("is stale after a relevant profile change", async () => {
    const target = await targetFor(PROFILE_DATA);
    session.profile = { status: "success", data: { ...PROFILE_DATA, weight: 72 } };
    const { result } = mountFreshness(target);
    await waitFor(() => expect(result.current).toEqual({ status: "stale" }));
  });

  it("stays fresh after an irrelevant profile change", async () => {
    const target = await targetFor(PROFILE_DATA);
    session.profile = { status: "success", data: { ...PROFILE_DATA, dietary_preference: "keto", age: 45 } };
    const { result } = mountFreshness(target);
    await waitFor(() => expect(result.current).toEqual({ status: "fresh" }));
  });

  it("cannot compare when a required answer is gone, and never claims fresh", async () => {
    const target = await targetFor(PROFILE_DATA);
    session.profile = { status: "success", data: { ...PROFILE_DATA, height: null, activity_level: "sehr aktiv" } };
    const { result } = mountFreshness(target);
    await waitFor(() =>
      expect(result.current).toEqual({
        status: "cannotCompare",
        missingFields: ["height"],
        invalidFields: ["activityLevel"],
        unknownFields: [],
      })
    );
  });

  it("follows a profile change without writing anything", async () => {
    const target = await targetFor(PROFILE_DATA);
    session.profile = { status: "success", data: PROFILE_DATA };
    const { result, rerender } = mountFreshness(target);
    await waitFor(() => expect(result.current.status).toBe("fresh"));

    session.profile = { status: "success", data: { ...PROFILE_DATA, height: 180 } };
    rerender({ current: target });
    await waitFor(() => expect(result.current.status).toBe("stale"));
    expect(callable.callNutritionSetTarget).not.toHaveBeenCalled();
  });

  it("says nothing while the profile is loading or there is no target", () => {
    session.profile = { status: "pending", data: undefined };
    expect(mountFreshness(makeTarget()).result.current).toEqual({ status: "checking" });
    session.profile = { status: "success", data: PROFILE_DATA };
    expect(mountFreshness(null).result.current).toEqual({ status: "checking" });
  });
});
