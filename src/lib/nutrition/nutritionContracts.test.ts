import { describe, it, expect } from "vitest";
import {
  NUTRITION_SCHEMA_VERSION,
  generationRequestStatusSchema,
  generationRequestTypeSchema,
  nutritionPlanSchema,
  nutritionUserStateSchema,
  nutritionValuesSchema,
  recordedEntrySchema,
  slotHeadSchema,
  targetVersionSchema,
  extraEntryId,
  slotEntryId,
} from "@shared/nutrition";

const values = { kcal: 612.4, proteinG: 38.25, carbsG: 71.1, fatG: 17.333 };

const target = {
  schemaVersion: 2,
  targetVersionId: "tv-1",
  mode: "manual",
  values,
  effectiveFrom: "2026-10-01",
};

const plan = {
  schemaVersion: 2,
  planId: "plan-1",
  status: "active",
  targetVersionId: "tv-1",
  startDate: "2026-10-05",
  meals: [
    { slotId: "breakfast", name: "Haferflocken mit Beeren", values },
    { slotId: "lunch", name: "Linsen-Curry", values },
  ],
};

const slotHead = {
  schemaVersion: 2,
  planId: "plan-1",
  date: "2026-10-25",
  slotId: "lunch",
  selection: { kind: "override", override: { name: "Ofengemüse", values, origin: "user" } },
};

const state = {
  schemaVersion: 2,
  activePlanId: "plan-1",
  currentTargetVersionId: "tv-1",
  activeGenerationRequestId: null,
};

const UUID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";

const slotEntry = {
  schemaVersion: 2,
  entryId: slotEntryId("2026-10-25", "lunch"),
  kind: "slot",
  date: "2026-10-25",
  slotId: "lunch",
  planId: "plan-1",
  source: "baseMeal",
  name: "Linsen-Curry",
  estimateBasis: "planMealTimesPortion",
  portion: 1.5,
  nutritionEstimate: { kcal: 918.6, proteinG: 57.375, carbsG: 106.65, fatG: 25.9995 },
};

const extraEntry = {
  schemaVersion: 2,
  entryId: extraEntryId(UUID),
  kind: "extra",
  date: "2026-10-25",
  slotId: null,
  planId: null,
  source: "userDescribed",
  name: "Apfel",
  estimateBasis: "userStated",
  portion: null,
  nutritionEstimate: { kcal: 80, proteinG: null, carbsG: null, fatG: null },
};

const documents = [
  ["TargetVersion", targetVersionSchema, target],
  ["NutritionPlan", nutritionPlanSchema, plan],
  ["SlotHead", slotHeadSchema, slotHead],
  ["NutritionUserState", nutritionUserStateSchema, state],
  ["RecordedEntry (slot)", recordedEntrySchema, slotEntry],
  ["RecordedEntry (extra)", recordedEntrySchema, extraEntry],
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

describe("RecordedEntry estimate semantics", () => {
  it("keeps a null macro as unknown, not zero", () => {
    const parsed = recordedEntrySchema.parse(extraEntry);
    expect(parsed.nutritionEstimate).toEqual({ kcal: 80, proteinG: null, carbsG: null, fatG: null });
  });

  it("needs kcal whenever there is an estimate", () => {
    expect(
      recordedEntrySchema.safeParse({
        ...extraEntry,
        nutritionEstimate: { kcal: null, proteinG: 1, carbsG: 1, fatG: 1 },
      }).success
    ).toBe(false);
  });

  it("basis none carries no estimate", () => {
    const none = { ...extraEntry, estimateBasis: "none", nutritionEstimate: null };
    expect(recordedEntrySchema.safeParse(none).success).toBe(true);
    expect(recordedEntrySchema.safeParse({ ...none, nutritionEstimate: extraEntry.nutritionEstimate }).success).toBe(
      false
    );
  });

  it("basis userStated needs an estimate", () => {
    expect(recordedEntrySchema.safeParse({ ...extraEntry, nutritionEstimate: null }).success).toBe(false);
  });

  it("basis planMealTimesPortion needs all four values, a portion and a plan-backed source", () => {
    expect(
      recordedEntrySchema.safeParse({
        ...slotEntry,
        nutritionEstimate: { ...slotEntry.nutritionEstimate, fatG: null },
      }).success
    ).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...slotEntry, portion: null }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...slotEntry, portion: 0 }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...slotEntry, source: "userDescribed" }).success).toBe(false);
  });

  it("records a portion only for planMealTimesPortion", () => {
    expect(recordedEntrySchema.safeParse({ ...extraEntry, portion: 1 }).success).toBe(false);
  });

  it("rejects negative or non-finite estimates", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        recordedEntrySchema.safeParse({ ...extraEntry, nutritionEstimate: { ...extraEntry.nutritionEstimate, kcal: bad } })
          .success
      ).toBe(false);
      expect(
        recordedEntrySchema.safeParse({
          ...extraEntry,
          nutritionEstimate: { ...extraEntry.nutritionEstimate, proteinG: bad },
        }).success
      ).toBe(false);
    }
  });

  it("has no actualCalories field", () => {
    expect(recordedEntrySchema.safeParse({ ...extraEntry, actualCalories: 80 }).success).toBe(false);
  });
});

describe("RecordedEntry identity", () => {
  it("a slot entry's id must match its date and slot", () => {
    expect(recordedEntrySchema.safeParse({ ...slotEntry, entryId: "slot:2026-10-24:lunch" }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...slotEntry, entryId: "slot:2026-10-25:dinner" }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...slotEntry, slotId: null }).success).toBe(false);
  });

  it("an extra entry needs an extra:{uuid} id and no slot", () => {
    expect(recordedEntrySchema.safeParse({ ...extraEntry, entryId: slotEntryId("2026-10-25", "lunch") }).success).toBe(
      false
    );
    expect(recordedEntrySchema.safeParse({ ...extraEntry, entryId: "extra:not-a-uuid" }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...extraEntry, slotId: "snack" }).success).toBe(false);
  });

  it("a plan-backed source needs a planId and a slot entry", () => {
    expect(recordedEntrySchema.safeParse({ ...slotEntry, planId: null }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...extraEntry, source: "override", planId: "plan-1" }).success).toBe(
      false
    );
  });

  it("rejects malformed dates", () => {
    expect(recordedEntrySchema.safeParse({ ...extraEntry, date: "2026-02-30" }).success).toBe(false);
    expect(recordedEntrySchema.safeParse({ ...extraEntry, date: "25.10.2026" }).success).toBe(false);
  });
});

describe("plans, slots, targets and state", () => {
  it("a plan plans each slot at most once", () => {
    const twice = { ...plan, meals: [...plan.meals, { slotId: "lunch", name: "Nudeln", values }] };
    expect(nutritionPlanSchema.safeParse(twice).success).toBe(false);
  });

  it("rejects unknown slots, statuses and target modes", () => {
    expect(
      nutritionPlanSchema.safeParse({ ...plan, meals: [{ slotId: "Montag", name: "x", values }] }).success
    ).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...plan, status: "draft" }).success).toBe(false);
    expect(targetVersionSchema.safeParse({ ...target, mode: "auto" }).success).toBe(false);
  });

  it("rejects an empty meal name but sets no layout length limit", () => {
    expect(nutritionPlanSchema.safeParse({ ...plan, meals: [{ slotId: "lunch", name: "  ", values }] }).success).toBe(
      false
    );
    const longName = "Sehr ausführlich beschriebenes Gericht ".repeat(20);
    expect(
      nutritionPlanSchema.safeParse({ ...plan, meals: [{ slotId: "lunch", name: longName, values }] }).success
    ).toBe(true);
  });

  it("a slot head selects the base meal or an override", () => {
    expect(slotHeadSchema.safeParse({ ...slotHead, selection: { kind: "base" } }).success).toBe(true);
    expect(slotHeadSchema.safeParse({ ...slotHead, selection: { kind: "override" } }).success).toBe(false);
    expect(slotHeadSchema.safeParse({ ...slotHead, selection: { kind: "skip" } }).success).toBe(false);
    expect(
      slotHeadSchema.safeParse({
        ...slotHead,
        selection: { kind: "override", override: { name: "x", values, origin: "ai" } },
      }).success
    ).toBe(false);
  });

  it("a slot head rejects malformed ids and dates", () => {
    expect(slotHeadSchema.safeParse({ ...slotHead, planId: "plan__1" }).success).toBe(false);
    expect(slotHeadSchema.safeParse({ ...slotHead, date: "2026-13-01" }).success).toBe(false);
  });

  it("validates generation request enums", () => {
    expect(generationRequestTypeSchema.safeParse("basePlan").success).toBe(true);
    expect(generationRequestTypeSchema.safeParse("recipe").success).toBe(false);
    expect(generationRequestStatusSchema.safeParse("succeeded").success).toBe(true);
    expect(generationRequestStatusSchema.safeParse("done").success).toBe(false);
  });

  it("state pointers are ids or null", () => {
    expect(nutritionUserStateSchema.safeParse({ ...state, activePlanId: "" }).success).toBe(false);
    expect(nutritionUserStateSchema.safeParse({ ...state, activePlanId: undefined }).success).toBe(false);
  });
});
