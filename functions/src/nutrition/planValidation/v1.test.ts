import { describe, it, expect } from "vitest";
import {
  NUTRITION_SCHEMA_VERSION,
  addNutritionDays,
  nutritionPlanContentSchema,
  type NutritionPlanContent,
  type NutritionSlotId,
  type NutritionValues,
  type TargetVersion,
} from "../../../../shared/nutrition";
import { NutritionPlanError } from "../errors";
import { decidePlanValidation } from "./decide";
import { PRODUCTION_PLAN_VALIDATION_POLICIES, productionPlanValidationPolicyRegistry } from "./registry";
import { TARGET_ALIGNMENT_POLICY_V1 } from "./v1";

/*
  NUT-12C.1: PlanValidationPolicy v1, `target-alignment` v1.

  The target is 2000 kcal, 125 g protein, 240 g carbs and 60 g fat, whose
  macro energy (500 + 960 + 540) is exactly 2000 kcal. Every boundary below
  is a whole-percent multiple of it that is exact in binary, so "at the
  boundary" is exact; "just inside" and "just outside" move by one part in a
  million of the reference — far above rounding, far below any real change.
  Each case moves one check to its edge while every other check stays well
  inside, so the verdict is that check's alone.
*/

const TARGET_VALUES: NutritionValues = { kcal: 2000, proteinG: 125, carbsG: 240, fatG: 60 };
const START = "2026-10-05";
const EPSILON = 1e-6;

const target = (values: NutritionValues = TARGET_VALUES): TargetVersion => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  targetVersionId: "target-1",
  mode: "manual",
  values,
  effectiveFrom: "2026-10-01",
  effectiveOrder: 1,
  policy: { id: "manual-target", version: 1 },
  profileFingerprint: { hash: "a".repeat(64), fields: ["fitnessGoal", "manualTargetKcal", "weight"] },
  supersedesTargetVersionId: null,
  createdAt: { seconds: 0, nanoseconds: 0 },
});

/** A structurally valid week; day `i` totals `days[i]`, split evenly over `slots`. */
const plan = (days: readonly NutritionValues[], slots: NutritionSlotId[] = ["dinner"]): NutritionPlanContent => {
  const content: NutritionPlanContent = {
    startDate: START,
    endDate: addNutritionDays(START, 6),
    slotOrder: slots,
    days: days.map((totals, dayIndex) => ({
      date: addNutritionDays(START, dayIndex),
      meals: slots.map((slotId, slotIndex) => ({
        mealId: `m-${dayIndex}-${slotIndex}`,
        slotId,
        name: `Mahlzeit ${dayIndex} ${slotIndex}`,
        values: {
          kcal: totals.kcal / slots.length,
          proteinG: totals.proteinG / slots.length,
          carbsG: totals.carbsG / slots.length,
          fatG: totals.fatG / slots.length,
        },
      })),
    })),
  };
  expect(nutritionPlanContentSchema.safeParse(content).success).toBe(true);
  return content;
};

/** Six on-target days and `first` as day one. */
const week = (first: NutritionValues) => [first, ...Array.from({ length: 6 }, () => ({ ...TARGET_VALUES }))];

/** Every day the same. */
const everyDay = (day: NutritionValues) => Array.from({ length: 7 }, () => ({ ...day }));

const verdict = (days: readonly NutritionValues[], values: NutritionValues = TARGET_VALUES) =>
  (TARGET_ALIGNMENT_POLICY_V1.validate({ plan: plan(days), target: target(values) }) as { outcome: string }).outcome;

/** A day scaled to `kcal`, its macros in proportion: every day-level ratio equal. */
const scaledTo = (kcal: number): NutritionValues => {
  const factor = kcal / TARGET_VALUES.kcal;
  return { kcal, proteinG: 125 * factor, carbsG: 240 * factor, fatG: 60 * factor };
};

/* ------------------------------------------------------------------ *
 * Identity and registration
 * ------------------------------------------------------------------ */

describe("provenance", () => {
  it("is target-alignment v1, the one production plan-validation policy", () => {
    expect(TARGET_ALIGNMENT_POLICY_V1.id).toBe("target-alignment");
    expect(TARGET_ALIGNMENT_POLICY_V1.version).toBe(1);
    expect(Object.isFrozen(TARGET_ALIGNMENT_POLICY_V1)).toBe(true);
    expect(PRODUCTION_PLAN_VALIDATION_POLICIES).toEqual([TARGET_ALIGNMENT_POLICY_V1]);
    expect(productionPlanValidationPolicyRegistry.current()).toBe(TARGET_ALIGNMENT_POLICY_V1);
  });

  it("persists only the provenance through the existing seam — no ratio, reason or detail", () => {
    const accepted = decidePlanValidation({
      policy: TARGET_ALIGNMENT_POLICY_V1,
      plan: plan(everyDay(TARGET_VALUES)),
      target: target(),
      reusable: null,
    });
    expect(accepted).toEqual({ policy: { id: "target-alignment", version: 1 }, outcome: "accepted" });
  });

  it("answers the existing rejected verdict, which the seam turns into PLAN_VALIDATION_FAILED", () => {
    const answer = TARGET_ALIGNMENT_POLICY_V1.validate({ plan: plan(everyDay(scaledTo(2500))), target: target() });
    expect(answer).toEqual({ outcome: "rejected" });

    let error: unknown;
    try {
      decidePlanValidation({ policy: TARGET_ALIGNMENT_POLICY_V1, plan: plan(everyDay(scaledTo(2500))), target: target(), reusable: null });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NutritionPlanError);
    expect((error as NutritionPlanError).code).toBe("PLAN_VALIDATION_FAILED");
    expect((error as NutritionPlanError).details).toEqual({});
  });

  it("accepts a week exactly on target, and sums a day over its meals", () => {
    expect(verdict(everyDay(TARGET_VALUES))).toBe("accepted");
    const split = TARGET_ALIGNMENT_POLICY_V1.validate({
      plan: plan(everyDay(TARGET_VALUES), ["breakfast", "lunch", "snack_1", "dinner"]),
      target: target(),
    });
    expect(split).toEqual({ outcome: "accepted" });
    // Four meals of a quarter each would be far off target if each were a day.
  });
});

/* ------------------------------------------------------------------ *
 * Daily alignment
 * ------------------------------------------------------------------ */

describe("daily alignment against the TARGET, inclusive", () => {
  const cases = [
    // [label, the edge day's values at the boundary, which way is outside]
    ["kcal at 90 %", scaledTo(1800), "kcal", -1],
    ["kcal at 110 %", scaledTo(2200), "kcal", +1],
    ["protein at 90 %", { ...TARGET_VALUES, proteinG: 112.5 }, "proteinG", -1],
    ["protein at 120 %", { ...TARGET_VALUES, proteinG: 150 }, "proteinG", +1],
    ["fat at 80 %", { ...TARGET_VALUES, fatG: 48 }, "fatG", -1],
    ["fat at 120 %", { ...TARGET_VALUES, fatG: 72 }, "fatG", +1],
    // Lower carbs lower the macro energy; 1900 kcal keeps the day within 10 % of it.
    ["carbs at 80 %", { ...TARGET_VALUES, kcal: 1900, carbsG: 192 }, "carbsG", -1],
    ["carbs at 120 %", { ...TARGET_VALUES, carbsG: 288 }, "carbsG", +1],
  ] as const;

  it.each(cases)("accepts %s", (_label, edge) => {
    expect(verdict(week(edge))).toBe("accepted");
  });

  it.each(cases)("accepts just inside %s", (_label, edge, nutrient, outward) => {
    const inside = { ...edge, [nutrient]: edge[nutrient] - outward * TARGET_VALUES[nutrient] * EPSILON };
    expect(verdict(week(inside))).toBe("accepted");
  });

  it.each(cases)("rejects just outside %s", (_label, edge, nutrient, outward) => {
    const outside = { ...edge, [nutrient]: edge[nutrient] + outward * TARGET_VALUES[nutrient] * EPSILON };
    expect(verdict(week(outside))).toBe("rejected");
  });

  it("checks every day, not only the first", () => {
    const days = everyDay(TARGET_VALUES);
    days[6] = { ...TARGET_VALUES, fatG: 72 + 1 };
    expect(verdict(days)).toBe("rejected");
  });
});

/* ------------------------------------------------------------------ *
 * Seven-day average
 * ------------------------------------------------------------------ */

describe("seven-day average alignment against the TARGET, inclusive", () => {
  // Every day the same, so the average is the day — and each day sits inside
  // its wider daily range and within 10 % of its own macro energy.
  const cases = [
    ["kcal at 95 %", { ...TARGET_VALUES, kcal: 1900 }, "kcal", -1],
    ["kcal at 105 %", { ...TARGET_VALUES, kcal: 2100 }, "kcal", +1],
    ["protein at 95 %", { ...TARGET_VALUES, proteinG: 118.75 }, "proteinG", -1],
    ["protein at 110 %", { ...TARGET_VALUES, proteinG: 137.5 }, "proteinG", +1],
    ["fat at 90 %", { ...TARGET_VALUES, fatG: 54 }, "fatG", -1],
    ["fat at 110 %", { ...TARGET_VALUES, fatG: 66 }, "fatG", +1],
    ["carbs at 90 %", { ...TARGET_VALUES, carbsG: 216 }, "carbsG", -1],
    ["carbs at 110 %", { ...TARGET_VALUES, carbsG: 264 }, "carbsG", +1],
  ] as const;

  it.each(cases)("accepts an average of %s", (_label, day) => {
    expect(verdict(everyDay(day))).toBe("accepted");
  });

  it.each(cases)("accepts an average just inside %s", (_label, day, nutrient, outward) => {
    expect(verdict(everyDay({ ...day, [nutrient]: day[nutrient] - outward * TARGET_VALUES[nutrient] * EPSILON }))).toBe("accepted");
  });

  it.each(cases)("rejects an average just outside %s, though every day passes its daily range", (_label, day, nutrient, outward) => {
    expect(verdict(everyDay({ ...day, [nutrient]: day[nutrient] + outward * TARGET_VALUES[nutrient] * EPSILON }))).toBe("rejected");
  });

  it("averages unequal days over the week", () => {
    // 3 × 2200 + 3 × 2000 + 2100 = 14700 = 7 × 2100: exactly 105 %.
    const days = [2200, 2200, 2200, 2000, 2000, 2000, 2100].map(scaledTo);
    expect(verdict(days)).toBe("accepted");
    days[6] = scaledTo(2100 + 2000 * EPSILON * 7);
    expect(verdict(days)).toBe("rejected");
  });
});

/* ------------------------------------------------------------------ *
 * Reported kcal against macro energy
 * ------------------------------------------------------------------ */

describe("each day's kcal within ±10 % of its macro energy, inclusive", () => {
  // Macro energy 1900 (carbs 215 g): kcal 2090 is 110 % of it, 104.5 % of target.
  const high = { kcal: 2090, proteinG: 125, carbsG: 215, fatG: 60 };
  // Macro energy 2180 (protein 145 g, carbs 265 g): kcal 1962 is 90 % of it, 98.1 % of target.
  const low = { kcal: 1962, proteinG: 145, carbsG: 265, fatG: 60 };

  it("accepts kcal at exactly 110 % and 90 % of the macro energy", () => {
    expect(verdict(week(high))).toBe("accepted");
    expect(verdict(week(low))).toBe("accepted");
  });

  it("accepts kcal just inside either bound", () => {
    expect(verdict(week({ ...high, kcal: 2090 - 1900 * EPSILON }))).toBe("accepted");
    expect(verdict(week({ ...low, kcal: 1962 + 2180 * EPSILON }))).toBe("accepted");
  });

  it("rejects kcal just outside either bound, though it is within the daily kcal range", () => {
    expect(verdict(week({ ...high, kcal: 2090 + 1900 * EPSILON }))).toBe("rejected");
    expect(verdict(week({ ...low, kcal: 1962 - 2180 * EPSILON }))).toBe("rejected");
  });

  it("uses 4 kcal/g for protein and carbs and 9 kcal/g for fat", () => {
    // Same grams, fat weighted as 4 instead of 9 would make 1900 → 1600 and reject.
    expect(verdict(week({ ...high, kcal: 1900 }))).toBe("accepted");
  });
});

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */

describe("edges", () => {
  it("a zero target value admits exactly zero, with no division", () => {
    // A manual-target v1 target can carry 0 g carbs when protein and fat use all the energy.
    const zeroCarbs = { kcal: 1200, proteinG: 225, carbsG: 0, fatG: 300 / 9 };
    expect(verdict(everyDay(zeroCarbs), zeroCarbs)).toBe("accepted");
    expect(verdict(week({ ...zeroCarbs, carbsG: 0.1 }), zeroCarbs)).toBe("rejected");
  });

  it("does not touch its input and answers the same every time", () => {
    const input = { plan: plan(week(scaledTo(2100))), target: target() };
    const before = structuredClone(input);
    expect(TARGET_ALIGNMENT_POLICY_V1.validate(input)).toEqual(TARGET_ALIGNMENT_POLICY_V1.validate(input));
    expect(input).toEqual(before);
  });

  it("answers the outcome and nothing else", () => {
    const answers = [
      TARGET_ALIGNMENT_POLICY_V1.validate({ plan: plan(everyDay(TARGET_VALUES)), target: target() }),
      TARGET_ALIGNMENT_POLICY_V1.validate({ plan: plan(everyDay(scaledTo(3000))), target: target() }),
    ];
    for (const answer of answers) expect(Object.keys(answer as object)).toEqual(["outcome"]);
  });
});
