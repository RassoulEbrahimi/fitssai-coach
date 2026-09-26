import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-06. Online recording is gated exactly like the V2 reads — a signed-in
  adult with a known age — and is online only. A submit is one explicit action
  with one new intent id; success (or a conflict, which means the cache was
  stale) refetches the account's entry queries and nothing else.
*/

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
}));

const writer = vi.hoisted(() => ({ writeNutritionV2Entry: vi.fn() }));

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));
vi.mock("@/lib/nutrition/v2/entryWriter", () => writer);

import {
  NutritionV2RecordingUnavailableError,
  useNutritionV2Recording,
} from "./useNutritionV2Recording";
import { NutritionEntryConflictError } from "@/lib/nutrition/v2/entryTransaction";
import { buildSkipRecording, type NutritionRecordingCommand } from "@/lib/nutrition/v2/recording";
import { queryKeys } from "@/lib/queryKeys";
import { addNutritionDays, nutritionDateAt } from "@shared/nutrition";
import { plannedMealEntry } from "@/test/nutritionV2Fixtures";

const today = () => nutritionDateAt(new Date());
const skipToday = (): NutritionRecordingCommand => ({
  kind: "save",
  current: null,
  desired: buildSkipRecording({ date: today(), slotId: "breakfast" }),
});

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useNutritionV2Recording(), { wrapper }) };
};

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
};

/** Seeds a query under `key` so its invalidation can be observed. */
const seedQuery = (client: QueryClient, key: readonly unknown[]) => client.setQueryData(key, ["seeded"]);
const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated ?? false;

beforeEach(() => {
  session.user = { uid: "alice", id: "alice" };
  session.profile = { status: "success", data: { id: "alice", age: 30 } };
  writer.writeNutritionV2Entry.mockReset();
  writer.writeNutritionV2Entry.mockImplementation(async (_uid: string, intent: { desired: unknown }) => ({
    outcome: "applied",
    entry: intent.desired,
  }));
});

afterEach(() => {
  // Restore jsdom's own navigator.onLine.
  delete (navigator as { onLine?: boolean }).onLine;
  vi.restoreAllMocks();
});

describe("availability", () => {
  it("is available for a signed-in adult who is online", () => {
    expect(mount().result.current.availability).toEqual({ status: "available" });
  });

  it.each([
    ["signed out", () => (session.user = null), "signedOut"],
    ["the profile is loading", () => (session.profile = { status: "pending", data: undefined }), "pending"],
    ["the profile read failed", () => (session.profile = { status: "error", data: undefined }), "error"],
    ["the age is missing", () => (session.profile = { status: "success", data: { id: "alice" } }), "ineligible"],
    ["the age is unusable", () => (session.profile = { status: "success", data: { id: "alice", age: "30" } }), "ineligible"],
    ["the person is 17", () => (session.profile = { status: "success", data: { id: "alice", age: 17 } }), "ineligible"],
  ])("is unavailable when %s, and a submit never starts a write", async (_label, arrange, reason) => {
    arrange();
    const { result } = mount();

    expect(result.current.availability).toEqual({ status: "unavailable", reason });
    await expect(result.current.submit(skipToday())).rejects.toMatchObject({ reason });
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
  });

  it("is unavailable offline, says so truthfully, and does not pretend to save", async () => {
    const { result } = mount();
    act(() => setOnline(false));

    expect(result.current.availability).toEqual({ status: "unavailable", reason: "offline" });
    await expect(result.current.submit(skipToday())).rejects.toBeInstanceOf(NutritionV2RecordingUnavailableError);
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();

    act(() => setOnline(true));
    expect(result.current.availability).toEqual({ status: "available" });
  });
});

describe("submit", () => {
  it("writes nothing on mount or render", () => {
    const { rerender } = mount();
    rerender();
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
  });

  it("writes with the authenticated uid and a fresh intent id per action", async () => {
    const { result } = mount();

    await act(() => result.current.submit(skipToday()));
    await act(() => result.current.submit(skipToday()));

    const calls = writer.writeNutritionV2Entry.mock.calls;
    expect(calls.map(([uid]) => uid)).toEqual(["alice", "alice"]);
    const [first, second] = calls.map(([, intent]) => intent);
    expect(first).toMatchObject({ op: "skip", expectedRevision: 0, entryId: `slot:${today()}:breakfast` });
    expect(first.intentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second.intentId).not.toBe(first.intentId);
  });

  it("refuses a future Berlin date before any write, and allows an earlier one", async () => {
    const { result } = mount();
    const tomorrow = addNutritionDays(today(), 1);

    await expect(
      result.current.submit({ kind: "save", current: null, desired: buildSkipRecording({ date: tomorrow, slotId: "lunch" }) })
    ).rejects.toMatchObject({ reason: "futureDate" });
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();

    // No lower bound is invented: the writer may take an earlier date.
    const earlier = addNutritionDays(today(), -30);
    await act(() =>
      result.current.submit({ kind: "save", current: null, desired: buildSkipRecording({ date: earlier, slotId: "lunch" }) })
    );
    expect(writer.writeNutritionV2Entry).toHaveBeenCalledTimes(1);
  });

  it("names the revision the person saw when removing", async () => {
    const { result } = mount();
    const current = { ...plannedMealEntry(today(), "lunch"), revision: 3 };

    await act(() => result.current.submit({ kind: "remove", current }));
    expect(writer.writeNutritionV2Entry.mock.calls[0][1]).toMatchObject({ op: "remove", expectedRevision: 3, entryId: current.entryId });
  });
});

describe("cache convergence", () => {
  const seedAll = (client: QueryClient) => {
    const keys = {
      byDate: queryKeys.nutrition.entries.byDate("alice", today()),
      range: queryKeys.nutrition.entries.range("alice", "2026-09-23", "2026-09-29"),
      state: queryKeys.nutrition.state("alice"),
      plan: queryKeys.nutrition.plans.byId("alice", "plan-1"),
      slots: queryKeys.nutrition.slots.byPlan("alice", "plan-1"),
      bobEntries: queryKeys.nutrition.entries.byDate("bob", today()),
      legacy: queryKeys.nutritionLegacy.latest("alice"),
      trainingPlans: queryKeys.plans.byUser("alice"),
      trainingLogs: queryKeys.logs.byPlan("plan-1", "alice"),
    };
    for (const key of Object.values(keys)) seedQuery(client, key);
    return keys;
  };

  it("after a write, invalidates only this account's V2 entry queries", async () => {
    const { client, result } = mount();
    const keys = seedAll(client);

    await act(() => result.current.submit(skipToday()));

    expect(invalidated(client, keys.byDate)).toBe(true);
    expect(invalidated(client, keys.range)).toBe(true);
    for (const key of [keys.state, keys.plan, keys.slots, keys.bobEntries, keys.legacy, keys.trainingPlans, keys.trainingLogs]) {
      expect(invalidated(client, key), JSON.stringify(key)).toBe(false);
    }
  });

  it("after a conflict, refetches the entries too and surfaces the typed conflict", async () => {
    const conflict = new NutritionEntryConflictError({
      reason: "staleRevision",
      entryId: `slot:${today()}:breakfast`,
      expectedRevision: 0,
      currentRevision: 2,
      current: null,
    });
    writer.writeNutritionV2Entry.mockRejectedValueOnce(conflict);
    const { client, result } = mount();
    const keys = seedAll(client);

    await act(async () => {
      await expect(result.current.submit(skipToday())).rejects.toBe(conflict);
    });

    expect(invalidated(client, keys.byDate)).toBe(true);
    expect(invalidated(client, keys.legacy)).toBe(false);
    // The conflict is not retried with a newer revision.
    expect(writer.writeNutritionV2Entry).toHaveBeenCalledTimes(1);
  });

  it("after any other failure, invalidates nothing and does not retry", async () => {
    writer.writeNutritionV2Entry.mockRejectedValueOnce(new Error("unavailable"));
    const { client, result } = mount();
    const keys = seedAll(client);

    await act(async () => {
      await expect(result.current.submit(skipToday())).rejects.toThrow("unavailable");
    });

    expect(invalidated(client, keys.byDate)).toBe(false);
    expect(writer.writeNutritionV2Entry).toHaveBeenCalledTimes(1);
  });
});
