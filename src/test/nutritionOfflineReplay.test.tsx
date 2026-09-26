import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-07. Offline convergence of Nutrition V2 recorded entries through the
  EXISTING queue: the real queue, replay loop, handler registry and the NUT-06
  transaction writer and planner, against the in-memory Firestore boundary.
  Only account identity, the profile and toasts are fixtures.

  The writer is wrapped in a spy that calls the real one, so "replay uses the
  same writer" is observed rather than assumed.
*/

const identity = vi.hoisted(() => ({ currentUser: { uid: "A" } as { uid: string } | null }));
const session = vi.hoisted(() => ({ profile: { status: "success", data: { id: "A", age: 30 } } as { status: string; data: unknown } }));
vi.mock("@/lib/firebase", () => ({ auth: identity, db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: identity.currentUser }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));
vi.mock("firebase/firestore", async () => (await import("@/test/mocks/workoutFirestore")).firestore);
vi.mock("@/lib/telemetryClient", () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock("@/lib/toastWithIcon", () => ({ toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn() }));
vi.mock("@/lib/nutrition/v2/entryWriter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nutrition/v2/entryWriter")>();
  return { writeNutritionV2Entry: vi.fn(actual.writeNutritionV2Entry) };
});

import {
  CLAIM_LEASE_MS,
  OFFLINE_ENTRY_REPLAYED_EVENT,
  QueueStorageError,
  claimEntry,
  enqueue,
  loadQueue,
  removeQuarantinedEntries,
  type OfflineMutationEntry,
} from "@/lib/offlineQueue";
import { flushOfflineQueue } from "@/lib/offlineReplay";
import { handlers } from "@/lib/offlineHandlers";
import { queryKeys } from "@/lib/queryKeys";
import { writeNutritionV2Entry } from "@/lib/nutrition/v2/entryWriter";
import { nutritionHandoffFor, resetNutritionHandoffForTests } from "@/lib/nutrition/v2/entryHandoff";
import {
  groupNutritionConflicts,
  projectNutritionEntries,
  readOwnerNutritionQueue,
} from "@/lib/nutrition/v2/nutritionWriteIntents";
import { buildCustomSlotRecording, buildSkipRecording } from "@/lib/nutrition/v2/recording";
import { useNutritionV2Recording } from "@/hooks/queries/useNutritionV2Recording";
import {
  NUTRITION_SCHEMA_VERSION,
  NUTRITION_V2_COLLECTIONS,
  slotEntryId,
  slotHeadId,
  type NutritionEntryIntent,
  type RecordedEntry,
  type RecordedEntrySnapshot,
} from "@shared/nutrition";
import { firestore, resetWorkoutFirestore, rows, writes } from "@/test/mocks/workoutFirestore";
import { intentUuid } from "@/test/nutritionV2Fixtures";

const DATE = "2026-09-26";
const LUNCH = slotEntryId(DATE, "lunch");
const DINNER = slotEntryId(DATE, "dinner");
const STORAGE = "FITSSAI_OFFLINE_QUEUE";
const DAY = { planId: "p", weekKey: "Week 1", dayIndex: 0, workoutDay: "2026-09-07", completed: true };

const entryPath = (entryId: string, uid = "A") => `users/${uid}/${NUTRITION_V2_COLLECTIONS.entries}/${entryId}`;
const server = (entryId: string, uid = "A") => rows.get(entryPath(entryId, uid)) as RecordedEntry | undefined;
const entryWrites = () => writes.filter((write) => write.path.includes(`/${NUTRITION_V2_COLLECTIONS.entries}/`));
const realRunTransaction = firestore.runTransaction.getMockImplementation()!;

/** The planned meal as it was shown when recorded: a snapshot, never looked up again. */
const mealA: RecordedEntrySnapshot = {
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  entryId: LUNCH,
  kind: "slot",
  date: DATE,
  slotId: "lunch",
  recording: "plannedMeal",
  planId: "plan-1",
  name: "Meal A",
  estimateBasis: "planMealTimesPortion",
  portion: 1,
  nutritionEstimate: { kcal: 700, proteinG: 40, carbsG: 80, fatG: 20 },
};
const pizza = (kcal = 900, slotId: "lunch" | "dinner" = "lunch") =>
  buildCustomSlotRecording({ date: DATE, slotId, name: "Pizza", estimate: { kcal } });

const recordIntent = (n: number, desired: RecordedEntrySnapshot = mealA, expectedRevision = 0): NutritionEntryIntent => ({
  intentId: intentUuid(n),
  entryId: desired.entryId,
  expectedRevision,
  op: desired.recording === "skip" ? "skip" : "record",
  desired,
});
const correctIntent = (n: number, expectedRevision: number, desired: RecordedEntrySnapshot = pizza()): NutritionEntryIntent => ({
  intentId: intentUuid(n),
  entryId: desired.entryId,
  expectedRevision,
  op: "correct",
  desired,
});
const removeIntent = (n: number, expectedRevision: number, entryId = LUNCH): NutritionEntryIntent => ({
  intentId: intentUuid(n),
  entryId,
  expectedRevision,
  op: "remove",
});

const queueIntent = (intent: NutritionEntryIntent, dependsOn?: string, uid = "A") =>
  enqueue("NUTRITION_ENTRY_WRITE", { intent, date: DATE }, uid, { dependsOn }).entry;

const flush = (invalidate = vi.fn()) => flushOfflineQueue("A", invalidate);
const byEntry = (entryId: string) => loadQueue().find((entry) => (entry.payload as { intent?: NutritionEntryIntent }).intent?.entryId === entryId);
const breakQueueCleanup = () => {
  const originalSet = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    if (key === STORAGE && value === "[]") throw new Error("Crash before cleanup");
    return originalSet.call(this, key, value);
  });
};
const unavailable = () => Object.assign(new Error("Failed to get document because the client is offline."), { code: "unavailable" });

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  resetNutritionHandoffForTests();
  localStorage.clear();
  identity.currentUser = { uid: "A" };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { onLine?: boolean }).onLine;
});

describe("queue contract", () => {
  it("keeps the exact intent and its owner through storage and replays it with the NUT-06 writer", async () => {
    const intent = recordIntent(1);
    const queued = queueIntent(intent);
    const stored = JSON.parse(localStorage.getItem(STORAGE)!) as OfflineMutationEntry[];
    expect(stored[0]).toMatchObject({ id: queued.id, ownerUid: "A", type: "NUTRITION_ENTRY_WRITE", payload: { intent, date: DATE } });
    expect(queued.id).not.toBe(intent.intentId);

    const invalidate = vi.fn();
    expect(await flush(invalidate)).toMatchObject({ completed: 1, failed: 0, quarantined: 0 });

    expect(writeNutritionV2Entry).toHaveBeenCalledTimes(1);
    expect(writeNutritionV2Entry).toHaveBeenCalledWith("A", intent);
    expect(server(LUNCH)).toMatchObject({ revision: 1, status: "active", name: "Meal A", appliedIntentIds: [intent.intentId] });
    expect(loadQueue()).toEqual([]);
    // Only this account's entry family.
    expect(invalidate.mock.calls).toEqual([[[queryKeys.nutrition.entries.all("A")]]]);
  });

  it("registers the handler next to the unchanged Training handlers", () => {
    expect(Object.keys(handlers).sort()).toEqual(
      ["NUTRITION_ENTRY_WRITE", "TOGGLE_DAY", "TOGGLE_DAY_COMPLETION", "TOGGLE_SET", "UPDATE_SET_PERFORMANCE"].sort()
    );
  });
});

describe("idempotent convergence", () => {
  it("§15: an online write that landed without an answer is queued as the same intent and replays as alreadyApplied", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useNutritionV2Recording(), { wrapper });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DATE}T10:00:00Z`));
    // The transaction commits, then the answer is lost.
    firestore.runTransaction.mockImplementationOnce(async (db, callback) => {
      await realRunTransaction(db, callback);
      throw unavailable();
    });

    let outcome: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      outcome = await result.current.submit({ kind: "save", current: null, desired: mealA });
    });
    vi.useRealTimers();

    expect(outcome).toMatchObject({ status: "queued" });
    const written = (writeNutritionV2Entry as ReturnType<typeof vi.fn>).mock.calls[0][1] as NutritionEntryIntent;
    expect(loadQueue()).toHaveLength(1);
    expect((loadQueue()[0].payload as { intent: NutritionEntryIntent }).intent).toEqual(written);
    expect(server(LUNCH)).toMatchObject({ revision: 1, appliedIntentIds: [written.intentId] });

    expect(await flush()).toMatchObject({ completed: 1, quarantined: 0 });
    expect(loadQueue()).toEqual([]);
    expect(server(LUNCH)).toMatchObject({ revision: 1, appliedIntentIds: [written.intentId] });
    expect(entryWrites()).toHaveLength(1);
  });

  it("§27: a replay interrupted before queue cleanup runs again as alreadyApplied, exactly once on the server", async () => {
    const intent = recordIntent(1);
    queueIntent(intent);
    const storage = breakQueueCleanup();

    const first = await flush();
    expect(first.completed).toBe(0);
    expect(first.storageError).toBeInstanceOf(QueueStorageError);
    expect(server(LUNCH)).toMatchObject({ revision: 1 });
    expect(loadQueue()[0].status).toBe("syncing");
    storage.mockRestore();

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + CLAIM_LEASE_MS);
    expect(await flush()).toMatchObject({ completed: 1, quarantined: 0 });
    expect(writeNutritionV2Entry).toHaveBeenCalledTimes(2);
    expect(server(LUNCH)).toMatchObject({ revision: 1, appliedIntentIds: [intent.intentId] });
    expect(entryWrites()).toHaveLength(1);
    expect(loadQueue()).toEqual([]);
  });
});

describe("chained offline edits", () => {
  it("§28: record → correct → remove from revision 0 projects a tombstone and replays revisions 1, 2, 3", async () => {
    const record = queueIntent(recordIntent(1));
    const correct = queueIntent(correctIntent(2, 1), record.id);
    queueIntent(removeIntent(3, 2), correct.id);

    const { entries } = projectNutritionEntries({ committed: [], queued: readOwnerNutritionQueue(loadQueue(), "A").active });
    expect(entries.find((entry) => entry.entryId === LUNCH)).toMatchObject({ status: "removed", revision: 3 });

    expect(await flush()).toMatchObject({ completed: 3, quarantined: 0 });
    expect(entryWrites().map((write) => [write.data.revision, write.data.status])).toEqual([
      [1, "active"],
      [2, "active"],
      [3, "removed"],
    ]);
    expect(server(LUNCH)).toEqual(entries.find((entry) => entry.entryId === LUNCH));
    expect(loadQueue()).toEqual([]);
  });
});

describe("the frozen snapshot rule", () => {
  it("§29: a recording of planned Meal A replays as Meal A after another device replaced the slot with Meal B", async () => {
    queueIntent(recordIntent(1, mealA));
    // Meanwhile, another device replaces the planned meal.
    const headPath = `users/A/${NUTRITION_V2_COLLECTIONS.slots}/${slotHeadId("plan-1", DATE, "lunch")}`;
    const head = {
      schemaVersion: NUTRITION_SCHEMA_VERSION,
      planId: "plan-1",
      date: DATE,
      slotId: "lunch",
      selection: { kind: "override", override: { source: "aiSuggestion", meal: { name: "Meal B", values: { kcal: 500, proteinG: 1, carbsG: 1, fatG: 1 } } } },
    };
    rows.set(headPath, head);

    expect(await flush()).toMatchObject({ completed: 1 });
    expect(server(LUNCH)).toMatchObject({ name: "Meal A", recording: "plannedMeal", nutritionEstimate: { kcal: 700 } });
    // Planned stays planned: the head is untouched, and only the entry was written.
    expect(rows.get(headPath)).toEqual(head);
    expect(writes.map((write) => write.path)).toEqual([entryPath(LUNCH)]);
  });
});

describe("terminal conflicts", () => {
  const seedActive = (revision: number, n = 90) =>
    rows.set(entryPath(LUNCH), {
      ...pizza(500),
      revision,
      status: "active",
      appliedIntentIds: Array.from({ length: revision }, (_, i) => intentUuid(n + i)),
    });

  it("§30: a stale intent from another device's past is quarantined, not retried, and the server copy shows", async () => {
    seedActive(1);
    const stale = queueIntent(correctIntent(1, 1, pizza(800)));
    // Device B commits first.
    await writeNutritionV2Entry("A", correctIntent(2, 1, pizza(650)));
    expect(server(LUNCH)).toMatchObject({ revision: 2 });
    writes.length = 0;

    const invalidate = vi.fn();
    const result = await flush(invalidate);

    expect(result).toMatchObject({ completed: 0, failed: 0, quarantined: 1 });
    const kept = loadQueue();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      id: stale.id,
      status: "quarantined",
      attempts: 0,
      rejection: { code: "staleRevision", details: { entryId: LUNCH, expectedRevision: 1, currentRevision: 2 } },
    });
    for (const field of ["claimId", "claimedAt", "leaseUntil", "nextAttemptAt"]) expect(kept[0]).not.toHaveProperty(field, expect.anything());
    expect(writes).toEqual([]);
    expect(server(LUNCH)).toMatchObject({ revision: 2, nutritionEstimate: { kcal: 650 } });
    expect(invalidate.mock.calls).toEqual([[[queryKeys.nutrition.entries.all("A")]]]);

    // No longer projected; shown as a conflict instead.
    const queue = readOwnerNutritionQueue(kept, "A");
    const { entries } = projectNutritionEntries({ committed: [server(LUNCH)!], queued: queue.active });
    expect(entries[0]).toMatchObject({ revision: 2, nutritionEstimate: { kcal: 650 } });
    expect(groupNutritionConflicts(queue.rejected)).toEqual([
      { entryId: LUNCH, date: DATE, queueEntryIds: [stale.id], intent: correctIntent(1, 1, pizza(800)) },
    ]);

    // Nothing retries it.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * CLAIM_LEASE_MS);
    expect(await flush()).toMatchObject({ completed: 0, quarantined: 0 });
    expect(writeNutritionV2Entry).toHaveBeenCalledTimes(2);
  });

  it("§26: a conflict and what depends on it are quarantined while unrelated work replays in the same run", async () => {
    seedActive(2);
    // Offline on revision 1 (stale), then a remove predicted at revision 2 on
    // top of it - which the server's own revision 2 would silently accept.
    const conflicting = queueIntent(correctIntent(1, 1));
    const dependent = queueIntent(removeIntent(2, 2), conflicting.id);
    queueIntent(recordIntent(3, pizza(400, "dinner")));
    enqueue("TOGGLE_DAY", DAY, "A");

    const result = await flush();

    expect(result).toMatchObject({ completed: 2, failed: 0, quarantined: 2 });
    expect(server(LUNCH)).toMatchObject({ revision: 2, status: "active" });
    expect(server(DINNER)).toMatchObject({ revision: 1, name: "Pizza" });
    expect([...rows.keys()].some((path) => path.includes("workout_logs"))).toBe(true);
    expect(loadQueue().map((entry) => [entry.id, entry.status, entry.rejection?.code])).toEqual([
      [conflicting.id, "quarantined", "staleRevision"],
      [dependent.id, "quarantined", "dependencyRejected"],
    ]);
    expect(writeNutritionV2Entry).toHaveBeenCalledTimes(2);
  });

  it("quarantines a same-entry intent that conflicts on its own when reached, and continues", async () => {
    seedActive(1);
    queueIntent(recordIntent(1, buildSkipRecording({ date: DATE, slotId: "lunch" })));
    queueIntent(recordIntent(2, pizza(300, "dinner")));

    expect(await flush()).toMatchObject({ completed: 1, quarantined: 1 });
    expect(byEntry(LUNCH)?.rejection?.code).toBe("staleRevision");
    expect(server(DINNER)).toMatchObject({ revision: 1 });
  });

  it("quarantines an intent that depends on an entry quarantined earlier, without writing", async () => {
    seedActive(2);
    const conflicting = queueIntent(correctIntent(1, 1));
    await flush();
    const late = queueIntent(removeIntent(2, 2), conflicting.id);

    expect(await flush()).toMatchObject({ completed: 0, quarantined: 1 });
    expect(loadQueue().find((entry) => entry.id === late.id)).toMatchObject({ status: "quarantined", rejection: { code: "dependencyRejected" } });
    expect(server(LUNCH)).toMatchObject({ revision: 2, status: "active" });
  });

  it("quarantines a malformed persisted payload without touching Firestore, and continues", async () => {
    const valid = queueIntent(recordIntent(1));
    const broken = { ...valid, id: "broken", payload: { intent: { ...recordIntent(2), expectedRevision: -1 }, date: DATE } };
    const wrongDate = { ...valid, id: "wrong-date", payload: { intent: recordIntent(3, pizza(1, "dinner")), date: "2026-09-25" } };
    localStorage.setItem(STORAGE, JSON.stringify([broken, wrongDate, valid]));

    expect(await flush()).toMatchObject({ completed: 1, quarantined: 2 });
    expect(loadQueue().map((entry) => [entry.id, entry.rejection?.code])).toEqual([
      ["broken", "invalidPayload"],
      ["wrong-date", "invalidPayload"],
    ]);
    expect(writeNutritionV2Entry).toHaveBeenCalledTimes(1);
    expect(server(DINNER)).toBeUndefined();
  });
});

describe("transient failures keep the existing retry", () => {
  it("fails with backoff, holds later entries, and succeeds later with the same intent", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const intent = recordIntent(1);
    queueIntent(intent);
    enqueue("TOGGLE_DAY", DAY, "A");
    firestore.runTransaction.mockRejectedValueOnce(unavailable());

    expect(await flush()).toMatchObject({ completed: 0, failed: 1, quarantined: 0 });
    const failed = loadQueue()[0];
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });
    expect(failed.nextAttemptAt! - now).toBe(1000);
    expect(failed.claimId).toBeUndefined();
    expect(failed.rejection).toBeUndefined();
    expect(rows.size).toBe(0);

    // Still backing off: nothing overtakes it.
    expect(await flush()).toMatchObject({ completed: 0 });
    now = failed.nextAttemptAt!;
    expect(await flush()).toMatchObject({ completed: 2 });
    expect(server(LUNCH)).toMatchObject({ appliedIntentIds: [intent.intentId] });
  });

  it("a Training entry that fails is retried and never quarantined, and Nutrition behind it waits", async () => {
    enqueue("TOGGLE_DAY", DAY, "A");
    queueIntent(recordIntent(1));
    firestore.getDocs.mockRejectedValueOnce(new Error("Failed to fetch"));
    firestore.runTransaction.mockRejectedValueOnce(new Error("Failed to fetch"));

    expect(await flush()).toMatchObject({ completed: 0, failed: 1, quarantined: 0 });
    expect(loadQueue().map((entry) => entry.status)).toEqual(["failed", "pending"]);
    expect(writeNutritionV2Entry).not.toHaveBeenCalled();
  });
});

describe("account safety and replay mechanics", () => {
  it("never replays, projects or dismisses another account's Nutrition intents", async () => {
    const bobs = queueIntent(recordIntent(1), undefined, "A");
    localStorage.setItem(STORAGE, JSON.stringify([{ ...bobs, ownerUid: "B" }]));

    expect(await flush()).toMatchObject({ completed: 0 });
    expect(writeNutritionV2Entry).not.toHaveBeenCalled();
    expect(readOwnerNutritionQueue(loadQueue(), "A")).toEqual({ active: [], rejected: [] });

    localStorage.setItem(STORAGE, JSON.stringify([{ ...bobs, ownerUid: "B", status: "quarantined" }]));
    expect(removeQuarantinedEntries([bobs.id], "A")).toBe(0);
    expect(loadQueue()).toHaveLength(1);
  });

  it("stops when the account changes mid-write and converges when the owner returns", async () => {
    const intent = recordIntent(1);
    queueIntent(intent);
    firestore.runTransaction.mockImplementationOnce(async (db, callback) => {
      const committed = await realRunTransaction(db, callback);
      identity.currentUser = { uid: "B" };
      return committed;
    });

    expect(await flush()).toMatchObject({ completed: 0, failed: 0, quarantined: 0 });
    expect(loadQueue()[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(await flushOfflineQueue("B", vi.fn())).toMatchObject({ completed: 0 });

    identity.currentUser = { uid: "A" };
    expect(await flush()).toMatchObject({ completed: 1 });
    expect(server(LUNCH)).toMatchObject({ revision: 1, appliedIntentIds: [intent.intentId] });
    expect(entryWrites()).toHaveLength(1);
  });

  it("leaves a rejection for the owner when the account changes as it arrives", async () => {
    rows.set(entryPath(LUNCH), { ...pizza(500), revision: 2, status: "active", appliedIntentIds: [intentUuid(90), intentUuid(91)] });
    queueIntent(correctIntent(1, 1));
    firestore.runTransaction.mockImplementationOnce(async (db, callback) => {
      identity.currentUser = { uid: "B" };
      return realRunTransaction(db, callback);
    });

    await expect(flush()).resolves.toMatchObject({ completed: 0, failed: 0, quarantined: 0 });
    expect(loadQueue()[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(loadQueue()[0].rejection).toBeUndefined();

    identity.currentUser = { uid: "A" };
    expect(await flush()).toMatchObject({ quarantined: 1 });
    expect(loadQueue()[0]).toMatchObject({ status: "quarantined", rejection: { code: "staleRevision" } });
  });

  it("keeps the lost-lease behaviour: no cleanup, no failure, and a later replay converges", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    queueIntent(recordIntent(1));
    firestore.runTransaction.mockImplementationOnce(async (db, callback) => {
      const committed = await realRunTransaction(db, callback);
      now += CLAIM_LEASE_MS;
      return committed;
    });

    expect(await flush()).toMatchObject({ completed: 0, failed: 0, quarantined: 0 });
    expect(loadQueue()[0]).toMatchObject({ status: "syncing", attempts: 0 });
    now += 1;
    expect(await flush()).toMatchObject({ completed: 1 });
    expect(entryWrites()).toHaveLength(1);
  });

  it("keeps the storage-error behaviour: a claim that cannot be stored does no remote work", async () => {
    queueIntent(recordIntent(1));
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    expect((await flush()).storageError).toBeInstanceOf(QueueStorageError);
    storage.mockRestore();
    expect(writeNutritionV2Entry).not.toHaveBeenCalled();
    expect(loadQueue()[0].status).toBe("pending");
  });

  it("does not replay an entry claimed by another live worker", async () => {
    const queued = queueIntent(recordIntent(1));
    claimEntry(queued.id, "A");
    expect(await flush()).toMatchObject({ completed: 0 });
    expect(writeNutritionV2Entry).not.toHaveBeenCalled();
  });

  it("hands the replayed intent off before the refetch starts", async () => {
    const intent = recordIntent(1);
    queueIntent(intent);
    const order: string[] = [];
    const onReplayed = () => order.push(`replayed:${nutritionHandoffFor("A").length}`);
    window.addEventListener(OFFLINE_ENTRY_REPLAYED_EVENT, onReplayed);
    try {
      await flush(vi.fn(() => order.push(`invalidate:${nutritionHandoffFor("A").length}`)));
    } finally {
      window.removeEventListener(OFFLINE_ENTRY_REPLAYED_EVENT, onReplayed);
    }
    expect(order).toEqual(["replayed:1", "invalidate:1"]);
    expect(nutritionHandoffFor("A")).toEqual([{ ownerUid: "A", intent, date: DATE }]);
    expect(nutritionHandoffFor("B")).toEqual([]);
  });
});
