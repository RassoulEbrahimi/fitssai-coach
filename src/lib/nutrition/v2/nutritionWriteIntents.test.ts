import { describe, expect, it } from "vitest";
import {
  NutritionEntryIntentError,
  extraEntryId,
  slotEntryId,
  type NutritionEntryIntent,
  type RecordedEntry,
  type RecordedEntrySnapshot,
} from "@shared/nutrition";
import { AccountChangedError } from "@/lib/accountIdentity";
import { NutritionEntryConflictError } from "./entryTransaction";
import { NutritionV2IntegrityError } from "./integrity";
import { NutritionRecordingInputError, buildCustomSlotRecording, buildSkipRecording } from "./recording";
import {
  buildNutritionEntryWritePayload,
  groupNutritionConflicts,
  hasQueuedNutritionIntent,
  isQueueableNutritionWriteError,
  nutritionEntrySerializeKey,
  parseNutritionEntryWritePayload,
  parseQueueStorage,
  planNutritionApplyAgain,
  projectNutritionEntries,
  readOwnerNutritionQueue,
  unsettledHandoffIntents,
  type NutritionQueuedIntent,
} from "./nutritionWriteIntents";
import { deepFrozen, extraEntry, intentUuid, plannedMealEntry, removedEntry, skipEntry } from "@/test/nutritionV2Fixtures";

/*
  NUT-07. The pure half of offline convergence: what a queued Nutrition
  payload must look like, which queue entries count for whom, and what the
  entries look like with the queued intents applied — through the shared
  planner, in queue order, never by counting.
*/

const DATE = "2026-09-26";
const LUNCH = slotEntryId(DATE, "lunch");
const EXTRA_UUID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";

const snapshotOf = (entry: RecordedEntry): RecordedEntrySnapshot => {
  const { revision: _r, status: _s, appliedIntentIds: _a, ...snapshot } = entry;
  return snapshot as RecordedEntrySnapshot;
};

const pizza = (kcal = 900) =>
  buildCustomSlotRecording({ date: DATE, slotId: "lunch", name: "Pizza", estimate: { kcal } });

const record = (n: number, desired: RecordedEntrySnapshot = pizza(), expectedRevision = 0): NutritionEntryIntent => ({
  intentId: intentUuid(n),
  entryId: desired.entryId,
  expectedRevision,
  op: desired.recording === "skip" ? "skip" : "record",
  desired,
});
const correct = (n: number, expectedRevision: number, desired: RecordedEntrySnapshot = pizza(700)): NutritionEntryIntent => ({
  intentId: intentUuid(n),
  entryId: desired.entryId,
  expectedRevision,
  op: "correct",
  desired,
});
const remove = (n: number, expectedRevision: number, entryId = LUNCH): NutritionEntryIntent => ({
  intentId: intentUuid(n),
  entryId,
  expectedRevision,
  op: "remove",
});

const queued = (
  queueEntryId: string,
  intent: NutritionEntryIntent,
  status: NutritionQueuedIntent["status"] = "pending"
): NutritionQueuedIntent => ({ queueEntryId, status, intent, date: DATE });

const stored = (id: string, intent: NutritionEntryIntent, overrides: Record<string, unknown> = {}) => ({
  id,
  ownerUid: "alice",
  type: "NUTRITION_ENTRY_WRITE",
  payload: { intent, date: DATE },
  createdAt: 1,
  status: "pending",
  attempts: 0,
  ...overrides,
});

const byId = (entries: readonly RecordedEntry[], entryId: string) => entries.find((entry) => entry.entryId === entryId);

describe("queued payload", () => {
  it("accepts the exact canonical intent and its date, and returns it unchanged", () => {
    const payload = { intent: record(1), date: DATE };
    expect(parseNutritionEntryWritePayload(payload)).toBe(payload);
    expect(buildNutritionEntryWritePayload(payload.intent, DATE)).toEqual(payload);
  });

  it("survives a localStorage round-trip with the same intent id", () => {
    const payload = buildNutritionEntryWritePayload(record(7), DATE);
    const restored = parseQueueStorage(JSON.stringify([stored("q1", payload.intent)]));
    const { active } = readOwnerNutritionQueue(restored, "alice");
    expect(active).toHaveLength(1);
    expect(active[0].intent).toEqual(payload.intent);
    expect(active[0].intent.intentId).toBe(intentUuid(7));
  });

  it.each([
    ["no date", { intent: record(1) }],
    ["an extra field", { intent: record(1), date: DATE, planned: true }],
    ["a date its slot entry does not name", { intent: record(1), date: "2026-09-25" }],
    ["a save for another date", { intent: { ...record(1), entryId: extraEntryId(EXTRA_UUID), desired: { ...pizza(), entryId: extraEntryId(EXTRA_UUID) } }, date: "2026-09-25" }],
    ["an upper-case intent id", { intent: { ...record(1), intentId: EXTRA_UUID.toUpperCase() }, date: DATE }],
    ["a non-canonical entry id", { intent: { ...remove(1, 1), entryId: "lunch" }, date: DATE }],
    ["a desired state for another entry", { intent: { ...record(1), entryId: slotEntryId(DATE, "dinner") }, date: DATE }],
    ["an unknown op", { intent: { ...remove(1, 1), op: "delete" }, date: DATE }],
    ["a negative revision", { intent: remove(1, -1), date: DATE }],
    ["not an object", "payload"],
  ])("rejects a payload with %s", (_label, payload) => {
    expect(parseNutritionEntryWritePayload(payload)).toBeNull();
  });

  it("refuses to build a payload replay would reject", () => {
    expect(() => buildNutritionEntryWritePayload(record(1), "2026-09-25")).toThrow(RangeError);
  });

  it("takes an extra entry's date from the payload, since its id has none", () => {
    expect(parseNutritionEntryWritePayload({ intent: remove(1, 1, extraEntryId(EXTRA_UUID)), date: DATE })).not.toBeNull();
  });
});

describe("the owner's queue", () => {
  it("keeps queue order and splits active from rejected intents", () => {
    const queue = [
      stored("q1", record(1)),
      stored("q2", correct(2, 1), { status: "failed", attempts: 1 }),
      stored("q3", correct(3, 2), { status: "quarantined", rejection: { code: "staleRevision", message: "x" } }),
      stored("q4", remove(4, 2), { status: "syncing" }),
    ];
    const { active, rejected } = readOwnerNutritionQueue(queue, "alice");
    expect(active.map((item) => [item.queueEntryId, item.status])).toEqual([
      ["q1", "pending"],
      ["q2", "failed"],
      ["q4", "syncing"],
    ]);
    expect(rejected).toEqual([{ queueEntryId: "q3", intent: correct(3, 2), date: DATE, code: "staleRevision" }]);
  });

  it("ignores another account, ownerless and synced entries, Training entries and malformed payloads", () => {
    const queue = [
      stored("bob", record(1), { ownerUid: "bob" }),
      stored("ownerless", record(2), { ownerUid: undefined, status: "quarantined" }),
      stored("synced", record(3), { status: "synced" }),
      { ...stored("training", record(4)), type: "TOGGLE_SET", payload: { planId: "p", weekKey: "Week 1", dayIndex: 0, exerciseIndex: 0, setNumber: 1, completed: true } },
      stored("broken", record(5), { payload: { intent: { ...record(5), expectedRevision: "0" }, date: DATE } }),
      null,
      "junk",
    ];
    expect(readOwnerNutritionQueue(queue, "alice")).toEqual({ active: [], rejected: [] });
    expect(readOwnerNutritionQueue(queue, "bob").active.map((item) => item.queueEntryId)).toEqual(["bob"]);
    expect(readOwnerNutritionQueue(queue, null)).toEqual({ active: [], rejected: [] });
  });

  it("reads unreadable storage as empty, never throwing", () => {
    expect(parseQueueStorage("{broken")).toEqual([]);
    expect(parseQueueStorage('{"not":"a list"}')).toEqual([]);
    expect(parseQueueStorage(null)).toEqual([]);
  });

  it("serializes by entry: an older intent for the entry holds a new one, an unrelated one does not", () => {
    expect(nutritionEntrySerializeKey(LUNCH)).toBe(`nutrition-entry:${LUNCH}`);
    const active = [queued("q1", record(1))];
    expect(hasQueuedNutritionIntent(active, LUNCH)).toBe(true);
    expect(hasQueuedNutritionIntent(active, slotEntryId(DATE, "dinner"))).toBe(false);
  });
});

describe("optimistic projection", () => {
  it("shows a queued record as an active entry at revision 1", () => {
    const { entries, pending, basedOn } = projectNutritionEntries({ committed: [], queued: [queued("q1", record(1))] });
    expect(byId(entries, LUNCH)).toMatchObject({ status: "active", revision: 1, name: "Pizza", appliedIntentIds: [intentUuid(1)] });
    expect(pending.get(LUNCH)).toEqual({ entryId: LUNCH, date: DATE, status: "pending", count: 1 });
    expect(basedOn.get(LUNCH)).toBe("q1");
  });

  it("replaces the projected state with a queued correction", () => {
    const committed = [plannedMealEntry(DATE, "lunch")];
    const { entries } = projectNutritionEntries({ committed, queued: [queued("q1", correct(2, 1, pizza(640)))] });
    expect(byId(entries, LUNCH)).toMatchObject({ recording: "custom", revision: 2, nutritionEstimate: { kcal: 640 } });
  });

  it("shows a queued skip as explicitly recorded", () => {
    const skip = buildSkipRecording({ date: DATE, slotId: "lunch" });
    const { entries } = projectNutritionEntries({ committed: [], queued: [queued("q1", record(1, skip))] });
    expect(byId(entries, LUNCH)).toMatchObject({ recording: "skip", status: "active", nutritionEstimate: null });
  });

  it("turns a queued remove into a tombstone that keeps its snapshot", () => {
    const committed = [plannedMealEntry(DATE, "lunch")];
    const { entries } = projectNutritionEntries({ committed, queued: [queued("q1", remove(2, 1))] });
    expect(byId(entries, LUNCH)).toMatchObject({ status: "removed", revision: 2, recording: "plannedMeal" });
  });

  it("chains record → correct → remove from revision 0 through the planner", () => {
    const chain = [queued("q1", record(1)), queued("q2", correct(2, 1)), queued("q3", remove(3, 2))];
    const { entries, pending, basedOn } = projectNutritionEntries({ committed: [], queued: chain });
    expect(byId(entries, LUNCH)).toMatchObject({
      status: "removed",
      revision: 3,
      appliedIntentIds: [intentUuid(1), intentUuid(2), intentUuid(3)],
    });
    expect(pending.get(LUNCH)?.count).toBe(3);
    expect(basedOn.get(LUNCH)).toBe("q3");
  });

  it("predicts revisions with the planner, not by counting queued items", () => {
    // q1 already landed (its answer was lost): replaying it is alreadyApplied.
    const committed = [{ ...skipEntry(DATE, "lunch"), appliedIntentIds: [intentUuid(1)] }];
    const chain = [queued("q1", record(1, buildSkipRecording({ date: DATE, slotId: "lunch" }))), queued("q2", correct(2, 1))];
    const { entries, basedOn } = projectNutritionEntries({ committed, queued: chain });
    expect(byId(entries, LUNCH)).toMatchObject({ revision: 2, recording: "custom" });
    expect(basedOn.get(LUNCH)).toBe("q2");
  });

  it("keeps projecting while an intent is syncing or waiting after a transient failure", () => {
    const chain = [queued("q1", record(1), "syncing"), queued("q2", correct(2, 1), "failed")];
    const { entries, pending } = projectNutritionEntries({ committed: [], queued: chain });
    expect(byId(entries, LUNCH)).toMatchObject({ revision: 2 });
    expect(pending.get(LUNCH)).toMatchObject({ status: "failed", count: 2 });
  });

  it("never projects a quarantined intent or another account's", () => {
    const queue = [
      stored("q1", record(1), { status: "quarantined", rejection: { code: "staleRevision", message: "x" } }),
      stored("bob", record(2, pizza(111)), { ownerUid: "bob" }),
    ];
    const { entries, pending } = projectNutritionEntries({ committed: [], queued: readOwnerNutritionQueue(queue, "alice").active });
    expect(entries).toEqual([]);
    expect(pending.size).toBe(0);
  });

  it("skips an intent that no longer fits, and what was built on it", () => {
    // Another device moved the entry to revision 2 in the meantime.
    const committed = [{ ...skipEntry(DATE, "lunch"), revision: 2, appliedIntentIds: [intentUuid(90), intentUuid(91)] }];
    const chain = [queued("q1", correct(1, 1)), queued("q2", remove(2, 2))];
    const { entries, basedOn } = projectNutritionEntries({ committed, queued: chain });
    // q2 names revision 2 — the server's — so it would apply; q1 would not.
    expect(byId(entries, LUNCH)).toMatchObject({ status: "removed", revision: 3, recording: "skip" });
    expect(basedOn.get(LUNCH)).toBe("q2");
  });

  it("does not modify the committed entries it projects over", () => {
    const committed = deepFrozen([plannedMealEntry(DATE, "lunch"), extraEntry(DATE)]);
    const before = structuredClone(committed);
    const { entries } = projectNutritionEntries({ committed, queued: [queued("q1", correct(2, 1))] });
    expect(committed).toEqual(before);
    expect(entries[1]).toBe(committed[1]);
    expect(entries[0]).not.toBe(committed[0]);
  });

  it("adds a queued extra meal after the committed entries", () => {
    const desired = { ...snapshotOf(extraEntry(DATE, EXTRA_UUID)), name: "Banane" } as RecordedEntrySnapshot;
    const { entries } = projectNutritionEntries({
      committed: [plannedMealEntry(DATE, "lunch")],
      queued: [queued("q1", record(1, desired))],
    });
    expect(entries.map((entry) => entry.entryId)).toEqual([LUNCH, extraEntryId(EXTRA_UUID)]);
    expect(entries[1]).toMatchObject({ kind: "extra", name: "Banane", status: "active" });
  });

  it("leaves out intents for dates the committed read does not cover", () => {
    const { entries, pending } = projectNutritionEntries({
      committed: [],
      queued: [queued("q1", record(1))],
      covers: (date) => date !== DATE,
    });
    expect(entries).toEqual([]);
    expect(pending.size).toBe(0);
  });

  it("applies handed-off intents before queued ones, without making them a dependency", () => {
    const { entries, basedOn } = projectNutritionEntries({
      committed: [],
      handoff: [{ intent: record(1), date: DATE }],
      queued: [queued("q2", correct(2, 1))],
    });
    expect(byId(entries, LUNCH)).toMatchObject({ revision: 2 });
    expect(basedOn.get(LUNCH)).toBe("q2");
    expect(projectNutritionEntries({ committed: [], handoff: [{ intent: record(1), date: DATE }], queued: [] }).basedOn.size).toBe(0);
  });
});

describe("handoff settlement", () => {
  it("keeps what a read does not show yet, and drops what it shows or has moved past", () => {
    const a = { intent: record(1), date: DATE };
    const b = { intent: correct(2, 1), date: DATE };
    // A stale read: neither is visible yet.
    expect(unsettledHandoffIntents({ committed: [], handoff: [a, b] })).toEqual([a, b]);
    // A read that shows a, not b.
    const afterA = [{ ...pizza(), revision: 1, status: "active", appliedIntentIds: [intentUuid(1)] } as RecordedEntry];
    expect(unsettledHandoffIntents({ committed: afterA, handoff: [a, b] })).toEqual([b]);
    // A read another device already moved past b's revision.
    const moved = [{ ...afterA[0], revision: 5, appliedIntentIds: [intentUuid(1), intentUuid(50)] }];
    expect(unsettledHandoffIntents({ committed: moved, handoff: [b] })).toEqual([]);
    // Dates the read does not cover stay.
    expect(unsettledHandoffIntents({ committed: moved, handoff: [b], covers: () => false })).toEqual([b]);
  });
});

describe("queueable failures", () => {
  it.each([
    ["Firestore unavailable", Object.assign(new Error("offline"), { code: "unavailable" })],
    ["a deadline", Object.assign(new Error("slow"), { code: "deadline-exceeded" })],
    ["a prefixed code", Object.assign(new Error("offline"), { code: "firestore/unavailable" })],
    ["a failed fetch", new TypeError("Failed to fetch")],
  ])("queues after %s", (_label, error) => {
    expect(isQueueableNutritionWriteError(error)).toBe(true);
  });

  it.each([
    ["a conflict", new NutritionEntryConflictError({ reason: "staleRevision", entryId: LUNCH, expectedRevision: 0, currentRevision: 1, current: null })],
    ["an invalid intent", new NutritionEntryIntentError("bad")],
    ["an invalid input", new NutritionRecordingInputError("bad")],
    ["a malformed document", new NutritionV2IntegrityError("malformed", "users/a/x/y", "bad")],
    ["an account change", new AccountChangedError()],
    ["a permission refusal", Object.assign(new Error("denied"), { code: "permission-denied" })],
    ["no authentication", Object.assign(new Error("who"), { code: "unauthenticated" })],
    ["transaction contention", Object.assign(new Error("busy"), { code: "aborted" })],
    ["an unknown error", new Error("Failed to fetch")],
    ["a non-error", "unavailable"],
  ])("never queues after %s", (_label, error) => {
    expect(isQueueableNutritionWriteError(error)).toBe(false);
  });
});

describe("conflicts", () => {
  it("groups rejected intents by entry, keeping the latest request and every record", () => {
    const conflicts = groupNutritionConflicts([
      { queueEntryId: "q1", intent: record(1), date: DATE, code: "staleRevision" },
      { queueEntryId: "x1", intent: record(5, { ...snapshotOf(extraEntry(DATE, EXTRA_UUID)) } as RecordedEntrySnapshot), date: DATE, code: "alreadyActive" },
      { queueEntryId: "q2", intent: remove(2, 1), date: DATE, code: "dependencyRejected" },
    ]);
    expect(conflicts.map((conflict) => [conflict.entryId, conflict.queueEntryIds, conflict.intent.op])).toEqual([
      [LUNCH, ["q1", "q2"], "remove"],
      [extraEntryId(EXTRA_UUID), ["x1"], "record"],
    ]);
  });

  it("re-applies a save as a new save against the current entry", () => {
    const current = { ...skipEntry(DATE, "lunch"), revision: 2 };
    expect(planNutritionApplyAgain({ entryId: LUNCH, intent: record(1) }, current)).toEqual({
      kind: "command",
      command: { kind: "save", current, desired: pizza() },
    });
    expect(planNutritionApplyAgain({ entryId: LUNCH, intent: record(1) }, null)).toEqual({
      kind: "command",
      command: { kind: "save", current: null, desired: pizza() },
    });
  });

  it("re-evaluates a remove against the current entry", () => {
    const active = { ...plannedMealEntry(DATE, "lunch"), revision: 4 };
    expect(planNutritionApplyAgain({ entryId: LUNCH, intent: remove(1, 1) }, active)).toEqual({
      kind: "command",
      command: { kind: "remove", current: active },
    });
    expect(planNutritionApplyAgain({ entryId: LUNCH, intent: remove(1, 1) }, removedEntry(active))).toEqual({ kind: "nothingToApply" });
    expect(planNutritionApplyAgain({ entryId: LUNCH, intent: remove(1, 1) }, null)).toEqual({ kind: "nothingToApply" });
  });

  it("refuses another entry's current state", () => {
    expect(() => planNutritionApplyAgain({ entryId: LUNCH, intent: record(1) }, skipEntry(DATE, "dinner"))).toThrow(RangeError);
  });
});
