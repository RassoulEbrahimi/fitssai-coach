import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  NUTRITION_ENTRY_INTENT_RING_SIZE,
  NUTRITION_ENTRY_OPS,
  NutritionEntryIntentError,
  appendAppliedIntentId,
  planNutritionEntryWrite,
  recordedEntrySchema,
  type NutritionEntryIntent,
  type RecordedEntry,
  type RecordedEntrySnapshot,
} from "@shared/nutrition";
import {
  customSlotEntry,
  deepFrozen,
  extraEntry,
  intentUuid,
  plannedMealEntry,
  removedEntry,
  skipEntry,
  values,
} from "@/test/nutritionV2Fixtures";

/*
  NUT-06. The shared planner decides every recorded-entry write: create at
  revision 1, CAS updates at exactly +1, tombstones instead of deletes, and
  idempotency through the bounded intent ring — a duplicate intent is a
  success before any revision is compared.
*/

const DATE = "2026-09-26";

/** The semantic state of an entry: what an action asks for. */
const snapshotOf = (entry: RecordedEntry): RecordedEntrySnapshot => {
  const { revision: _revision, status: _status, appliedIntentIds: _ids, ...snapshot } = entry;
  return snapshot as RecordedEntrySnapshot;
};

const intent = (
  op: NutritionEntryIntent["op"],
  expectedRevision: number,
  desired: RecordedEntrySnapshot | null,
  intentId = intentUuid(2),
  entryId = desired?.entryId ?? ""
): NutritionEntryIntent =>
  (op === "remove"
    ? { intentId, entryId, expectedRevision, op }
    : { intentId, entryId, expectedRevision, op, desired }) as NutritionEntryIntent;

const lunch = plannedMealEntry(DATE, "lunch", values(700.2, 40, 80, 20));
const halfLunch = snapshotOf({ ...lunch, portion: 0.5, nutritionEstimate: values(350.1, 20, 40, 10) } as RecordedEntry);

describe("create", () => {
  it("creates a planned-meal entry at revision 1, active, with its intent", () => {
    const plan = planNutritionEntryWrite(null, intent("record", 0, snapshotOf(lunch), intentUuid(1)));

    expect(plan).toEqual({ outcome: "apply", entry: { ...lunch, revision: 1, status: "active", appliedIntentIds: [intentUuid(1)] } });
    expect(recordedEntrySchema.parse(plan.outcome === "apply" && plan.entry)).toBeTruthy();
  });

  it("creates a skip with no estimate", () => {
    const skip = skipEntry(DATE, "breakfast");
    const plan = planNutritionEntryWrite(null, intent("skip", 0, snapshotOf(skip), intentUuid(1)));

    expect(plan).toEqual({ outcome: "apply", entry: skip });
    expect(plan.outcome === "apply" && plan.entry.nutritionEstimate).toBeNull();
  });

  it("creates a custom slot entry, keeping unknown macros null", () => {
    const custom = customSlotEntry(DATE, "dinner");
    const plan = planNutritionEntryWrite(null, intent("record", 0, snapshotOf(custom), intentUuid(1)));

    expect(plan).toEqual({ outcome: "apply", entry: custom });
    expect(plan.outcome === "apply" && plan.entry.nutritionEstimate).toEqual({ kcal: 950, proteinG: null, carbsG: 110, fatG: null });
  });

  it("creates an extra custom entry", () => {
    const extra = extraEntry(DATE);
    expect(planNutritionEntryWrite(null, intent("record", 0, snapshotOf(extra), intentUuid(1)))).toEqual({
      outcome: "apply",
      entry: extra,
    });
  });

  it("is a conflict when no entry exists but the intent expected one", () => {
    expect(planNutritionEntryWrite(null, intent("record", 1, snapshotOf(lunch)))).toEqual({
      outcome: "conflict",
      reason: "staleRevision",
      entryId: lunch.entryId,
      expectedRevision: 1,
      currentRevision: 0,
      current: null,
    });
  });

  it("cannot correct an entry that does not exist", () => {
    const plan = planNutritionEntryWrite(null, intent("correct", 0, snapshotOf(lunch)));
    expect(plan).toMatchObject({ outcome: "conflict", reason: "notActive", currentRevision: 0, current: null });
  });
});

describe("update / correct", () => {
  it("edits to exactly revision + 1 with the full desired snapshot", () => {
    const plan = planNutritionEntryWrite(lunch, intent("correct", 1, halfLunch));

    expect(plan).toEqual({
      outcome: "apply",
      entry: { ...halfLunch, revision: 2, status: "active", appliedIntentIds: [intentUuid(1), intentUuid(2)] },
    });
  });

  it("corrects a planned meal to a skip, and a skip to a custom meal", () => {
    const skipped = planNutritionEntryWrite(lunch, intent("correct", 1, snapshotOf(skipEntry(DATE, "lunch"))));
    expect(skipped).toMatchObject({ outcome: "apply", entry: { recording: "skip", nutritionEstimate: null, revision: 2 } });
    expect(skipped.outcome === "apply" && "portion" in skipped.entry).toBe(false);

    const skip = skipped.outcome === "apply" ? skipped.entry : lunch;
    const custom = snapshotOf(customSlotEntry(DATE, "lunch", 640, "Kantine"));
    expect(planNutritionEntryWrite(skip, intent("correct", 2, custom, intentUuid(3)))).toMatchObject({
      outcome: "apply",
      entry: { recording: "custom", name: "Kantine", revision: 3, appliedIntentIds: [intentUuid(1), intentUuid(2), intentUuid(3)] },
    });
  });

  it("corrects an extra entry", () => {
    const extra = extraEntry(DATE);
    const corrected = snapshotOf({ ...extra, name: "Zwei Äpfel", nutritionEstimate: { kcal: 160, proteinG: null, carbsG: 40, fatG: null } } as RecordedEntry);
    expect(planNutritionEntryWrite(extra, intent("correct", 1, corrected))).toMatchObject({
      outcome: "apply",
      entry: { name: "Zwei Äpfel", revision: 2, status: "active" },
    });
  });

  it("is a conflict for a stale expected revision, carrying the current entry", () => {
    const current = { ...lunch, revision: 3, appliedIntentIds: [intentUuid(1), intentUuid(7), intentUuid(8)] };
    expect(planNutritionEntryWrite(current, intent("correct", 2, halfLunch))).toEqual({
      outcome: "conflict",
      reason: "staleRevision",
      entryId: lunch.entryId,
      expectedRevision: 2,
      currentRevision: 3,
      current,
    });
    // Ahead of the server is just as stale.
    expect(planNutritionEntryWrite(current, intent("correct", 4, halfLunch))).toMatchObject({ outcome: "conflict" });
  });

  it("cannot correct a tombstone; the slot is recorded again instead", () => {
    const tombstone = removedEntry(lunch, intentUuid(2));
    expect(planNutritionEntryWrite(tombstone, intent("correct", 2, halfLunch, intentUuid(3)))).toMatchObject({
      outcome: "conflict",
      reason: "notActive",
      currentRevision: 2,
    });
  });
});

describe("remove", () => {
  it("tombstones an active entry: revision + 1, status removed, snapshot kept", () => {
    const plan = planNutritionEntryWrite(lunch, intent("remove", 1, null, intentUuid(2), lunch.entryId));

    expect(plan).toEqual({ outcome: "apply", entry: removedEntry(lunch, intentUuid(2)) });
    expect(plan.outcome === "apply" && plan.entry.nutritionEstimate).toEqual(lunch.nutritionEstimate);
  });

  it("is a no-op for an absent entry", () => {
    expect(planNutritionEntryWrite(null, intent("remove", 0, null, intentUuid(2), lunch.entryId))).toEqual({
      outcome: "noop",
      entry: null,
    });
  });

  it("is a no-op for an entry that is already removed, whatever revision the intent named", () => {
    const tombstone = removedEntry(lunch, intentUuid(2));
    for (const expectedRevision of [1, 2, 5]) {
      expect(planNutritionEntryWrite(tombstone, intent("remove", expectedRevision, null, intentUuid(3), lunch.entryId))).toEqual({
        outcome: "noop",
        entry: tombstone,
      });
    }
  });

  it("is a conflict when the active entry changed since the person saw it", () => {
    const current = { ...lunch, revision: 2, appliedIntentIds: [intentUuid(1), intentUuid(5)] };
    expect(planNutritionEntryWrite(current, intent("remove", 1, null, intentUuid(2), lunch.entryId))).toMatchObject({
      outcome: "conflict",
      reason: "staleRevision",
      currentRevision: 2,
    });
  });

  it("has no hard-delete concept: every outcome keeps or writes a full document", () => {
    expect(NUTRITION_ENTRY_OPS).toEqual(["record", "skip", "correct", "remove"]);
    const source = readFileSync(resolve(__dirname, "../../../shared/nutrition/entryWrite.ts"), "utf8");
    expect(source).not.toMatch(/outcome:\s*["']delete|["']delete["']|deleteDoc/);
  });
});

describe("re-record over a tombstone", () => {
  it("records a removed slot again as its next revision, under the same id", () => {
    const tombstone = removedEntry(lunch, intentUuid(2));
    const custom = snapshotOf(customSlotEntry(DATE, "lunch"));
    const plan = planNutritionEntryWrite(tombstone, intent("record", 2, custom, intentUuid(3)));

    expect(plan).toEqual({
      outcome: "apply",
      entry: { ...custom, revision: 3, status: "active", appliedIntentIds: [intentUuid(1), intentUuid(2), intentUuid(3)] },
    });
  });

  it("can skip a removed slot", () => {
    const tombstone = removedEntry(lunch, intentUuid(2));
    expect(planNutritionEntryWrite(tombstone, intent("skip", 2, snapshotOf(skipEntry(DATE, "lunch")), intentUuid(3)))).toMatchObject({
      outcome: "apply",
      entry: { recording: "skip", status: "active", revision: 3 },
    });
  });
});

describe("idempotency", () => {
  it("a duplicate intent is alreadyApplied, with no new revision", () => {
    const applied = planNutritionEntryWrite(lunch, intent("correct", 1, halfLunch));
    const current = applied.outcome === "apply" ? applied.entry : lunch;

    expect(planNutritionEntryWrite(current, intent("correct", 1, halfLunch))).toEqual({ outcome: "alreadyApplied", entry: current });
  });

  it("a duplicate intent wins over a stale revision", () => {
    // The intent landed at revision 2; two more writes followed.
    const current = { ...lunch, revision: 4, appliedIntentIds: [intentUuid(1), intentUuid(2), intentUuid(3), intentUuid(4)] };
    expect(planNutritionEntryWrite(current, intent("correct", 1, halfLunch, intentUuid(2)))).toEqual({
      outcome: "alreadyApplied",
      entry: current,
    });
  });

  it("a duplicate create or remove is alreadyApplied too", () => {
    expect(planNutritionEntryWrite(lunch, intent("record", 0, snapshotOf(lunch), intentUuid(1)))).toEqual({
      outcome: "alreadyApplied",
      entry: lunch,
    });
    const tombstone = removedEntry(lunch, intentUuid(2));
    expect(planNutritionEntryWrite(tombstone, intent("remove", 1, null, intentUuid(2), lunch.entryId))).toEqual({
      outcome: "alreadyApplied",
      entry: tombstone,
    });
  });
});

describe("intent ring", () => {
  const ring = (from: number, count: number) => Array.from({ length: count }, (_, i) => intentUuid(from + i));

  it("is bounded to 20", () => {
    expect(NUTRITION_ENTRY_INTENT_RING_SIZE).toBe(20);
    const current = { ...lunch, revision: 20, appliedIntentIds: ring(100, 20) };
    const plan = planNutritionEntryWrite(current, intent("correct", 20, halfLunch, intentUuid(1)));

    expect(plan.outcome === "apply" && plan.entry.appliedIntentIds).toHaveLength(20);
  });

  it("evicts deterministically: oldest first, newest last", () => {
    expect(appendAppliedIntentId(ring(100, 20), intentUuid(1))).toEqual([...ring(101, 19), intentUuid(1)]);
    expect(appendAppliedIntentId(ring(100, 3), intentUuid(1))).toEqual([...ring(100, 3), intentUuid(1)]);
    expect(appendAppliedIntentId([], intentUuid(1))).toEqual([intentUuid(1)]);
  });

  it("forgets an evicted intent: after 20 newer writes it is no longer recognised", () => {
    const current = { ...lunch, revision: 21, appliedIntentIds: ring(100, 20) };
    // intentUuid(1) was applied at revision 1 and has been evicted.
    expect(planNutritionEntryWrite(current, intent("correct", 1, halfLunch, intentUuid(1)))).toMatchObject({
      outcome: "conflict",
      reason: "staleRevision",
    });
  });
});

describe("identity and inputs", () => {
  it("never changes an entry's identity", () => {
    const extra = extraEntry(DATE);
    expect(() =>
      planNutritionEntryWrite(extra, intent("correct", 1, snapshotOf({ ...extra, date: "2026-09-25" })))
    ).toThrow(NutritionEntryIntentError);
  });

  it("refuses an intent for another entry, or a desired state for another entry", () => {
    expect(() => planNutritionEntryWrite(lunch, intent("remove", 1, null, intentUuid(2), `slot:${DATE}:dinner`))).toThrow(
      NutritionEntryIntentError
    );
    expect(() =>
      planNutritionEntryWrite(null, intent("record", 0, snapshotOf(lunch), intentUuid(2), `slot:${DATE}:dinner`))
    ).toThrow(NutritionEntryIntentError);
  });

  it("refuses an op that does not match the desired recording", () => {
    expect(() => planNutritionEntryWrite(null, intent("skip", 0, snapshotOf(lunch)))).toThrow(NutritionEntryIntentError);
    expect(() => planNutritionEntryWrite(null, intent("record", 0, snapshotOf(skipEntry(DATE, "lunch"))))).toThrow(
      NutritionEntryIntentError
    );
  });

  it("refuses a malformed intent id, revision or desired state", () => {
    expect(() => planNutritionEntryWrite(null, intent("record", 0, snapshotOf(lunch), "device-1"))).toThrow(
      NutritionEntryIntentError
    );
    expect(() => planNutritionEntryWrite(null, intent("record", -1, snapshotOf(lunch)))).toThrow(NutritionEntryIntentError);
    expect(() => planNutritionEntryWrite(null, intent("record", 0.5, snapshotOf(lunch)))).toThrow(NutritionEntryIntentError);
    expect(() =>
      planNutritionEntryWrite(null, intent("record", 0, { ...snapshotOf(extraEntry(DATE)), estimateBasis: "none", nutritionEstimate: null } as RecordedEntrySnapshot))
    ).toThrow(NutritionEntryIntentError);
    // A desired state carries no metadata of its own.
    expect(() => planNutritionEntryWrite(null, intent("record", 0, lunch as unknown as RecordedEntrySnapshot))).toThrow(
      NutritionEntryIntentError
    );
  });

  it("does not mutate its inputs, and returns fresh objects", () => {
    const current = deepFrozen(lunch);
    const next = deepFrozen(intent("correct", 1, halfLunch));

    const plan = planNutritionEntryWrite(current, next);
    expect(plan.outcome).toBe("apply");
    if (plan.outcome !== "apply") return;
    expect(plan.entry.nutritionEstimate).not.toBe(next.op === "correct" && next.desired.nutritionEstimate);
    expect(plan.entry.appliedIntentIds).not.toBe(current.appliedIntentIds);
    expect(current).toEqual(lunch);

    const again = planNutritionEntryWrite(current, deepFrozen(intent("correct", 1, halfLunch, intentUuid(1))));
    expect(again.outcome === "alreadyApplied" && again.entry).not.toBe(current);
  });

  it("is pure: no Firestore, React, browser, Node API, clock or randomness", () => {
    const source = readFileSync(resolve(__dirname, "../../../shared/nutrition/entryWrite.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["'](firebase|react|@tanstack|node:|fs|path)/);
    expect(code).not.toMatch(/\b(Date\.now|new Date|Math\.random|randomUUID|window|document|navigator|process\.)/);
  });
});
