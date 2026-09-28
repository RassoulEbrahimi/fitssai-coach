import type { NutritionValues } from "../../../../shared/nutrition";
import type { PlanValidationInput, PlanValidationPolicy } from "./types";

/**
 * PlanValidationPolicy v1 (NUT-12C.1): `target-alignment` v1, the signed-off
 * rule for whether a structurally valid plan may be persisted for its target.
 *
 * It certifies TARGET ALIGNMENT only. It says nothing about how energy is
 * spread over meals, sugar, fibre, micronutrients, food quality, medical
 * suitability, allergens or whether a diet is followed correctly.
 *
 * A day's values are the sums over its planned meals. Every range is
 * inclusive and expressed in whole percent of the reference:
 *
 *   each day, against the TARGET        kcal 90–110, protein 90–120,
 *                                       fat 80–120, carbs 80–120
 *   the seven-day average, against it   kcal 95–105, protein 95–110,
 *                                       fat 90–110, carbs 90–110
 *   each day, its kcal against the      90–110
 *   energy of its own macros
 *   (protein·4 + carbs·4 + fat·9)
 *
 * Checks are multiplications, never divisions: `actual·100` against
 * `percent·reference`, and the week's average as `total·100` against
 * `percent·reference·days`. So a reference of zero admits exactly zero, and a
 * boundary value that is exact in binary (a whole-number target) is not moved
 * by rounding.
 *
 * Only the verdict leaves the policy. No ratio, reason or failing check is
 * returned, and so none is ever persisted.
 */

export const TARGET_ALIGNMENT_POLICY_ID = "target-alignment";
export const TARGET_ALIGNMENT_POLICY_VERSION = 1;

type Nutrient = keyof NutritionValues;

/** An inclusive range in whole percent of a reference. */
interface PercentRange {
  readonly min: number;
  readonly max: number;
}

export const DAILY_TARGET_RANGES: Readonly<Record<Nutrient, PercentRange>> = Object.freeze({
  kcal: Object.freeze({ min: 90, max: 110 }),
  proteinG: Object.freeze({ min: 90, max: 120 }),
  fatG: Object.freeze({ min: 80, max: 120 }),
  carbsG: Object.freeze({ min: 80, max: 120 }),
});

export const WEEKLY_AVERAGE_TARGET_RANGES: Readonly<Record<Nutrient, PercentRange>> = Object.freeze({
  kcal: Object.freeze({ min: 95, max: 105 }),
  proteinG: Object.freeze({ min: 95, max: 110 }),
  fatG: Object.freeze({ min: 90, max: 110 }),
  carbsG: Object.freeze({ min: 90, max: 110 }),
});

/** A day's kcal against the energy its own macros carry. */
export const DAILY_MACRO_ENERGY_RANGE: PercentRange = Object.freeze({ min: 90, max: 110 });

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

const NUTRIENTS: readonly Nutrient[] = ["kcal", "proteinG", "carbsG", "fatG"];

/** `actual` lies within `range` percent of `reference`, inclusive. */
const within = (actual: number, reference: number, range: PercentRange) =>
  actual * 100 >= range.min * reference && actual * 100 <= range.max * reference;

const macroEnergy = (values: NutritionValues) =>
  values.proteinG * KCAL_PER_G_PROTEIN + values.carbsG * KCAL_PER_G_CARBS + values.fatG * KCAL_PER_G_FAT;

const dayTotals = (meals: PlanValidationInput["plan"]["days"][number]["meals"]): NutritionValues => {
  const totals = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const meal of meals) for (const nutrient of NUTRIENTS) totals[nutrient] += meal.values[nutrient];
  return totals;
};

export const isAlignedWithTarget = ({ plan, target }: PlanValidationInput): boolean => {
  const days = plan.days.map((day) => dayTotals(day.meals));
  if (days.length === 0) return false;

  for (const day of days) {
    for (const nutrient of NUTRIENTS) {
      if (!within(day[nutrient], target.values[nutrient], DAILY_TARGET_RANGES[nutrient])) return false;
    }
    if (!within(day.kcal, macroEnergy(day), DAILY_MACRO_ENERGY_RANGE)) return false;
  }

  for (const nutrient of NUTRIENTS) {
    const total = days.reduce((sum, day) => sum + day[nutrient], 0);
    if (!within(total, target.values[nutrient] * days.length, WEEKLY_AVERAGE_TARGET_RANGES[nutrient])) return false;
  }
  return true;
};

export const TARGET_ALIGNMENT_POLICY_V1: PlanValidationPolicy = Object.freeze({
  id: TARGET_ALIGNMENT_POLICY_ID,
  version: TARGET_ALIGNMENT_POLICY_VERSION,
  validate: (input: PlanValidationInput) => (isAlignedWithTarget(input) ? { outcome: "accepted" } : { outcome: "rejected" }),
});
