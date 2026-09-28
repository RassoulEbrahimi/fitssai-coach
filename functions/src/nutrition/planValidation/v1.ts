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
 * `percent·reference·days`. A reference of exactly zero admits exactly zero
 * and nothing else.
 *
 * Every bound is inclusive in exact arithmetic, but the numbers compared are
 * IEEE-754 doubles: a decimal such as 1235.315625 · 90 % lands a few units in
 * the last place either side of the exact product. So each comparison allows
 * `ROUNDOFF_SLACK` — a relative slack of machine size, scaled to the two sides
 * being compared — and nothing more. It widens no range in any meaningful
 * sense, and no value is ever rounded.
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

/**
 * The relative slack of one comparison: 64 · `Number.EPSILON` ≈ 1.4e-14.
 *
 * A side of a comparison is a sum of at most 35 non-negative values (five
 * meals a day for seven days), or three macro products, times one or two
 * factors. Each value is already a rounded decimal, and each addition or
 * multiplication adds at most half an epsilon of relative error. That is
 * under 40 half-epsilons a side, and the slack is 128. It is eight orders of
 * magnitude below one part in a million, so it absorbs representation error
 * only and changes no signed range.
 */
export const ROUNDOFF_SLACK = 64 * Number.EPSILON;

/** `a ≥ b`, allowing only the roundoff of the larger magnitude. */
const atLeast = (a: number, b: number) => a >= b - ROUNDOFF_SLACK * Math.max(Math.abs(a), Math.abs(b));

/** `a ≤ b`, allowing only the roundoff of the larger magnitude. */
const atMost = (a: number, b: number) => a <= b + ROUNDOFF_SLACK * Math.max(Math.abs(a), Math.abs(b));

/**
 * `actual` lies within `range` percent of `reference`, inclusive. A zero
 * reference is decided exactly: only zero lies within any percent of it, and
 * no slack is applied, so a positive value never passes against zero.
 */
const within = (actual: number, reference: number, range: PercentRange) => {
  if (reference === 0) return actual === 0;
  return atLeast(actual * 100, range.min * reference) && atMost(actual * 100, range.max * reference);
};

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
