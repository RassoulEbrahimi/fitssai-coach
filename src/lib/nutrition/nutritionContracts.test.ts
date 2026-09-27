import { describe, it, expect } from "vitest";
import {
  GENERATION_REQUEST_KINDS,
  GENERATION_REQUEST_STATUSES,
  NUTRITION_PLAN_DAY_COUNT,
  NUTRITION_PLAN_LIFECYCLE_STATUSES,
  NUTRITION_PLAN_SOURCES,
  NUTRITION_STATE_OPERATIONS,
  nutritionPlanContentSchema,
  planValidationPolicyRefSchema,
  targetPolicyRefSchema,
  NUTRITION_SCHEMA_VERSION,
  NUTRITION_STATE_REQUEST_LEDGER_SIZE,
  addNutritionDays,
  extraEntryId,
  NUTRITION_ENTRY_INTENT_RING_SIZE,
  RECORDED_ENTRY_IDENTITY_FIELDS,
  RECORDED_ENTRY_STATUSES,
  generationRequestKindSchema,
  isActiveRecordedEntry,
  generationRequestStatusSchema,
  nutritionPlanSchema,
  nutritionUserStateSchema,
  nutritionValuesSchema,
  recordedEntrySchema,
  recordedEntrySnapshotSchema,
  slotEntryId,
  slotHeadSchema,
  targetVersionSchema,
} from "@shared/nutrition";

const values = { kcal: 612.4, proteinG: 38.25, carbsG: 71.1, fatG: 17.333 };

const target = {
  schemaVersion: 2,
  targetVersionId: "tv-1",
  mode: "manual",
  values,
  effectiveFrom: "2026-10-01",
  effectiveOrder: 1,
  policy: { id: "test-fixture-manual", version: 1 },
  profileFingerprint: { hash: "0123456789abcdef".repeat(4), fields: ["manualTargetKcal"] },
  supersedesTargetVersionId: null,
  createdAt: { seconds: 1_790_000_000, nanoseconds: 500 },
};

/** A 7-day plan starting on the fall-back Sunday, so it spans a DST switch. */
const START = "2026-10-25";

const planDay = (date: string, index: number) => ({
  date,
  meals: [
    { mealId: `m-${index}-1`, slotId: "breakfast", name: "Haferflocken mit Beeren", values },
    { mealId: `m-${index}-2`, slotId: "lunch", name: "Linsen-Curry", values },
    { mealId: `m-${index}-3`, slotId: "snack_1", name: "Apfel", values },
  ],
});

const plan = {
  schemaVersion: 2,
  planId: "plan-1",
  startDate: START,
  endDate: "2026-10-31",
  slotOrder: ["breakfast", "lunch", "snack_1"],
  days: Array.from({ length: 7 }, (_, index) => planDay(addNutritionDays(START, index), index)),
  targetVersionId: "tv-1",
  source: "generated",
  repeatedFromPlanId: null,
  generationRequestId: null,
  validation: { policy: { id: "test-fixture-accept", version: 1 }, outcome: "accepted" },
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
  activatedAt: { seconds: 1_790_000_000, nanoseconds: 0 },
  lifecycle: { status: "active", effectiveUntil: null, supersededByPlanId: null },
};

const withDays = (days: unknown[]) => ({ ...plan, days });

const overrideUuid = "5b1f9e62-3c4a-4d8e-9f10-2a6b7c8d9e0f";

/** One override committed at revision 1 (NUT-10). */
const slotOverride = {
  overrideId: overrideUuid,
  planId: "plan-1",
  date: "2026-10-25",
  slotId: "lunch",
  baseMealId: "m-0-1",
  previousOverrideId: null,
  meal: { mealId: "ov-1", slotId: "lunch", name: "Ofengemüse", values },
  source: { kind: "planMeal", sourceMealId: "m-2-1" },
  createdAtRevision: 1,
  createdAt: { seconds: 1_790_000_100, nanoseconds: 0 },
};

const slotHead = {
  schemaVersion: 2,
  planId: "plan-1",
  date: "2026-10-25",
  slotId: "lunch",
  revision: 1,
  selection: { kind: "override", overrideId: overrideUuid },
  overrides: { [overrideUuid]: slotOverride },
  appliedRequestIds: ["3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34"],
  updatedAt: { seconds: 1_790_000_100, nanoseconds: 0 },
};

const state = {
  schemaVersion: 2,
  revision: 1,
  activePlanId: "plan-1",
  currentTargetVersionId: "tv-1",
  activeGenerationRequestId: null,
  recentRequests: [{ requestId: "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34", operation: "setTarget", resultTargetVersionId: "tv-1" }],
};

const UUID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";
const INTENT = "7d444840-9dc0-4e2b-a5b1-3b8f1c2e6a10";

/** NUT-06 metadata of an entry created by one intent. */
const meta = { revision: 1, status: "active", appliedIntentIds: [INTENT] };

const plannedMealEntry = {
  schemaVersion: 2,
  entryId: slotEntryId("2026-10-25", "lunch"),
  kind: "slot",
  date: "2026-10-25",
  slotId: "lunch",
  recording: "plannedMeal",
  planId: "plan-1",
  name: "Linsen-Curry",
  estimateBasis: "planMealTimesPortion",
  portion: 1.5,
  nutritionEstimate: { kcal: 918.6, proteinG: 57.375, carbsG: 106.65, fatG: 25.9995 },
  ...meta,
};

const skipEntry = {
  schemaVersion: 2,
  entryId: slotEntryId("2026-10-25", "snack_2"),
  kind: "slot",
  date: "2026-10-25",
  slotId: "snack_2",
  recording: "skip",
  estimateBasis: "none",
  nutritionEstimate: null,
  ...meta,
};

const customExtraEntry = {
  schemaVersion: 2,
  entryId: extraEntryId(UUID),
  kind: "extra",
  date: "2026-10-25",
  slotId: null,
  recording: "custom",
  name: "Apfel",
  estimateBasis: "userStated",
  nutritionEstimate: { kcal: 80, proteinG: null, carbsG: null, fatG: null },
  ...meta,
};

const customSlotEntry = {
  ...customExtraEntry,
  entryId: slotEntryId("2026-10-25", "dinner"),
  kind: "slot",
  slotId: "dinner",
  name: "Pizza beim Italiener",
};

const documents = [
  ["TargetVersion", targetVersionSchema, target],
  ["NutritionPlan", nutritionPlanSchema, plan],
  ["SlotHead", slotHeadSchema, slotHead],
  ["NutritionUserState", nutritionUserStateSchema, state],
  ["RecordedEntry (plannedMeal)", recordedEntrySchema, plannedMealEntry],
  ["RecordedEntry (skip)", recordedEntrySchema, skipEntry],
  ["RecordedEntry (custom, extra)", recordedEntrySchema, customExtraEntry],
  ["RecordedEntry (custom, slot)", recordedEntrySchema, customSlotEntry],
] as const;

describe("schemaVersion", () => {
  it("is exactly 2", () => {
    expect(NUTRITION_SCHEMA_VERSION).toBe(2);
  });

  it.each(documents)("%s accepts schemaVersion 2", (_name, schema, doc) => {
    expect(schema.safeParse(doc).success).toBe(true);
  });

  it.each(documents)("%s rejects any other or missing schemaVersion", (_name, schema, doc) => {
    for (const version of [1, 3, "2", null, 2.0000001]) {
      expect(schema.safeParse({ ...doc, schemaVersion: version }).success).toBe(false);
    }
    const { schemaVersion: _omit, ...withoutVersion } = doc;
    expect(schema.safeParse(withoutVersion).success).toBe(false);
  });
});

describe("NutritionValues", () => {
  it("keeps unrounded values as they are", () => {
    expect(nutritionValuesSchema.parse(values)).toEqual(values);
  });

  it("accepts zero", () => {
    expect(nutritionValuesSchema.safeParse({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }).success).toBe(true);
  });

  it.each(["kcal", "proteinG", "carbsG", "fatG"] as const)("%s must be a finite, non-negative number", (key) => {
    for (const bad of [-0.1, Number.NaN, Number.POSITIVE_INFINITY, "12", null, undefined]) {
      expect(nutritionValuesSchema.safeParse({ ...values, [key]: bad }).success).toBe(false);
    }
  });

  it("rejects fields outside the four canonical nutrients", () => {
    expect(nutritionValuesSchema.safeParse({ ...values, fiberG: 4 }).success).toBe(false);
    expect(nutritionValuesSchema.safeParse({ ...values, actualCalories: 600 }).success).toBe(false);
  });

  it("does not allow null inside planned values", () => {
    expect(nutritionValuesSchema.safeParse({ ...values, fatG: null }).success).toBe(false);
  });
});

describe("NutritionPlan", () => {
  it(`covers exactly ${NUTRITION_PLAN_DAY_COUNT} dated days`, () => {
    const parsed = nutritionPlanSchema.parse(plan);
    expect(parsed.days.map((day) => day.date)).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
  });

  it("rejects a duplicate date", () => {
    const days = [...plan.days];
    days[3] = { ...days[3], date: days[2].date };
    expect(nutritionPlanSchema.safeParse(withDays(days)).success).toBe(false);
  });

  it("rejects non-contiguous or out-of-order dates", () => {
    const gap = [...plan.days];
    gap[6] = { ...gap[6], date: "2026-11-01" };
    expect(nutritionPlanSchema.safeParse(withDays(gap)).success).toBe(false);

    const swapped = [...plan.days];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    expect(nutritionPlanSchema.safeParse(withDays(swapped)).success).toBe(false);
  });

  it("rejects fewer or more than seven days", () => {
    expect(nutritionPlanSchema.safeParse(withDays(plan.days.slice(0, 6))).success).toBe(false);
    const eight = [...plan.days, planDay("2026-11-01", 7)];
    expect(nutritionPlanSchema.safeParse({ ...withDays(eight), endDate: "2026-11-01" }).success).toBe(false);
  });

  it("rejects an endDate that is not six days after startDate", () => {
    expect(nutritionPlanSchema.safeParse({ ...plan, endDate: "2026-11-01" }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...plan, endDate: "2026-10-30" }).success).toBe(false);
  });

  it("rejects malformed plan dates without throwing", () => {
    expect(nutritionPlanSchema.safeParse({ ...plan, startDate: "2026-02-30" }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...plan, endDate: "31.10.2026" }).success).toBe(false);
    const days = [...plan.days];
    days[0] = { ...days[0], date: "Sonntag" };
    expect(nutritionPlanSchema.safeParse(withDays(days)).success).toBe(false);
  });

  it("rejects the same slot twice within a day", () => {
    const days = [...plan.days];
    days[4] = {
      ...days[4],
      meals: [...days[4].meals, { mealId: "m-extra", slotId: "lunch", name: "Nudeln", values }],
    };
    expect(nutritionPlanSchema.safeParse(withDays(days)).success).toBe(false);
  });

  it("passes when every day plans each configured slot exactly once (subset of the canonical slots)", () => {
    expect(plan.slotOrder).toEqual(["breakfast", "lunch", "snack_1"]);
    expect(nutritionPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("passes when every day plans all five canonical slots exactly once", () => {
    const slots = ["breakfast", "lunch", "snack_1", "dinner", "snack_2"];
    const full = {
      ...plan,
      slotOrder: slots,
      days: plan.days.map((day, dayIndex) => ({
        date: day.date,
        meals: slots.map((slotId, slotIndex) => ({ mealId: `f-${dayIndex}-${slotIndex}`, slotId, name: "Gericht", values })),
      })),
    };
    expect(nutritionPlanSchema.safeParse(full).success).toBe(true);

    const missing = { ...full, days: [...full.days] };
    missing.days[3] = { ...missing.days[3], meals: missing.days[3].meals.filter((meal) => meal.slotId !== "snack_2") };
    expect(nutritionPlanSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects a day missing one configured slot", () => {
    const days = [...plan.days];
    days[5] = { ...days[5], meals: days[5].meals.filter((meal) => meal.slotId !== "snack_1") };
    const result = nutritionPlanSchema.safeParse(withDays(days));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain("slot snack_1 has no meal on 2026-10-30");
  });

  it("rejects a day with no meals at all", () => {
    const days = [...plan.days];
    days[0] = { ...days[0], meals: [] };
    expect(nutritionPlanSchema.safeParse(withDays(days)).success).toBe(false);
  });

  it("rejects a missing slot even when another slot fills its place", () => {
    const days = [...plan.days];
    days[2] = {
      ...days[2],
      meals: days[2].meals.map((meal) => (meal.slotId === "snack_1" ? { ...meal, slotId: "lunch" } : meal)),
    };
    expect(nutritionPlanSchema.safeParse(withDays(days)).success).toBe(false);
  });

  it("allows the same slot on different days", () => {
    expect(nutritionPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("rejects a slot the plan does not configure", () => {
    expect(nutritionPlanSchema.safeParse({ ...plan, slotOrder: ["breakfast", "lunch"] }).success).toBe(false);
  });

  it("rejects a duplicate or unknown configured slot, or none at all", () => {
    expect(nutritionPlanSchema.safeParse({ ...plan, slotOrder: [...plan.slotOrder, "lunch"] }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...plan, slotOrder: [...plan.slotOrder, "snack"] }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...plan, slotOrder: [] }).success).toBe(false);
  });

  it("needs a unique meal identity across the plan", () => {
    const days = [...plan.days];
    days[1] = { ...days[1], meals: [{ ...days[1].meals[0], mealId: "m-0-1" }, ...days[1].meals.slice(1)] };
    expect(nutritionPlanSchema.safeParse(withDays(days)).success).toBe(false);

    const days2 = [...plan.days];
    days2[1] = {
      ...days2[1],
      meals: [{ ...days2[1].meals[0], mealId: "Haferflocken mit Beeren" }, ...days2[1].meals.slice(1)],
    };
    expect(nutritionPlanSchema.safeParse(withDays(days2)).success).toBe(false);
  });

  it("rejects an empty meal name but sets no layout length limit", () => {
    const empty = [...plan.days];
    empty[0] = { ...empty[0], meals: [{ ...empty[0].meals[0], name: "  " }, ...empty[0].meals.slice(1)] };
    expect(nutritionPlanSchema.safeParse(withDays(empty)).success).toBe(false);

    const long = [...plan.days];
    long[0] = {
      ...long[0],
      meals: [{ ...long[0].meals[0], name: "Sehr ausführliches Gericht ".repeat(30) }, ...long[0].meals.slice(1)],
    };
    expect(nutritionPlanSchema.safeParse(withDays(long)).success).toBe(true);
  });
});

describe("SlotHead and MealOverride", () => {
  // The full NUT-10 contract is pinned in nutritionSlotOverride.test.ts.
  it("selects the base meal, or an override of the head's own history", () => {
    expect(slotHeadSchema.safeParse({ ...slotHead, revision: 2, selection: { kind: "base" } }).success).toBe(true);
    expect(slotHeadSchema.safeParse({ ...slotHead, selection: { kind: "override", overrideId: "6c2a0f73-4d5b-4e9f-8a21-3b7c8d9e0f1a" } }).success).toBe(false);
  });

  it("refuses the interim embedded shape: a selection never carries the meal", () => {
    const interim = { kind: "override", override: { source: "aiSuggestion", meal: { name: "Ofengemüse", values } } };
    expect(slotHeadSchema.safeParse({ ...slotHead, selection: interim }).success).toBe(false);
    const { revision: _revision, overrides: _overrides, appliedRequestIds: _ring, updatedAt: _updatedAt, ...nut01 } = slotHead;
    expect(slotHeadSchema.safeParse({ ...nut01, selection: { kind: "base" } }).success).toBe(false);
  });

  it("rejects unknown override sources and shapes", () => {
    for (const source of [
      { kind: "user" },
      { kind: "aiSuggestion" },
      { kind: "planMeal" },
      { kind: "planMeal", sourceMealId: "m-2-1", candidateId: "c-1" },
    ]) {
      expect(slotHeadSchema.safeParse({ ...slotHead, overrides: { [overrideUuid]: { ...slotOverride, source } } }).success).toBe(false);
    }
    expect(slotHeadSchema.safeParse({ ...slotHead, selection: { kind: "skip" } }).success).toBe(false);
  });

  it("rejects malformed ids, dates and slots", () => {
    expect(slotHeadSchema.safeParse({ ...slotHead, planId: "plan__1" }).success).toBe(false);
    expect(slotHeadSchema.safeParse({ ...slotHead, date: "2026-13-01" }).success).toBe(false);
    expect(slotHeadSchema.safeParse({ ...slotHead, slotId: "snack" }).success).toBe(false);
  });
});

describe("RecordedEntry recordings", () => {
  it("a planned-meal recording snapshots all four values with its portion", () => {
    expect(
      recordedEntrySchema.safeParse({
        ...plannedMealEntry,
        nutritionEstimate: { ...plannedMealEntry.nutritionEstimate, fatG: null },
      }).success
    ).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, portion: 0 }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, portion: null }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, estimateBasis: "userStated" }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, planId: null }).success).toBe(false);
  });

  it("a skip carries no meal and no estimate", () => {
    expect(recordedEntrySchema.safeParse({ ...skipEntry, name: "Nichts" }).success).toBe(false);
    expect(
      recordedEntrySchema.safeParse({ ...skipEntry, nutritionEstimate: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 } })
        .success
    ).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...skipEntry, estimateBasis: "userStated" }).success).toBe(false);
  });

  it("only a custom recording can be an extra entry", () => {
    expect(
      recordedEntrySchema.safeParse({ ...plannedMealEntry, kind: "extra", slotId: null, entryId: extraEntryId(UUID) })
        .success
    ).toBe(false);
    expect(
      recordedEntrySchema.safeParse({ ...skipEntry, kind: "extra", slotId: null, entryId: extraEntryId(UUID) }).success
    ).toBe(false);
  });

  it("rejects an unknown recording", () => {
    for (const recording of ["baseMeal", "override", "userDescribed", "consumed"]) {
      expect(recordedEntrySchema.safeParse({ ...customSlotEntry, recording }).success).toBe(false);
    }
  });
});

describe("RecordedEntry estimate semantics", () => {
  it("keeps a null macro as unknown, not zero", () => {
    const parsed = recordedEntrySchema.parse(customExtraEntry);
    expect(parsed.nutritionEstimate).toEqual({ kcal: 80, proteinG: null, carbsG: null, fatG: null });
  });

  it("needs kcal whenever there is an estimate", () => {
    expect(
      recordedEntrySchema.safeParse({
        ...customExtraEntry,
        nutritionEstimate: { kcal: null, proteinG: 1, carbsG: 1, fatG: 1 },
      }).success
    ).toBe(false);
  });

  it("a custom recording always carries the kcal the person stated (NUT-06)", () => {
    // A custom meal without stated kcal is not a completed recording, in a
    // slot or as an extra — basis none is for a skip only.
    for (const entry of [customExtraEntry, customSlotEntry]) {
      expect(recordedEntrySchema.safeParse({ ...entry, estimateBasis: "none", nutritionEstimate: null }).success).toBe(
        false
      );
      expect(
        recordedEntrySchema.safeParse({ ...entry, estimateBasis: "none", nutritionEstimate: entry.nutritionEstimate })
          .success
      ).toBe(false);
      expect(recordedEntrySchema.safeParse({ ...entry, nutritionEstimate: null }).success).toBe(false);
    }
  });

  it("custom cannot claim a planMealTimesPortion basis or a portion", () => {
    expect(recordedEntrySchema.safeParse({ ...customSlotEntry, estimateBasis: "planMealTimesPortion" }).success).toBe(
      false
    );
    expect(recordedEntrySchema.safeParse({ ...customSlotEntry, portion: 1 }).success).toBe(false);
  });

  it("rejects negative or non-finite estimates", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const key of ["kcal", "proteinG"] as const) {
        expect(
          recordedEntrySchema.safeParse({
            ...customExtraEntry,
            nutritionEstimate: { ...customExtraEntry.nutritionEstimate, [key]: bad },
          }).success
        ).toBe(false);
      }
    }
  });

  it("has no actualCalories field", () => {
    expect(recordedEntrySchema.safeParse({ ...customExtraEntry, actualCalories: 80 }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, actualCalories: 918 }).success).toBe(false);
  });
});

describe("RecordedEntry mutation metadata (NUT-06)", () => {
  it("names the ring size, the statuses and the identity fields", () => {
    expect(NUTRITION_ENTRY_INTENT_RING_SIZE).toBe(20);
    expect(RECORDED_ENTRY_STATUSES).toEqual(["active", "removed"]);
    expect(RECORDED_ENTRY_IDENTITY_FIELDS).toEqual(["schemaVersion", "entryId", "kind", "date", "slotId"]);
  });

  it("requires revision, status and appliedIntentIds on every recording", () => {
    for (const entry of [plannedMealEntry, skipEntry, customExtraEntry, customSlotEntry]) {
      for (const field of ["revision", "status", "appliedIntentIds"]) {
        const { [field]: _omitted, ...rest } = entry as Record<string, unknown>;
        expect(recordedEntrySchema.safeParse(rest).success, field).toBe(false);
      }
    }
  });

  it("takes a positive whole revision", () => {
    for (const revision of [0, -1, 1.5, "1", null]) {
      expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, revision }).success, String(revision)).toBe(false);
    }
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, revision: 42 }).success).toBe(true);
  });

  it("is active or a removed tombstone that keeps its snapshot", () => {
    const tombstone = { ...plannedMealEntry, status: "removed", revision: 2 };
    expect(recordedEntrySchema.parse(tombstone)).toEqual(tombstone);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, status: "deleted" }).success).toBe(false);
    expect(isActiveRecordedEntry(recordedEntrySchema.parse(tombstone))).toBe(false);
    // An active skip is a recording; a tombstone is not.
    expect(isActiveRecordedEntry(recordedEntrySchema.parse(skipEntry))).toBe(true);
  });

  it("keeps 1 to 20 distinct lower-case UUID intent ids", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, appliedIntentIds: ids(20) }).success).toBe(true);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, appliedIntentIds: ids(21) }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, appliedIntentIds: [] }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, appliedIntentIds: [INTENT, INTENT] }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, appliedIntentIds: [INTENT.toUpperCase()] }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, appliedIntentIds: ["device-1"] }).success).toBe(false);
  });

  it("describes the desired state without metadata as a snapshot", () => {
    const { revision: _r, status: _s, appliedIntentIds: _a, ...snapshot } = plannedMealEntry;
    expect(recordedEntrySnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(recordedEntrySnapshotSchema.safeParse(plannedMealEntry).success).toBe(false);
    expect(recordedEntrySchema.safeParse(snapshot).success).toBe(false);
  });
});

describe("RecordedEntry identity", () => {
  it("a slot entry's id must match its date and slot", () => {
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, entryId: "slot:2026-10-24:lunch" }).success).toBe(
      false
    );
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, entryId: "slot:2026-10-25:dinner" }).success).toBe(
      false
    );
    expect(recordedEntrySchema.safeParse({ ...skipEntry, slotId: null }).success).toBe(false);
  });

  it("an extra entry needs an extra:{uuid} id and no slot", () => {
    expect(
      recordedEntrySchema.safeParse({ ...customExtraEntry, entryId: slotEntryId("2026-10-25", "lunch") }).success
    ).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...customExtraEntry, entryId: "extra:not-a-uuid" }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...customExtraEntry, slotId: "snack_1" }).success).toBe(false);
  });

  it("rejects malformed dates without throwing", () => {
    expect(recordedEntrySchema.safeParse({ ...customExtraEntry, date: "2026-02-30" }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...plannedMealEntry, date: "25.10.2026" }).success).toBe(false);
  });
});

describe("NutritionPlan persistence metadata (NUT-09)", () => {
  const superseded = { status: "superseded", effectiveUntil: "2026-10-28", supersededByPlanId: "plan-2" };
  const repeated = { ...plan, planId: "plan-2", source: "repeated", repeatedFromPlanId: "plan-1" };

  it.each([
    "targetVersionId",
    "source",
    "repeatedFromPlanId",
    "generationRequestId",
    "validation",
    "createdAt",
    "activatedAt",
    "lifecycle",
  ])("requires %s: an unreleased V2 plan without it is malformed, never defaulted", (field) => {
    const { [field as keyof typeof plan]: _omit, ...without } = plan;
    expect(nutritionPlanSchema.safeParse(without).success).toBe(false);
  });

  it("knows exactly the generated and repeated sources", () => {
    expect(NUTRITION_PLAN_SOURCES).toEqual(["generated", "repeated"]);
    expect(nutritionPlanSchema.safeParse(repeated).success).toBe(true);
    for (const source of ["ai", "manual", "copied", null]) {
      expect(nutritionPlanSchema.safeParse({ ...plan, source }).success).toBe(false);
    }
  });

  it("names the repeated plan only for a repeat, and never itself", () => {
    expect(nutritionPlanSchema.safeParse({ ...repeated, repeatedFromPlanId: null }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...repeated, repeatedFromPlanId: "plan-2" }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...plan, repeatedFromPlanId: "plan-0" }).success).toBe(false);
  });

  it("lets only a generated plan carry a generation request id", () => {
    expect(nutritionPlanSchema.safeParse({ ...plan, generationRequestId: "gen-1" }).success).toBe(true);
    expect(nutritionPlanSchema.safeParse({ ...repeated, generationRequestId: "gen-1" }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...plan, generationRequestId: "gen__1" }).success).toBe(false);
  });

  it("records a plan-validation policy reference and an accepted outcome, nothing else", () => {
    const withValidation = (validation: unknown) => nutritionPlanSchema.safeParse({ ...plan, validation }).success;
    expect(withValidation({ policy: { id: "p", version: 3 }, outcome: "accepted" })).toBe(true);
    expect(withValidation({ policy: { id: "p", version: 3 }, outcome: "rejected" })).toBe(false);
    expect(withValidation({ policy: { id: "p", version: 0 }, outcome: "accepted" })).toBe(false);
    expect(withValidation({ policy: { id: "Policy P", version: 1 }, outcome: "accepted" })).toBe(false);
    // No threshold detail can ride along with the provenance.
    expect(withValidation({ policy: { id: "p", version: 1 }, outcome: "accepted", maxKcalDeviation: 0.1 })).toBe(false);
    expect(withValidation({ policy: { id: "p", version: 1, tolerance: 5 }, outcome: "accepted" })).toBe(false);
  });

  it("keeps the plan-validation reference distinct from the target-policy reference", () => {
    expect(planValidationPolicyRefSchema).not.toBe(targetPolicyRefSchema);
    expect(planValidationPolicyRefSchema.parse({ id: "p", version: 1 })).toEqual({ id: "p", version: 1 });
  });

  it("is never activated before it was created", () => {
    const at = (seconds: number, nanoseconds = 0) => ({ seconds, nanoseconds });
    expect(nutritionPlanSchema.safeParse({ ...plan, createdAt: at(10, 5), activatedAt: at(10, 5) }).success).toBe(true);
    expect(nutritionPlanSchema.safeParse({ ...plan, createdAt: at(10, 5), activatedAt: at(11) }).success).toBe(true);
    expect(nutritionPlanSchema.safeParse({ ...plan, createdAt: at(10, 5), activatedAt: at(10, 4) }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...plan, createdAt: at(10), activatedAt: at(9) }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...plan, createdAt: "2026-10-24T08:00:00Z" }).success).toBe(false);
  });

  it("has exactly two lifecycles, and no impossible combination parses", () => {
    expect(NUTRITION_PLAN_LIFECYCLE_STATUSES).toEqual(["active", "superseded"]);
    const withLifecycle = (lifecycle: unknown) => nutritionPlanSchema.safeParse({ ...plan, lifecycle }).success;
    expect(withLifecycle(superseded)).toBe(true);
    expect(withLifecycle({ status: "active", effectiveUntil: "2026-10-28", supersededByPlanId: null })).toBe(false);
    expect(withLifecycle({ status: "active", effectiveUntil: null, supersededByPlanId: "plan-2" })).toBe(false);
    expect(withLifecycle({ ...superseded, effectiveUntil: null })).toBe(false);
    expect(withLifecycle({ ...superseded, supersededByPlanId: null })).toBe(false);
    expect(withLifecycle({ status: "active" })).toBe(false);
    for (const status of ["draft", "pending", "deleted", "archived"]) {
      expect(withLifecycle({ status, effectiveUntil: null, supersededByPlanId: null })).toBe(false);
    }
  });

  it("keeps a superseded plan's effectiveUntil inside its own dates, and never itself as successor", () => {
    const withLifecycle = (lifecycle: unknown) => nutritionPlanSchema.safeParse({ ...plan, lifecycle }).success;
    expect(withLifecycle({ ...superseded, effectiveUntil: START })).toBe(true);
    expect(withLifecycle({ ...superseded, effectiveUntil: "2026-10-31" })).toBe(true);
    expect(withLifecycle({ ...superseded, effectiveUntil: "2026-10-24" })).toBe(false);
    expect(withLifecycle({ ...superseded, effectiveUntil: "2026-11-01" })).toBe(false);
    expect(withLifecycle({ ...superseded, effectiveUntil: "2026-02-30" })).toBe(false);
    expect(withLifecycle({ ...superseded, supersededByPlanId: "plan-1" })).toBe(false);
  });

  it("checks base content alone by the same structural rules", () => {
    const { startDate, endDate, slotOrder, days } = plan;
    const content = { startDate, endDate, slotOrder, days };
    expect(nutritionPlanContentSchema.safeParse(content).success).toBe(true);
    expect(nutritionPlanContentSchema.safeParse({ ...content, days: days.slice(0, 6) }).success).toBe(false);
    expect(nutritionPlanContentSchema.safeParse({ ...content, planId: "plan-1" }).success).toBe(false);
  });
});

describe("plan generation requests", () => {
  it("have the canonical kinds and statuses", () => {
    expect(GENERATION_REQUEST_KINDS).toEqual(["initial", "regenerate"]);
    expect(GENERATION_REQUEST_STATUSES).toEqual(["queued", "running", "succeeded", "failed", "discarded_stale"]);
  });

  it("reject anything else, including replacement suggestions", () => {
    for (const kind of ["basePlan", "slotSuggestions", "replacement", "suggestion"]) {
      expect(generationRequestKindSchema.safeParse(kind).success).toBe(false);
    }
    for (const status of ["pending", "done", "discarded", "stale"]) {
      expect(generationRequestStatusSchema.safeParse(status).success).toBe(false);
    }
  });
});

describe("targets and state", () => {
  it("rejects an unknown target mode", () => {
    expect(targetVersionSchema.safeParse({ ...target, mode: "auto" }).success).toBe(false);
  });

  it("state pointers are ids or null", () => {
    expect(nutritionUserStateSchema.safeParse({ ...state, activePlanId: "" }).success).toBe(false);
    expect(nutritionUserStateSchema.safeParse({ ...state, activePlanId: undefined }).success).toBe(false);
  });
});

describe("TargetVersion (NUT-08)", () => {
  it("keeps values unrounded", () => {
    expect(targetVersionSchema.parse(target).values).toEqual(values);
  });

  it.each([
    "effectiveOrder",
    "policy",
    "profileFingerprint",
    "supersedesTargetVersionId",
    "createdAt",
  ])("requires %s: an incomplete V2 target is malformed, never defaulted", (field) => {
    const { [field as keyof typeof target]: _omit, ...without } = target;
    expect(targetVersionSchema.safeParse(without).success).toBe(false);
  });

  it("rejects raw profile inputs carried on the target or its fingerprint", () => {
    expect(targetVersionSchema.safeParse({ ...target, weight: 70 }).success).toBe(false);
    expect(
      targetVersionSchema.safeParse({ ...target, profileFingerprint: { ...target.profileFingerprint, values: { weight: 70 } } })
        .success
    ).toBe(false);
  });

  it("orders versions with a positive whole effectiveOrder", () => {
    for (const bad of [0, -1, 1.5, "1", null]) {
      expect(targetVersionSchema.safeParse({ ...target, effectiveOrder: bad }).success).toBe(false);
    }
  });

  it("records the policy id and a positive version", () => {
    for (const policy of [{ id: "", version: 1 }, { id: "Policy A", version: 1 }, { id: "p", version: 0 }, { id: "p" }]) {
      expect(targetVersionSchema.safeParse({ ...target, policy }).success).toBe(false);
    }
  });

  it("fingerprints with a SHA-256 hex digest and sorted, unique field names", () => {
    const withFingerprint = (profileFingerprint: unknown) => targetVersionSchema.safeParse({ ...target, profileFingerprint });
    expect(withFingerprint({ hash: "abc", fields: [] }).success).toBe(false);
    expect(withFingerprint({ hash: "A".repeat(64), fields: [] }).success).toBe(false);
    expect(withFingerprint({ hash: "a".repeat(64), fields: ["weight", "height"] }).success).toBe(false);
    expect(withFingerprint({ hash: "a".repeat(64), fields: ["height", "height"] }).success).toBe(false);
    expect(withFingerprint({ hash: "a".repeat(64), fields: ["height", "weight"] }).success).toBe(true);
    // A field this build does not know is a valid document; freshness cannot compare it.
    expect(withFingerprint({ hash: "a".repeat(64), fields: ["futureField", "height"] }).success).toBe(true);
  });

  it("cannot supersede itself", () => {
    expect(targetVersionSchema.safeParse({ ...target, supersedesTargetVersionId: "tv-0" }).success).toBe(true);
    expect(targetVersionSchema.safeParse({ ...target, supersedesTargetVersionId: "tv-1" }).success).toBe(false);
  });

  it("reads createdAt from either Firestore SDK's timestamp, as a plain instant", () => {
    class ClientTimestamp {
      constructor(
        readonly seconds: number,
        readonly nanoseconds: number
      ) {}
      toDate() {
        return new Date(this.seconds * 1000);
      }
    }
    class AdminTimestamp {
      private readonly _seconds = 1_790_000_000;
      private readonly _nanoseconds = 7;
      get seconds() {
        return this._seconds;
      }
      get nanoseconds() {
        return this._nanoseconds;
      }
    }

    const fromClient = targetVersionSchema.parse({ ...target, createdAt: new ClientTimestamp(1_790_000_000, 7) });
    const fromAdmin = targetVersionSchema.parse({ ...target, createdAt: new AdminTimestamp() });
    expect(fromClient.createdAt).toEqual({ seconds: 1_790_000_000, nanoseconds: 7 });
    expect(fromAdmin.createdAt).toEqual({ seconds: 1_790_000_000, nanoseconds: 7 });
    // An ISO string loses nothing a person sees, but it is not an instant here.
    expect(targetVersionSchema.safeParse({ ...target, createdAt: "2026-09-27T10:00:00Z" }).success).toBe(false);
    expect(targetVersionSchema.safeParse({ ...target, createdAt: { seconds: 1, nanoseconds: 1e9 } }).success).toBe(false);
  });
});

describe("NutritionUserState (NUT-08)", () => {
  const request = (n: number) => ({
    requestId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    operation: "setTarget",
    resultTargetVersionId: `tv-${n}`,
  });

  it.each(["revision", "recentRequests"])("requires %s: never defaulted", (field) => {
    const { [field as keyof typeof state]: _omit, ...without } = state;
    expect(nutritionUserStateSchema.safeParse(without).success).toBe(false);
  });

  it("starts at revision 1 and counts in whole numbers", () => {
    for (const bad of [0, -1, 1.5, "1"]) {
      expect(nutritionUserStateSchema.safeParse({ ...state, revision: bad }).success).toBe(false);
    }
  });

  it(`keeps at most ${NUTRITION_STATE_REQUEST_LEDGER_SIZE} requests, each once`, () => {
    const full = Array.from({ length: NUTRITION_STATE_REQUEST_LEDGER_SIZE }, (_, index) => request(index + 1));
    const revision = 100;
    expect(nutritionUserStateSchema.safeParse({ ...state, revision, recentRequests: full }).success).toBe(true);
    expect(
      nutritionUserStateSchema.safeParse({ ...state, revision, recentRequests: [...full, request(99)] }).success
    ).toBe(false);
    expect(nutritionUserStateSchema.safeParse({ ...state, revision, recentRequests: [request(1), request(1)] }).success).toBe(
      false
    );
  });

  it("never records more requests than the revision applied", () => {
    expect(nutritionUserStateSchema.safeParse({ ...state, revision: 1, recentRequests: [request(1), request(2)] }).success).toBe(
      false
    );
  });

  it("records only known operations with a lower-case request id", () => {
    expect(nutritionUserStateSchema.safeParse({ ...state, recentRequests: [{ ...request(1), operation: "generate" }] }).success).toBe(
      false
    );
    expect(
      nutritionUserStateSchema.safeParse({
        ...state,
        recentRequests: [{ ...request(1), requestId: "3F2B8C1E-9A4D-4E6F-8B21-7C5D0E9A1B34" }],
      }).success
    ).toBe(false);
    expect(nutritionUserStateSchema.safeParse({ ...state, recentRequests: [{ ...request(1), extra: 1 }] }).success).toBe(false);
  });

  it("records setTarget and repeatPlan (NUT-09) in one ledger, each with its own result", () => {
    expect(NUTRITION_STATE_OPERATIONS).toEqual(["setTarget", "repeatPlan"]);
    const repeat = (n: number) => ({
      requestId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      operation: "repeatPlan",
      resultPlanId: `plan-${n}`,
    });
    const mixed = [request(1), repeat(2), request(3), repeat(4)];
    expect(nutritionUserStateSchema.safeParse({ ...state, revision: 9, recentRequests: mixed }).success).toBe(true);

    // Each operation names its own result, and only it.
    const crossed = [
      { ...repeat(2), resultTargetVersionId: "tv-2" },
      { requestId: repeat(2).requestId, operation: "repeatPlan", resultTargetVersionId: "tv-2" },
      { requestId: request(1).requestId, operation: "setTarget", resultPlanId: "plan-1" },
      { ...repeat(2), resultPlanId: "plan__2" },
    ];
    for (const entry of crossed) {
      expect(nutritionUserStateSchema.safeParse({ ...state, recentRequests: [entry] }).success, JSON.stringify(entry)).toBe(false);
    }
    // One request id is one request, whatever the operation.
    const clash = [request(1), { ...repeat(2), requestId: request(1).requestId }];
    expect(nutritionUserStateSchema.safeParse({ ...state, revision: 5, recentRequests: clash }).success).toBe(false);
  });

  it("counts revisions beyond the ledger: evicted records leave the revision as it is", () => {
    const full = Array.from({ length: NUTRITION_STATE_REQUEST_LEDGER_SIZE }, (_, index) => request(index + 1));
    expect(nutritionUserStateSchema.safeParse({ ...state, revision: 500, recentRequests: full }).success).toBe(true);
    expect(nutritionUserStateSchema.safeParse({ ...state, revision: 7, recentRequests: [] }).success).toBe(true);
  });

  it("is an infrastructure bound, the same size as the entry intent ring", () => {
    expect(NUTRITION_STATE_REQUEST_LEDGER_SIZE).toBe(20);
    expect(NUTRITION_STATE_REQUEST_LEDGER_SIZE).toBe(NUTRITION_ENTRY_INTENT_RING_SIZE);
  });
});
