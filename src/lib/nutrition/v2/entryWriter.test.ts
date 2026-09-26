import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  NUT-06. The online entry writer runs the shared planner inside one Firestore
  transaction. Firestore is an in-memory double: `runTransaction` buffers
  writes and commits them only when the callback resolves, and can be told to
  make the first attempt lose a contention race, as the real SDK retries.
  Rules-level refusals are proven against the emulator in rules-tests/.
*/

const store = vi.hoisted(() => ({
  docs: new Map<string, unknown>(),
  /** Attempts to fail with contention before one is allowed to commit. */
  contention: 0,
  attempts: [] as { intentIds: string[] }[],
  sets: [] as string[],
  deletes: [] as string[],
}));

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/"), id: segments[segments.length - 1] })),
  runTransaction: vi.fn(async (_db: unknown, update: (transaction: unknown) => Promise<unknown>) => {
    for (;;) {
      const writes = new Map<string, unknown>();
      const attempt = { intentIds: [] as string[] };
      store.attempts.push(attempt);
      const transaction = {
        get: vi.fn(async (ref: { path: string; id: string }) => {
          const data = store.docs.get(ref.path);
          return { id: ref.id, exists: () => data !== undefined, data: () => structuredClone(data) };
        }),
        set: vi.fn((ref: { path: string }, data: { appliedIntentIds: string[] }) => {
          attempt.intentIds.push(data.appliedIntentIds[data.appliedIntentIds.length - 1]);
          writes.set(ref.path, structuredClone(data));
        }),
        update: vi.fn(() => {
          throw new Error("the writer never patches");
        }),
        delete: vi.fn((ref: { path: string }) => store.deletes.push(ref.path)),
      };
      const result = await update(transaction);
      if (store.contention > 0) {
        // Another client committed first: this attempt's writes are dropped and
        // the callback runs again, as Firestore does.
        store.contention -= 1;
        continue;
      }
      for (const [path, data] of writes) {
        store.sets.push(path);
        store.docs.set(path, data);
      }
      return result;
    }
  }),
}));

vi.mock("firebase/firestore", () => firestore);
vi.mock("@/lib/firebase", () => ({ db: { fixture: "db" } }));

import { writeNutritionV2Entry } from "./entryWriter";
import { NutritionEntryConflictError, isNutritionEntryConflictError } from "./entryTransaction";
import { NutritionV2IntegrityError } from "./integrity";
import { buildNutritionEntryIntent } from "./recording";
import {
  NUTRITION_V2_COLLECTIONS,
  type NutritionEntryIntent,
  type RecordedEntry,
  type RecordedEntrySnapshot,
} from "@shared/nutrition";
import { customSlotEntry, extraEntry, intentUuid, plannedMealEntry, values } from "@/test/nutritionV2Fixtures";

const DATE = "2026-09-26";
const pathOf = (uid: string, entryId: string) => `users/${uid}/${NUTRITION_V2_COLLECTIONS.entries}/${entryId}`;
const stored = (uid: string, entryId: string) => store.docs.get(pathOf(uid, entryId)) as RecordedEntry | undefined;

const snapshotOf = (entry: RecordedEntry): RecordedEntrySnapshot => {
  const { revision: _r, status: _s, appliedIntentIds: _a, ...snapshot } = entry;
  return snapshot as RecordedEntrySnapshot;
};

const lunch = snapshotOf(plannedMealEntry(DATE, "lunch", values(700.2, 40, 80, 20)));
const halfLunch = { ...lunch, portion: 0.5, nutritionEstimate: values(350.1, 20, 40, 10) } as RecordedEntrySnapshot;

const save = (current: RecordedEntry | null, desired: RecordedEntrySnapshot, intentId: string, uid = "alice") =>
  writeNutritionV2Entry(uid, buildNutritionEntryIntent({ kind: "save", current, desired }, intentId));

const remove = (current: RecordedEntry, intentId: string, uid = "alice") =>
  writeNutritionV2Entry(uid, buildNutritionEntryIntent({ kind: "remove", current }, intentId));

beforeEach(() => {
  store.docs.clear();
  store.contention = 0;
  store.attempts = [];
  store.sets = [];
  store.deletes = [];
  vi.clearAllMocks();
});

describe("writeNutritionV2Entry", () => {
  it("creates an entry online at revision 1 in the account's entries collection only", async () => {
    const result = await save(null, lunch, intentUuid(1));

    const expected = { ...lunch, revision: 1, status: "active", appliedIntentIds: [intentUuid(1)] };
    expect(result).toEqual({ outcome: "applied", entry: expected });
    expect(stored("alice", lunch.entryId)).toEqual(expected);
    expect(store.sets).toEqual([pathOf("alice", lunch.entryId)]);
    expect(firestore.doc).toHaveBeenCalledWith({ fixture: "db" }, "users", "alice", "nutrition_v2_entries", lunch.entryId);
  });

  it("corrects with the current revision", async () => {
    const created = (await save(null, lunch, intentUuid(1))).entry as RecordedEntry;
    const result = await save(created, halfLunch, intentUuid(2));

    expect(result).toMatchObject({ outcome: "applied", entry: { revision: 2, portion: 0.5 } });
    expect(stored("alice", lunch.entryId)).toMatchObject({ revision: 2, appliedIntentIds: [intentUuid(1), intentUuid(2)] });
  });

  it("rejects a stale revision with a typed conflict and writes nothing", async () => {
    const created = (await save(null, lunch, intentUuid(1))).entry as RecordedEntry;
    await save(created, halfLunch, intentUuid(2));
    store.sets = [];

    const error = await save(created, snapshotOf(customSlotEntry(DATE, "lunch")), intentUuid(3)).catch((e) => e);

    expect(isNutritionEntryConflictError(error)).toBe(true);
    expect(error).toBeInstanceOf(NutritionEntryConflictError);
    expect(error).toMatchObject({
      reason: "staleRevision",
      entryId: lunch.entryId,
      expectedRevision: 1,
      currentRevision: 2,
      current: stored("alice", lunch.entryId),
    });
    expect(store.sets).toEqual([]);
    // Not retried against the newer revision.
    expect(store.attempts).toHaveLength(3);
  });

  it("rejects a manual record or skip intent against an active entry with a typed conflict, and sets nothing", async () => {
    const created = (await save(null, lunch, intentUuid(1))).entry as RecordedEntry;
    store.sets = [];
    store.attempts = [];

    const skip = { ...lunch, recording: "skip", estimateBasis: "none", nutritionEstimate: null } as Record<string, unknown>;
    delete skip.planId;
    delete skip.name;
    delete skip.portion;
    const manual = [
      { intentId: intentUuid(2), entryId: lunch.entryId, expectedRevision: 1, op: "record", desired: halfLunch },
      { intentId: intentUuid(3), entryId: lunch.entryId, expectedRevision: 1, op: "skip", desired: skip },
    ] as NutritionEntryIntent[];

    for (const intent of manual) {
      const error = await writeNutritionV2Entry("alice", intent).catch((e) => e);
      expect(error).toBeInstanceOf(NutritionEntryConflictError);
      expect(error).toMatchObject({ reason: "alreadyActive", expectedRevision: 1, currentRevision: 1, current: created });
    }

    // Each transaction ran once and called transaction.set in neither.
    expect(store.attempts.map((attempt) => attempt.intentIds)).toEqual([[], []]);
    expect(store.sets).toEqual([]);
    expect(stored("alice", lunch.entryId)).toEqual(created);
  });

  it("succeeds for a duplicate intent without a second revision bump", async () => {
    const intent = buildNutritionEntryIntent({ kind: "save", current: null, desired: lunch }, intentUuid(1));
    await writeNutritionV2Entry("alice", intent);
    store.sets = [];

    const again = await writeNutritionV2Entry("alice", intent);

    expect(again).toEqual({ outcome: "alreadyApplied", entry: stored("alice", lunch.entryId) });
    expect(stored("alice", lunch.entryId)?.revision).toBe(1);
    expect(store.sets).toEqual([]);
  });

  it("keeps one intent id through a transaction retry, and applies it once", async () => {
    store.contention = 1;
    const result = await save(null, lunch, intentUuid(1));

    expect(store.attempts.map((attempt) => attempt.intentIds)).toEqual([[intentUuid(1)], [intentUuid(1)]]);
    expect(result).toMatchObject({ outcome: "applied", entry: { revision: 1, appliedIntentIds: [intentUuid(1)] } });
    expect(store.sets).toHaveLength(1);
  });

  it("removes by writing a tombstone, never a delete", async () => {
    const created = (await save(null, lunch, intentUuid(1))).entry as RecordedEntry;
    const result = await remove(created, intentUuid(2));

    const tombstone = { ...created, status: "removed", revision: 2, appliedIntentIds: [intentUuid(1), intentUuid(2)] };
    expect(result).toEqual({ outcome: "applied", entry: tombstone });
    expect(stored("alice", lunch.entryId)).toEqual(tombstone);
    expect(store.deletes).toEqual([]);
  });

  it("treats a second remove as a no-op", async () => {
    const created = (await save(null, lunch, intentUuid(1))).entry as RecordedEntry;
    const removed = (await remove(created, intentUuid(2))).entry as RecordedEntry;
    store.sets = [];

    expect(await remove(removed, intentUuid(3))).toEqual({ outcome: "noop", entry: removed });
    expect(await remove(created, intentUuid(4))).toEqual({ outcome: "noop", entry: removed });
    expect(store.sets).toEqual([]);
    expect(store.deletes).toEqual([]);
  });

  it("records a removed slot again under the same id", async () => {
    const created = (await save(null, lunch, intentUuid(1))).entry as RecordedEntry;
    const removed = (await remove(created, intentUuid(2))).entry as RecordedEntry;

    const result = await save(removed, snapshotOf(customSlotEntry(DATE, "lunch")), intentUuid(3));
    expect(result).toMatchObject({ outcome: "applied", entry: { recording: "custom", status: "active", revision: 3 } });
    expect([...store.docs.keys()]).toEqual([pathOf("alice", lunch.entryId)]);
  });

  it("addresses an extra entry by its UUID id — no auto id", async () => {
    const extra = snapshotOf(extraEntry(DATE));
    await save(null, extra, intentUuid(1));
    expect(stored("alice", extra.entryId)).toMatchObject({ entryId: extra.entryId, kind: "extra" });
  });

  it("writes only under the account it is given: another account cannot reach alice's entry", async () => {
    const created = (await save(null, lunch, intentUuid(1))).entry as RecordedEntry;

    // Bob's writer addresses bob's own path; alice's entry is untouched.
    const bobResult = await remove(created, intentUuid(2), "bob");
    expect(bobResult).toEqual({ outcome: "noop", entry: null });
    expect(stored("alice", lunch.entryId)).toEqual(created);
    await expect(writeNutritionV2Entry("", buildNutritionEntryIntent({ kind: "save", current: null, desired: lunch }, intentUuid(5)))).rejects.toThrow(
      "authenticated uid"
    );
  });

  it("refuses to write over a malformed stored entry", async () => {
    store.docs.set(pathOf("alice", lunch.entryId), { ...lunch, revision: 1, status: "active", appliedIntentIds: [intentUuid(1)], extra: 1 });

    await expect(save(null, lunch, intentUuid(2))).rejects.toBeInstanceOf(NutritionV2IntegrityError);
    expect(store.sets).toEqual([]);
  });
});
