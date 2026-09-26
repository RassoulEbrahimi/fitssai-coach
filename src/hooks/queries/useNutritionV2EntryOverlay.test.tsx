import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-07. The read-side overlay: strict committed read → this account's
  queued and handed-off intents. It follows the signed-in account at once,
  and a replayed intent stays visible until a server read shows it — never
  the sequence "optimistic → gone (stale cache) → back after the refetch".
  Replay here is the real queue, replay loop and NUT-06 writer against the
  in-memory Firestore boundary.
*/

const session = vi.hoisted(() => ({
  user: { uid: "alice" } as { uid: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
}));
vi.mock("@/lib/firebase", () => ({
  db: {},
  auth: {
    get currentUser() {
      return session.user;
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));
vi.mock("firebase/firestore", async () => (await import("@/test/mocks/workoutFirestore")).firestore);

import { useNutritionV2EntryOverlay } from "./useNutritionV2EntryOverlay";
import { enqueue, loadQueue, updateEntry } from "@/lib/offlineQueue";
import { flushOfflineQueue } from "@/lib/offlineReplay";
import { nutritionHandoffFor, resetNutritionHandoffForTests } from "@/lib/nutrition/v2/entryHandoff";
import { buildCustomSlotRecording } from "@/lib/nutrition/v2/recording";
import type { NutritionV2Read } from "@/lib/nutrition/v2/readStatus";
import { NUTRITION_V2_COLLECTIONS, slotEntryId, type NutritionEntryIntent, type RecordedEntry } from "@shared/nutrition";
import { firestore, resetWorkoutFirestore, rows, writes } from "@/test/mocks/workoutFirestore";
import { intentUuid, removedEntry } from "@/test/nutritionV2Fixtures";

const DATE = "2026-09-26";
const LUNCH = slotEntryId(DATE, "lunch");
const pizza = buildCustomSlotRecording({ date: DATE, slotId: "lunch", name: "Pizza", estimate: { kcal: 900 } });
const record: NutritionEntryIntent = { intentId: intentUuid(1), entryId: LUNCH, expectedRevision: 0, op: "record", desired: pizza };

const success = (data: RecordedEntry[]): NutritionV2Read<RecordedEntry[]> => ({ status: "success", data });

const mount = (initial: NutritionV2Read<RecordedEntry[]>) => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const seen: (string | null)[] = [];
  const view = renderHook(
    ({ committed }: { committed: NutritionV2Read<RecordedEntry[]> }) => {
      const overlay = useNutritionV2EntryOverlay(committed, DATE, DATE);
      const lunch = overlay.entries.status === "success" ? overlay.entries.data.find((entry) => entry.entryId === LUNCH) : undefined;
      seen.push(lunch ? `${lunch.status}@${lunch.revision}` : null);
      return overlay;
    },
    { initialProps: { committed: initial }, wrapper }
  );
  return { ...view, seen };
};

beforeEach(() => {
  localStorage.clear();
  resetWorkoutFirestore();
  resetNutritionHandoffForTests();
  session.user = { uid: "alice" };
  session.profile = { status: "success", data: { id: "alice", age: 30 } };
});
afterEach(() => vi.clearAllMocks());

describe("the entry overlay", () => {
  it("projects this account's queued change over the committed read, and reading writes nothing", () => {
    enqueue("NUTRITION_ENTRY_WRITE", { intent: record, date: DATE }, "alice");
    const before = localStorage.getItem("FITSSAI_OFFLINE_QUEUE");
    const { result } = mount(success([]));

    expect(result.current.entries).toMatchObject({ status: "success", data: [{ entryId: LUNCH, status: "active", revision: 1 }] });
    expect(result.current.pending.get(LUNCH)).toMatchObject({ status: "pending", count: 1 });
    expect(localStorage.getItem("FITSSAI_OFFLINE_QUEUE")).toBe(before);
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it("passes a committed read that is not loaded through unchanged", () => {
    enqueue("NUTRITION_ENTRY_WRITE", { intent: record, date: DATE }, "alice");
    const pending: NutritionV2Read<RecordedEntry[]> = { status: "pending" };
    const { result } = mount(pending);
    expect(result.current.entries).toBe(pending);
  });

  it("hides the other account's changes the moment the account switches", () => {
    enqueue("NUTRITION_ENTRY_WRITE", { intent: record, date: DATE }, "alice");
    const rejected = enqueue("NUTRITION_ENTRY_WRITE", { intent: { ...record, intentId: intentUuid(2) }, date: DATE }, "alice").entry;
    updateEntry(rejected.id, { status: "quarantined" });
    const { result, rerender } = mount(success([]));
    expect(result.current.conflicts).toHaveLength(1);

    session.user = { uid: "bob" };
    session.profile = { status: "success", data: { id: "bob", age: 30 } };
    rerender({ committed: success([]) });

    expect(result.current.entries).toEqual(success([]));
    expect(result.current.pending.size).toBe(0);
    expect(result.current.conflicts).toEqual([]);
  });

  it("keeps a replayed change visible until a server read shows it, then lets the server read take over", async () => {
    enqueue("NUTRITION_ENTRY_WRITE", { intent: record, date: DATE }, "alice");
    const stale = success([]);
    const { result, rerender, seen } = mount(stale);

    // Replay succeeds; the cached read is still the stale one.
    await act(async () => {
      expect(await flushOfflineQueue("alice", () => undefined)).toMatchObject({ completed: 1 });
    });
    rerender({ committed: stale });
    expect(loadQueue()).toEqual([]);
    expect(result.current.pending.size).toBe(0);
    expect(nutritionHandoffFor("alice")).toHaveLength(1);

    // The refetch arrives with the server's copy.
    const fresh = rows.get(`users/alice/${NUTRITION_V2_COLLECTIONS.entries}/${LUNCH}`) as RecordedEntry;
    rerender({ committed: success([fresh]) });
    expect(nutritionHandoffFor("alice")).toEqual([]);

    // Never absent in between: optimistic, handed off, then the server's.
    expect(seen.every((state) => state === "active@1")).toBe(true);
    expect(writes).toHaveLength(1);

    // Settled: a later read that another device changed is shown as read.
    rerender({ committed: success([removedEntry(fresh)]) });
    expect(result.current.entries).toMatchObject({ data: [{ status: "removed", revision: 2 }] });
  });
});
