import {
  BIOLOGICAL_SEXES,
  MEALS_PER_DAY_MAX,
  MEALS_PER_DAY_MIN,
  NUTRITION_ACTIVITY_LEVELS,
  NUTRITION_DIETARY_PREFERENCES,
  answeredValue,
  parseNutritionProfile,
  type BiologicalSex,
  type NutritionActivityLevel,
  type NutritionDietaryPreference,
  type NutritionProfile,
  type ProfileAnswer,
} from "@shared/nutrition";
import { FITNESS_GOALS, type FitnessGoal } from "@shared/fitnessGoal";
import type { Profile } from "@/hooks/queries/useProfile";
import { profileAgeSchema, profileHeightSchema, profileWeightSchema } from "@/lib/profileMeasurements";
import { parseNutritionNumberInput } from "./recording";
import { nutritionProfileOf } from "./targetSetup";

/**
 * The Nutrition PROFILE answers, pure: which of them an account has given,
 * and what a profile-completion save writes.
 *
 * These are profile answers, not a target: nothing here decides what a
 * target policy needs, and the target mode and a manual calorie target are
 * deliberately not part of it. Every answer is read by `parseNutritionProfile`
 * (NUT-03), so "answered" means exactly what Nutrition will later read as an
 * answer. Nothing is inferred and nothing is defaulted.
 *
 * The profile document (`users/{uid}`) is the only store. A save writes only
 * the answers that changed, through the existing profile save.
 */

export const NUTRITION_PROFILE_FIELDS = [
  "age",
  "height",
  "weight",
  "fitnessGoal",
  "dietaryPreference",
  "biologicalSex",
  "activityLevel",
  "mealsPerDay",
] as const;

export type NutritionProfileField = (typeof NUTRITION_PROFILE_FIELDS)[number];

export type NutritionProfileCompleteness =
  | { status: "complete" }
  | {
      status: "incomplete";
      /** No value stored. */
      missing: NutritionProfileField[];
      /** Something is stored, but it is not an answer Nutrition recognises. */
      invalid: NutritionProfileField[];
    };

/** Whether every Nutrition profile answer is given, and which are not. */
export const getNutritionProfileCompleteness = (profile: NutritionProfile): NutritionProfileCompleteness => {
  const missing: NutritionProfileField[] = [];
  const invalid: NutritionProfileField[] = [];
  for (const field of NUTRITION_PROFILE_FIELDS) {
    const status = profile[field].status;
    if (status === "missing") missing.push(field);
    else if (status === "invalid") invalid.push(field);
  }
  return missing.length === 0 && invalid.length === 0 ? { status: "complete" } : { status: "incomplete", missing, invalid };
};

/** The completeness of the app's cached profile. */
export const nutritionProfileCompletenessOf = (profile: Profile | null | undefined): NutritionProfileCompleteness =>
  getNutritionProfileCompleteness(nutritionProfileOf(profile));

/* ------------------------------------------------------------------ *
 * The completion form
 * ------------------------------------------------------------------ */

export const NUTRITION_PROFILE_NUMBER_FIELDS = ["age", "height", "weight"] as const;
export type NutritionProfileNumberField = (typeof NUTRITION_PROFILE_NUMBER_FIELDS)[number];

export const NUTRITION_MEALS_PER_DAY_OPTIONS: readonly number[] = Array.from(
  { length: MEALS_PER_DAY_MAX - MEALS_PER_DAY_MIN + 1 },
  (_, index) => MEALS_PER_DAY_MIN + index
);

/** The recognised answers of each choice field — the same vocabularies onboarding and NUT-03 use. */
export const NUTRITION_PROFILE_OPTIONS = {
  fitnessGoal: FITNESS_GOALS,
  dietaryPreference: NUTRITION_DIETARY_PREFERENCES,
  biologicalSex: BIOLOGICAL_SEXES,
  activityLevel: NUTRITION_ACTIVITY_LEVELS,
  mealsPerDay: NUTRITION_MEALS_PER_DAY_OPTIONS,
} as const;

export interface NutritionProfileDraft {
  age: string;
  height: string;
  weight: string;
  fitnessGoal: FitnessGoal | "";
  dietaryPreference: NutritionDietaryPreference | "";
  biologicalSex: BiologicalSex | "";
  activityLevel: NutritionActivityLevel | "";
  mealsPerDay: number | "";
}

const numberText = (value: number | null) => (value === null ? "" : String(value));

/** The form's starting point: every recognised answer, and nothing else. */
export const initialNutritionProfileDraft = (profile: Profile | null | undefined): NutritionProfileDraft => {
  const nutrition = nutritionProfileOf(profile);
  return {
    age: numberText(answeredValue(nutrition.age)),
    height: numberText(answeredValue(nutrition.height)),
    weight: numberText(answeredValue(nutrition.weight)),
    fitnessGoal: answeredValue(nutrition.fitnessGoal) ?? "",
    dietaryPreference: answeredValue(nutrition.dietaryPreference) ?? "",
    biologicalSex: answeredValue(nutrition.biologicalSex) ?? "",
    activityLevel: answeredValue(nutrition.activityLevel) ?? "",
    mealsPerDay: answeredValue(nutrition.mealsPerDay) ?? "",
  };
};

/**
 * Why a field cannot be saved. The number codes are onboarding's validation
 * keys (`onboarding.validation.{field}.{code}`), so both screens say the same.
 */
export type NutritionProfileFieldError = "required" | "invalid" | "invalid_type" | "too_small" | "too_big";

export type NutritionProfileSavePlan =
  | { ok: true; changes: Partial<Profile> }
  | { ok: false; errors: Partial<Record<NutritionProfileField, NutritionProfileFieldError>> };

/** Onboarding's bounds for the numbers a person types. */
const NUMBER_SCHEMAS = {
  age: profileAgeSchema,
  height: profileHeightSchema,
  weight: profileWeightSchema,
} as const;

/** The `Profile` key each field is saved under. */
const PROFILE_KEYS = {
  age: "age",
  height: "height",
  weight: "weight",
  fitnessGoal: "fitness_goal",
  dietaryPreference: "dietary_preference",
  biologicalSex: "biological_sex",
  activityLevel: "activity_level",
  mealsPerDay: "meals_per_day",
} as const satisfies Record<NutritionProfileField, keyof Profile>;

/** The profile document field NUT-03 reads each answer from. */
const DOCUMENT_KEYS = {
  age: "age",
  height: "height",
  weight: "weight",
  fitnessGoal: "fitnessGoal",
  dietaryPreference: "dietaryPreference",
  biologicalSex: "biologicalSex",
  activityLevel: "activityLevel",
  mealsPerDay: "mealsPerDay",
} as const satisfies Record<NutritionProfileField, string>;

/** Whether NUT-03 would read `value`, stored for `field`, as an answer. */
const isAnswer = (field: NutritionProfileField, value: unknown): boolean =>
  parseNutritionProfile({ [DOCUMENT_KEYS[field]]: value })[field].status === "answered";

const isNumberField = (field: NutritionProfileField): field is NutritionProfileNumberField =>
  (NUTRITION_PROFILE_NUMBER_FIELDS as readonly string[]).includes(field);

/**
 * The profile fields a completion save writes: only the answers that differ
 * from what the profile already answers.
 *
 * - An answer the person leaves as it was is neither written nor re-checked,
 *   even when it predates onboarding's bounds.
 * - A new or changed number must fit onboarding's bounds; a new choice must be
 *   one of its recognised values.
 * - An empty field that had no answer stays unanswered. Emptying a field that
 *   had one is refused rather than silently clearing it.
 *
 * Any error: nothing is saved.
 */
export const planNutritionProfileSave = (
  profile: Profile | null | undefined,
  draft: NutritionProfileDraft
): NutritionProfileSavePlan => {
  const current = nutritionProfileOf(profile);
  const changes: Partial<Profile> = {};
  const errors: Partial<Record<NutritionProfileField, NutritionProfileFieldError>> = {};

  for (const field of NUTRITION_PROFILE_FIELDS) {
    const previous = answeredValue(current[field] as ProfileAnswer<unknown>);
    const raw = draft[field];
    const empty = typeof raw === "string" && raw.trim() === "";
    if (empty) {
      if (previous !== null) errors[field] = "required";
      continue;
    }

    let value: unknown = raw;
    if (isNumberField(field)) {
      const parsed = parseNutritionNumberInput(raw as string);
      if (!parsed.valid || parsed.value === null) {
        errors[field] = "invalid";
        continue;
      }
      value = parsed.value;
      if (value === previous) continue;
      const checked = NUMBER_SCHEMAS[field].safeParse(value);
      if (!checked.success) {
        const code = checked.error.issues[0]?.code;
        errors[field] = code === "too_small" || code === "too_big" || code === "invalid_type" ? code : "invalid";
        continue;
      }
    } else if (value === previous) {
      continue;
    }

    if (!isAnswer(field, value)) {
      errors[field] = "invalid";
      continue;
    }
    (changes as Record<string, unknown>)[PROFILE_KEYS[field]] = value;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, changes };
};
