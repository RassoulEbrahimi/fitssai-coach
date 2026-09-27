import { describe, it, expect } from "vitest";
import {
  NUTRITION_SLOT_REQUEST_RING_SIZE,
  mealOverrideSchema,
  nutritionUpdateSlotRequestSchema,
  planMealReplacementCandidates,
  planSlotHeadCommit,
  planSlotHeadUndo,
  replacementSuggestionSetSchema,
  selectedMealOverride,
  slotHeadMatchesPlan,
  slotHeadRevision,
  slotHeadSchema,
  type MealOverrideOrigin,
  type PlannedMeal,
  type SlotHead,
  type SlotHeadCommitInput,
} from "@shared/nutrition";
import { resolveNutritionDay } from "@/lib/nutrition/v2/resolvedPlan";
import {
  FIXTURE_REPLACEMENT_VALIDATION,
  PLAN_ID,
  deepFrozen,
  intentUuid,
  makeOverride,
  makePlan,
  makeSlotHead,
  mealIdFor,
  values,
} from "@/test/nutritionV2Fixtures";

/*
  NUT-10 pure contract: the finalised SlotHead and MealOverride, the commit
  and undo planners, the plan-meal candidates, and the PLANNED resolver over a
  head's history. No Firestore, no clock.

  The fixture plan runs 23–29 Sep (breakfast, lunch, dinner); 25 Sep is day 2,
  so its lunch is m-2-lunch.
*/

const DAY = "2026-09-25";
const plan = makePlan();
const BASE = mealIdFor(2, "lunch");

/** Server-minted override ids. */
const oid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const NOW = { seconds: 1_790_000_500, nanoseconds: 0 };

const planMealFrom = (dayIndex: number): { meal: PlannedMeal; source: MealOverrideOrigin } => {
  const source = plan.days[dayIndex].meals.find((meal) => meal.slotId === "lunch") as PlannedMeal;
  return {
    meal: { ...source, mealId: `copy-${dayIndex}` },
    source: { kind: "planMeal", sourceMealId: source.mealId },
  };
};

const commitInput = (n: number, expectedRevision: number, dayIndex = 0): SlotHeadCommitInput => ({
  planId: PLAN_ID,
  date: DAY,
  slotId: "lunch",
  requestId: intentUuid(n),
  expectedRevision,
  now: NOW,
  baseMealId: BASE,
  overrideId: oid(n),
  ...planMealFrom(dayIndex),
});

const undoInput = (n: number, expectedRevision: number) => ({
  planId: PLAN_ID,
  date: DAY,
  slotId: "lunch" as const,
  requestId: intentUuid(n),
  expectedRevision,
  now: NOW,
});

/** Applies a plan's head, or fails the test. */
const applied = (outcome: ReturnType<typeof planSlotHeadCommit>): SlotHead => {
  if (outcome.outcome !== "apply") throw new Error(`expected apply, got ${outcome.outcome}`);
  return outcome.head;
};

/** A head with commits A (day 0) and B (day 1): B selected, B follows A. */
const twoCommits = () => applied(planSlotHeadCommit(applied(planSlotHeadCommit(null, commitInput(1, 0, 0))), commitInput(2, 1, 1)));

/* ------------------------------------------------------------------ *
 * SlotHead
 * ------------------------------------------------------------------ */

describe("SlotHead", () => {
  const head = makeSlotHead(DAY, "lunch");
  const [override] = Object.values(head.overrides);
  const parses = (value: unknown) => slotHeadSchema.safeParse(value).success;

  it("an absent head is the base meal at revision 0", () => {
    expect(slotHeadRevision(null)).toBe(0);
    expect(slotHeadRevision(undefined)).toBe(0);
    expect(selectedMealOverride(null)).toBeNull();
  });

  it("a persisted head starts at revision 1, a positive whole number", () => {
    expect(parses(head)).toBe(true);
    for (const revision of [0, -1, 1.5, "1", null]) expect(parses({ ...head, revision }), String(revision)).toBe(false);
    expect(applied(planSlotHeadCommit(null, commitInput(1, 0))).revision).toBe(1);
  });

  it("is strict: no unknown field, no missing field", () => {
    expect(parses({ ...head, owner: "alice" })).toBe(false);
    for (const field of ["revision", "selection", "overrides", "appliedRequestIds", "updatedAt", "schemaVersion"]) {
      const { [field]: _dropped, ...rest } = head as unknown as Record<string, unknown>;
      expect(parses(rest), field).toBe(false);
    }
    expect(parses({ ...head, schemaVersion: 1 })).toBe(false);
  });

  it("has a non-empty history, keyed by each override's own id", () => {
    expect(parses({ ...head, overrides: {} })).toBe(false);
    expect(parses({ ...head, overrides: { [oid(9)]: override }, selection: { kind: "base" } })).toBe(false);
  });

  it("every override belongs to the head's plan, date and slot", () => {
    for (const change of [{ planId: "plan-2" }, { date: "2026-09-26" }, { slotId: "dinner", meal: { ...override.meal, slotId: "dinner" } }]) {
      expect(parses({ ...head, overrides: { [override.overrideId]: { ...override, ...change } } }), JSON.stringify(change)).toBe(false);
    }
  });

  it("rejects a selection or a previous pointer that is broken, self-referencing or not earlier", () => {
    expect(parses({ ...head, selection: { kind: "override", overrideId: oid(99) } })).toBe(false);

    const chain = twoCommits();
    expect(parses(chain)).toBe(true);
    const [a, b] = [chain.overrides[oid(1)], chain.overrides[oid(2)]];
    const withB = (next: object) => ({ ...chain, overrides: { ...chain.overrides, [oid(2)]: { ...b, ...next } } });
    expect(parses(withB({ previousOverrideId: oid(99) }))).toBe(false); // dangling
    expect(parses(withB({ previousOverrideId: oid(2) }))).toBe(false); // self
    // A pointing forward at B would make a cycle.
    expect(parses({ ...chain, overrides: { ...chain.overrides, [oid(1)]: { ...a, previousOverrideId: oid(2) } } })).toBe(false);
  });

  it("orders its history by revision: one override per revision, none after the head's", () => {
    const chain = twoCommits();
    const b = chain.overrides[oid(2)];
    expect(parses({ ...chain, overrides: { ...chain.overrides, [oid(2)]: { ...b, createdAtRevision: 1 } } })).toBe(false);
    expect(parses({ ...chain, overrides: { ...chain.overrides, [oid(2)]: { ...b, createdAtRevision: 3 } } })).toBe(false);
    expect(parses({ ...chain, overrides: { ...chain.overrides, [oid(2)]: { ...b, baseMealId: "m-other" } } })).toBe(false);
    expect(parses({ ...chain, updatedAt: { seconds: NOW.seconds - 1, nanoseconds: 0 } })).toBe(false);
  });

  it("keeps a bounded, unique, lower-case request ring no longer than its revision", () => {
    const ring = (n: number) => Array.from({ length: n }, (_, i) => intentUuid(i + 1));
    const deep = { ...head, revision: 40 };
    expect(parses({ ...deep, appliedRequestIds: ring(NUTRITION_SLOT_REQUEST_RING_SIZE) })).toBe(true);
    expect(parses({ ...deep, appliedRequestIds: ring(NUTRITION_SLOT_REQUEST_RING_SIZE + 1) })).toBe(false);
    expect(parses({ ...deep, appliedRequestIds: [] })).toBe(false);
    expect(parses({ ...deep, appliedRequestIds: [intentUuid(1), intentUuid(1)] })).toBe(false);
    expect(parses({ ...deep, appliedRequestIds: ["3F2B8C1E-9A4D-4E6F-8B21-7C5D0E9A1B34"] })).toBe(false);
    expect(parses({ ...head, appliedRequestIds: ring(2) })).toBe(false); // revision 1 applied one request
  });
});

/* ------------------------------------------------------------------ *
 * MealOverride
 * ------------------------------------------------------------------ */

describe("MealOverride", () => {
  const override = makeOverride(DAY, "lunch");
  const parses = (value: unknown) => mealOverrideSchema.safeParse(value).success;

  it("carries its full immutable identity and a complete planned meal", () => {
    expect(parses(override)).toBe(true);
    for (const field of ["overrideId", "planId", "date", "slotId", "baseMealId", "previousOverrideId", "meal", "source", "createdAtRevision", "createdAt"]) {
      const { [field]: _dropped, ...rest } = override as unknown as Record<string, unknown>;
      expect(parses(rest), field).toBe(false);
    }
    const { mealId: _mealId, ...mealWithoutId } = override.meal;
    expect(parses({ ...override, meal: mealWithoutId })).toBe(false);
  });

  it("has a server-minted lower-case UUID and its own meal id, never the base meal's", () => {
    expect(parses({ ...override, overrideId: "override-1" })).toBe(false);
    expect(parses({ ...override, overrideId: override.overrideId.toUpperCase().replace(/0/g, "A") })).toBe(false);
    expect(parses({ ...override, meal: { ...override.meal, mealId: override.baseMealId } })).toBe(false);
    expect(parses({ ...override, meal: { ...override.meal, slotId: "dinner" } })).toBe(false);
    expect(parses({ ...override, previousOverrideId: override.overrideId })).toBe(false);
  });

  it("a planMeal source names another base meal; the base meal itself is Undo's", () => {
    expect(parses({ ...override, source: { kind: "planMeal", sourceMealId: "m-0-lunch" } })).toBe(true);
    expect(parses({ ...override, source: { kind: "planMeal", sourceMealId: override.baseMealId } })).toBe(false);
    expect(parses({ ...override, source: { kind: "planMeal" } })).toBe(false);
  });

  it("an aiSuggestion source names the server set, the candidate and the validation provenance", () => {
    const source = { kind: "aiSuggestion", suggestionSetId: "set-1", candidateId: "cand-1", validation: FIXTURE_REPLACEMENT_VALIDATION };
    expect(parses({ ...override, source })).toBe(true);
    for (const field of ["suggestionSetId", "candidateId", "validation"]) {
      const { [field]: _dropped, ...rest } = source as Record<string, unknown>;
      expect(parses({ ...override, source: rest }), field).toBe(false);
    }
    expect(parses({ ...override, source: { ...source, validation: { ...source.validation, outcome: "rejected" } } })).toBe(false);
  });

  it("no client request shape can pass for a persisted override", () => {
    expect(parses({ ...override, source: { source: "planMeal", sourceMealId: "m-0-lunch" } })).toBe(false);
    expect(parses({ ...override, requestId: intentUuid(1) })).toBe(false);
    expect(parses({ ...override, replacement: { source: "planMeal", sourceMealId: "m-0-lunch" } })).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Transitions
 * ------------------------------------------------------------------ */

describe("planSlotHeadCommit / planSlotHeadUndo", () => {
  it("the first commit creates revision 1, follows the base meal, and selects the new override", () => {
    const head = applied(planSlotHeadCommit(null, commitInput(1, 0)));
    expect(head).toMatchObject({ revision: 1, selection: { kind: "override", overrideId: oid(1) }, appliedRequestIds: [intentUuid(1)], updatedAt: NOW });
    expect(head.overrides[oid(1)]).toMatchObject({ previousOverrideId: null, baseMealId: BASE, createdAtRevision: 1, createdAt: NOW });
  });

  it("a later commit follows the override that was selected and leaves the history as it was", () => {
    const first = applied(planSlotHeadCommit(null, commitInput(1, 0)));
    const second = applied(planSlotHeadCommit(deepFrozen(first), commitInput(2, 1, 1)));
    expect(second.overrides[oid(2)].previousOverrideId).toBe(oid(1));
    expect(second.overrides[oid(1)]).toEqual(first.overrides[oid(1)]);
    expect(second.revision).toBe(2);
  });

  it("undo selects the previous override, then the base meal, then has nothing to undo", () => {
    const chain = twoCommits();
    const toA = applied(planSlotHeadUndo(deepFrozen(chain), undoInput(3, 2)));
    expect([toA.revision, toA.selection]).toEqual([3, { kind: "override", overrideId: oid(1) }]);
    const toBase = applied(planSlotHeadUndo(toA, undoInput(4, 3)));
    expect([toBase.revision, toBase.selection]).toEqual([4, { kind: "base" }]);
    expect(toBase.overrides).toEqual(chain.overrides);
    expect(planSlotHeadUndo(toBase, undoInput(5, 4))).toEqual({ outcome: "nothingToUndo" });
    expect(planSlotHeadUndo(null, undoInput(5, 0))).toEqual({ outcome: "nothingToUndo" });
  });

  it("a commit after an undo to base follows the base meal again", () => {
    const toBase = applied(planSlotHeadUndo(applied(planSlotHeadCommit(null, commitInput(1, 0))), undoInput(2, 1)));
    const again = applied(planSlotHeadCommit(toBase, commitInput(3, 2, 3)));
    expect(again.overrides[oid(3)].previousOverrideId).toBeNull();
  });

  it("an applied request id wins before the revision; a stale revision applies nothing", () => {
    const chain = twoCommits();
    expect(planSlotHeadCommit(chain, commitInput(1, 0))).toEqual({ outcome: "alreadyApplied", head: chain });
    expect(planSlotHeadUndo(chain, undoInput(2, 0))).toEqual({ outcome: "alreadyApplied", head: chain });
    expect(planSlotHeadCommit(chain, commitInput(3, 1))).toEqual({ outcome: "staleRevision", currentRevision: 2 });
    expect(planSlotHeadUndo(null, undoInput(3, 1))).toEqual({ outcome: "staleRevision", currentRevision: 0 });
  });

  it("refuses another slot's head, a reused override id, and an invalid meal", () => {
    const chain = twoCommits();
    expect(() => planSlotHeadCommit(chain, { ...commitInput(3, 2), date: "2026-09-26" })).toThrow();
    expect(() => planSlotHeadCommit(chain, { ...commitInput(3, 2), overrideId: oid(1) })).toThrow();
    expect(() => planSlotHeadCommit(null, { ...commitInput(3, 0), meal: { ...planMealFrom(0).meal, mealId: BASE } })).toThrow();
    expect(() => planSlotHeadCommit(null, { ...commitInput(3, 0), meal: { ...planMealFrom(0).meal, slotId: "dinner" } })).toThrow();
  });

  it("evicts the oldest request id beyond the ring", () => {
    let head: SlotHead | null = null;
    for (let n = 1; n <= NUTRITION_SLOT_REQUEST_RING_SIZE + 3; n += 1) {
      head = applied(
        n % 2 === 1 ? planSlotHeadCommit(head, commitInput(n, n - 1, n % 7 === 2 ? 0 : n % 7)) : planSlotHeadUndo(head, undoInput(n, n - 1))
      );
    }
    expect(head?.appliedRequestIds).toHaveLength(NUTRITION_SLOT_REQUEST_RING_SIZE);
    expect(head?.appliedRequestIds[0]).toBe(intentUuid(4));
  });
});

/* ------------------------------------------------------------------ *
 * The plan side
 * ------------------------------------------------------------------ */

describe("plan-meal candidates", () => {
  it("are the plan's other base meals of the same slot, in plan order", () => {
    const candidates = planMealReplacementCandidates(plan, DAY, "lunch");
    expect(candidates.map((meal) => meal.mealId)).toEqual([0, 1, 3, 4, 5, 6].map((i) => mealIdFor(i, "lunch")));
    expect(candidates.every((meal) => meal.slotId === "lunch")).toBe(true);
  });

  it("identify meals by id, never by name: equal names stay separate candidates", () => {
    const twin = structuredClone(plan);
    for (const day of twin.days) for (const meal of day.meals) meal.name = "Same name";
    expect(planMealReplacementCandidates(twin, DAY, "lunch")).toHaveLength(6);
  });

  it("come from the plan alone: no override, no other plan", () => {
    const heads = [makeSlotHead(DAY, "lunch")];
    const candidates = planMealReplacementCandidates(plan, DAY, "lunch");
    const overrideMealIds = heads.flatMap((head) => Object.values(head.overrides).map((override) => override.meal.mealId));
    expect(candidates.some((meal) => overrideMealIds.includes(meal.mealId))).toBe(false);
    const other = makePlan({ planId: "plan-2", startDate: "2026-09-30" });
    expect(planMealReplacementCandidates(other, "2026-10-02", "lunch").every((meal) => other.days.some((d) => d.meals.includes(meal)))).toBe(true);
  });

  it("a head matches its plan only when every override replaces that date's base meal from that plan's slot", () => {
    const head = twoCommits();
    expect(slotHeadMatchesPlan(head, plan)).toBe(true);
    expect(slotHeadMatchesPlan(head, makePlan({ planId: "plan-2" }))).toBe(false);
    const a = head.overrides[oid(1)];
    const withA = (next: object) => ({ ...head, overrides: { ...head.overrides, [oid(1)]: { ...a, ...next } } });
    expect(slotHeadMatchesPlan(withA({ source: { kind: "planMeal", sourceMealId: mealIdFor(0, "dinner") } }), plan)).toBe(false);
    expect(slotHeadMatchesPlan(withA({ source: { kind: "planMeal", sourceMealId: "m-elsewhere" } }), plan)).toBe(false);
    expect(slotHeadMatchesPlan({ ...head, overrides: { [oid(1)]: { ...a, baseMealId: "m-other" } } } as SlotHead, plan)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Resolver over a history
 * ------------------------------------------------------------------ */

describe("PLANNED resolves the selected override only", () => {
  const lunch = (head: SlotHead | null) => resolveNutritionDay(plan, head ? [head] : [], DAY)?.meals[1];
  const baseKcal = 702.2;

  it("missing head → base; base selection → base; selected override → that override", () => {
    expect(lunch(null)).toMatchObject({ source: "base", mealId: BASE, slotRevision: 0 });
    const chain = twoCommits();
    expect(lunch(chain)).toMatchObject({ source: "override", mealId: "copy-1", slotRevision: 2 });
    const toA = applied(planSlotHeadUndo(chain, undoInput(3, 2)));
    expect(lunch(toA)).toMatchObject({ source: "override", mealId: "copy-0", slotRevision: 3 });
    const toBase = applied(planSlotHeadUndo(toA, undoInput(4, 3)));
    expect(lunch(toBase)).toMatchObject({ source: "base", mealId: BASE, slotRevision: 4 });
  });

  it("planned totals follow the selection, never the rest of the history", () => {
    const chain = twoCommits();
    const total = (head: SlotHead | null) => resolveNutritionDay(plan, head ? [head] : [], DAY)?.planned.kcal ?? NaN;
    const withoutLunch = (total(null) ?? 0) - baseKcal;
    expect(total(chain)).toBeCloseTo(withoutLunch + planMealFrom(1).meal.values.kcal, 10);
    const toBase = applied(planSlotHeadUndo(applied(planSlotHeadUndo(chain, undoInput(3, 2))), undoInput(4, 3)));
    expect(total(toBase)).toBeCloseTo(total(null), 10);
  });

  it("never mutates the base plan or the head", () => {
    const frozenPlan = deepFrozen(plan);
    const frozenHead = deepFrozen(twoCommits());
    expect(() => resolveNutritionDay(frozenPlan, [frozenHead], DAY)).not.toThrow();
    expect(frozenPlan.days[2].meals.find((meal) => meal.slotId === "lunch")?.mealId).toBe(BASE);
  });

  it("uses the override's own values, whatever the base meal holds", () => {
    const head = makeSlotHead(DAY, "lunch", { name: "Server meal", values: values(1, 2, 3, 4) });
    expect(lunch(head)).toMatchObject({ name: "Server meal", values: values(1, 2, 3, 4) });
  });
});

/* ------------------------------------------------------------------ *
 * Server-only suggestion sets and the request
 * ------------------------------------------------------------------ */

describe("ReplacementSuggestionSet", () => {
  const set = {
    schemaVersion: 2,
    ownerUid: "alice",
    suggestionSetId: "set-1",
    planId: PLAN_ID,
    date: DAY,
    slotId: "lunch",
    candidates: [{ candidateId: "c-1", meal: { mealId: "s-1", slotId: "lunch", name: "x", values: values(1, 1, 1, 1) }, consumedByRequestId: null }],
    validation: FIXTURE_REPLACEMENT_VALIDATION,
    createdAt: { seconds: 10, nanoseconds: 0 },
    expiresAt: { seconds: 11, nanoseconds: 0 },
  };
  const parses = (value: unknown) => replacementSuggestionSetSchema.safeParse(value).success;

  it("binds an owner, a plan, a date and a slot, and needs an expiry after creation", () => {
    expect(parses(set)).toBe(true);
    for (const field of ["ownerUid", "planId", "date", "slotId", "expiresAt", "validation"]) {
      const { [field]: _dropped, ...rest } = set as Record<string, unknown>;
      expect(parses(rest), field).toBe(false);
    }
    expect(parses({ ...set, expiresAt: set.createdAt })).toBe(false);
  });

  it("holds only complete candidates for its slot, each consumable once", () => {
    expect(parses({ ...set, candidates: [] })).toBe(false);
    expect(parses({ ...set, candidates: [{ ...set.candidates[0], meal: { ...set.candidates[0].meal, slotId: "dinner" } }] })).toBe(false);
    expect(parses({ ...set, candidates: [set.candidates[0], set.candidates[0]] })).toBe(false);
    expect(parses({ ...set, candidates: [{ ...set.candidates[0], consumedByRequestId: intentUuid(1) }] })).toBe(true);
  });
});

describe("the nutritionUpdateSlot request", () => {
  const commit = {
    action: "commit",
    requestId: intentUuid(1),
    planId: PLAN_ID,
    date: DAY,
    slotId: "lunch",
    expectedRevision: 0,
    replacement: { source: "planMeal", sourceMealId: "m-0-lunch" },
  };

  it("accepts the id-only shapes", () => {
    expect(nutritionUpdateSlotRequestSchema.safeParse(commit).success).toBe(true);
    expect(
      nutritionUpdateSlotRequestSchema.safeParse({ ...commit, replacement: { source: "aiSuggestion", suggestionSetId: "s", candidateId: "c" } }).success
    ).toBe(true);
    const { replacement: _replacement, ...undo } = commit;
    expect(nutritionUpdateSlotRequestSchema.safeParse({ ...undo, action: "undo" }).success).toBe(true);
  });

  it("refuses meal content and server-owned ids", () => {
    for (const extra of [{ uid: "a" }, { name: "x" }, { kcal: 1 }, { meal: {} }, { overrideId: "o" }, { head: {} }]) {
      expect(nutritionUpdateSlotRequestSchema.safeParse({ ...commit, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(nutritionUpdateSlotRequestSchema.safeParse({ ...commit, replacement: { ...commit.replacement, mealId: "m" } }).success).toBe(false);
  });
});
