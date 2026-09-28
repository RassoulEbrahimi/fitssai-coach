import type {
  NutritionActivityLevel,
  NutritionTargetProfileField,
  NutritionTargetProfileValues,
  NutritionValues,
} from "../../../../shared/nutrition";
import { TargetInfeasibleError, type TargetPolicy, type TargetPolicyInput } from "./types";

type FitnessGoal = NutritionTargetProfileValues["fitnessGoal"];

/**
 * TargetPolicy v1 (NUT-12C.1): the signed-off deterministic TARGET rules.
 *
 * Server-side only. Every constant of the rule lives here and nowhere else;
 * the browser neither computes nor checks a target.
 *
 * Calculated (`calculated-target` v1):
 *   resting energy   Mifflin–St Jeor, male or female
 *                      10·weightKg + 6.25·heightCm − 5·age + 5     (male)
 *                      10·weightKg + 6.25·heightCm − 5·age − 161   (female)
 *                    `notSpecified` has no equation, so no calculated target
 *   activity         × 1.20 / 1.375 / 1.55 / 1.725 / 1.90
 *   goal             loseFat −15 %, gainMuscle +10 %, maintain and
 *                    improveCardio ±0 %
 *
 * Manual (`manual-target` v1): the answered `manualTargetKcal` is the TARGET
 * kcal.
 *
 * Both modes then derive the macros the same way:
 *   protein   1.8 g per kg body weight for gainMuscle and loseFat,
 *             1.6 g per kg for maintain and improveCardio
 *   fat       25 % of the TARGET kcal, at 9 kcal/g
 *   carbs     the energy left after protein (4 kcal/g) and fat, at 4 kcal/g
 *
 * Feasibility, never clamped: the TARGET kcal must lie in 1200–6000 inclusive,
 * and the energy left for carbohydrate must not be negative. Anything else is
 * a `TargetInfeasibleError`. The values are stored as computed — no rounding
 * and no truncation; display rounding belongs to the reader.
 *
 * Age eligibility is the global NUT-03 adult rule, enforced by the handler
 * before any policy runs; it is not repeated here.
 */

export const CALCULATED_TARGET_POLICY_ID = "calculated-target";
export const MANUAL_TARGET_POLICY_ID = "manual-target";
export const TARGET_POLICY_V1_VERSION = 1;

/** The supported TARGET kcal per day, inclusive, for both modes. */
export const TARGET_KCAL_MIN = 1200;
export const TARGET_KCAL_MAX = 6000;

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

/** Share of the TARGET kcal that fat supplies. */
const FAT_ENERGY_SHARE = 0.25;

export const ACTIVITY_FACTORS: Readonly<Record<NutritionActivityLevel, number>> = Object.freeze({
  sedentary: 1.2,
  lightlyActive: 1.375,
  moderatelyActive: 1.55,
  veryActive: 1.725,
  extremelyActive: 1.9,
});

/** Relative change from maintenance energy, per goal. */
export const GOAL_ADJUSTMENTS: Readonly<Record<FitnessGoal, number>> = Object.freeze({
  loseFat: -0.15,
  gainMuscle: 0.1,
  maintain: 0,
  improveCardio: 0,
});

/** Grams of protein per kilogram of body weight, per goal. */
export const PROTEIN_G_PER_KG: Readonly<Record<FitnessGoal, number>> = Object.freeze({
  gainMuscle: 1.8,
  loseFat: 1.8,
  maintain: 1.6,
  improveCardio: 1.6,
});

/**
 * An answered field. The handler hands a policy exactly its answered required
 * fields, so a missing one is a wiring fault — an internal failure, never a
 * refusal of the person's answers.
 */
const answered = <F extends NutritionTargetProfileField>(
  profile: TargetPolicyInput["profile"],
  field: F
): NutritionTargetProfileValues[F] => {
  const value = profile[field];
  if (value === undefined || value === null) throw new Error(`target policy input lacks ${field}`);
  return value as NutritionTargetProfileValues[F];
};

/**
 * The four TARGET values for a TARGET kcal: the rule shared by both modes.
 * Exported for the policy tests only.
 */
export const deriveTargetValues = (kcal: number, weightKg: number, goal: FitnessGoal): NutritionValues => {
  if (!Number.isFinite(kcal) || kcal < TARGET_KCAL_MIN || kcal > TARGET_KCAL_MAX) throw new TargetInfeasibleError();

  const proteinG = weightKg * PROTEIN_G_PER_KG[goal];
  const fatKcal = kcal * FAT_ENERGY_SHARE;
  const carbsKcal = kcal - proteinG * KCAL_PER_G_PROTEIN - fatKcal;
  // Protein and fat already need more than the target: refused, never carbs 0.
  if (!Number.isFinite(carbsKcal) || carbsKcal < 0) throw new TargetInfeasibleError();

  return {
    kcal,
    proteinG,
    carbsG: carbsKcal / KCAL_PER_G_CARBS,
    fatG: fatKcal / KCAL_PER_G_FAT,
  };
};

const CALCULATED_FIELDS = Object.freeze([
  "age",
  "height",
  "weight",
  "biologicalSex",
  "activityLevel",
  "fitnessGoal",
] as const satisfies readonly NutritionTargetProfileField[]);

const MANUAL_FIELDS = Object.freeze([
  "manualTargetKcal",
  "weight",
  "fitnessGoal",
] as const satisfies readonly NutritionTargetProfileField[]);

/** Mifflin–St Jeor resting energy; `null` when the answer has no equation. */
const restingEnergy = (sex: NutritionTargetProfileValues["biologicalSex"], weightKg: number, heightCm: number, age: number) => {
  const shared = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === "male") return shared + 5;
  if (sex === "female") return shared - 161;
  return null;
};

export const CALCULATED_TARGET_POLICY_V1: TargetPolicy = Object.freeze({
  id: CALCULATED_TARGET_POLICY_ID,
  version: TARGET_POLICY_V1_VERSION,
  mode: "calculated" as const,
  requiredProfileFields: CALCULATED_FIELDS,
  compute: ({ profile }: TargetPolicyInput) => {
    const age = answered(profile, "age");
    const heightCm = answered(profile, "height");
    const weightKg = answered(profile, "weight");
    const sex = answered(profile, "biologicalSex");
    const activity = answered(profile, "activityLevel");
    const goal = answered(profile, "fitnessGoal");

    // No neutral equation, and neither sex stands in for the other.
    const resting = restingEnergy(sex, weightKg, heightCm, age);
    if (resting === null) throw new TargetInfeasibleError();

    const kcal = resting * ACTIVITY_FACTORS[activity] * (1 + GOAL_ADJUSTMENTS[goal]);
    return deriveTargetValues(kcal, weightKg, goal);
  },
});

export const MANUAL_TARGET_POLICY_V1: TargetPolicy = Object.freeze({
  id: MANUAL_TARGET_POLICY_ID,
  version: TARGET_POLICY_V1_VERSION,
  mode: "manual" as const,
  requiredProfileFields: MANUAL_FIELDS,
  compute: ({ profile }: TargetPolicyInput) =>
    deriveTargetValues(answered(profile, "manualTargetKcal"), answered(profile, "weight"), answered(profile, "fitnessGoal")),
});
