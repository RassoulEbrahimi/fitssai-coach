import { describe, it, expect } from "vitest";
import {
  GENERATION_REQUEST_KINDS,
  GENERATION_REQUEST_STATUSES,
  NUTRITION_PLAN_DAY_COUNT,
  NUTRITION_SCHEMA_VERSION,
  addNutritionDays,
  extraEntryId,
  generationRequestKindSchema,
  generationRequestStatusSchema,
  nutritionPlanSchema,
  nutritionUserStateSchema,
  nutritionValuesSchema,
  recordedEntrySchema,
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
};

const withDays = (days: unknown[]) => ({ ...plan, days });

const slotHead = {
  schemaVersion: 2,
  planId: "plan-1",
  date: "2026-10-25",
  slotId: "lunch",
  selection: { kind: "override", override: { source: "aiSuggestion", meal: { name: "Ofengemüse", values } } },
};

const state = {
  schemaVersion: 2,
  activePlanId: "plan-1",
  currentTargetVersionId: "tv-1",
  activeGenerationRequestId: null,
};

const UUID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";

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
  it("selects the base meal", () => {
    expect(slotHeadSchema.safeParse({ ...slotHead, selection: { kind: "base" } }).success).toBe(true);
  });

  it("accepts an override from another meal of the plan", () => {
    const fromPlan = {
      kind: "override",
      override: { source: "planMeal", sourceMealId: "m-2-2", meal: { name: "Linsen-Curry", values } },
    };
    expect(slotHeadSchema.safeParse({ ...slotHead, selection: fromPlan }).success).toBe(true);
    expect(
      slotHeadSchema.safeParse({
        ...slotHead,
        selection: { ...fromPlan, override: { ...fromPlan.override, sourceMealId: undefined } },
      }).success
    ).toBe(false);
  });

  it("rejects unknown override sources and shapes", () => {
    for (const override of [
      { source: "user", meal: { name: "x", values } },
      { source: "aiSuggestion" },
      { source: "aiSuggestion", meal: { name: "x", values }, sourceMealId: "m-1" },
    ]) {
      expect(slotHeadSchema.safeParse({ ...slotHead, selection: { kind: "override", override } }).success).toBe(false);
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

  it("custom basis none carries no estimate; userStated needs one", () => {
    const none = { ...customExtraEntry, estimateBasis: "none", nutritionEstimate: null };
    expect(recordedEntrySchema.safeParse(none).success).toBe(true);
    expect(
      recordedEntrySchema.safeParse({ ...none, nutritionEstimate: customExtraEntry.nutritionEstimate }).success
    ).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...customExtraEntry, nutritionEstimate: null }).success).toBe(false);
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
