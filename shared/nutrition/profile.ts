import { z } from "zod";
import { nutritionTargetModeSchema, type NutritionTargetMode } from "./contracts";
import { NUTRITION_SLOT_IDS } from "./identity";

/**
 * What Nutrition V2 reads from the profile document (`users/{uid}`), and who
 * may use Nutrition V2 at all.
 *
 * The profile document is shared with the rest of the app and holds values
 * from more than one era, so reading it never throws and never guesses. Every
 * field reads as one of:
 *
 *   answered  a value this contract recognises
 *   missing   no value stored (the key is absent, or `null`)
 *   invalid   something is stored, but it is not a value this contract
 *             recognises — for Nutrition that is still no answer
 *
 * Nothing is defaulted and nothing is rewritten: an absent field stays absent
 * until the person supplies it, and an unrecognised stored value is left in
 * the document untouched.
 *
 * Structure only. Nothing here encodes a target formula, a calorie bound or a
 * quality threshold — those belong to target policy. Not described here, on
 * purpose, because their vocabulary is not settled: food-category exclusions
 * and any redesign of the dietary-preference vocabulary.
 */

/* ------------------------------------------------------------------ *
 * Field states
 * ------------------------------------------------------------------ */

export type ProfileAnswer<T> =
  | { status: "answered"; value: T }
  | { status: "missing" }
  | { status: "invalid" };

export type ProfileAnswerStatus = ProfileAnswer<unknown>["status"];

/** The answered value, or `null` for both missing and invalid. */
export const answeredValue = <T>(answer: ProfileAnswer<T>): T | null =>
  answer.status === "answered" ? answer.value : null;

const readAnswer = <T>(raw: unknown, schema: z.ZodType<T>): ProfileAnswer<T> => {
  if (raw === undefined || raw === null) return { status: "missing" };
  const parsed = schema.safeParse(raw);
  return parsed.success ? { status: "answered", value: parsed.data } : { status: "invalid" };
};

/* ------------------------------------------------------------------ *
 * Field vocabularies
 * ------------------------------------------------------------------ */

/**
 * Biological sex, for a later deterministic target calculation only. Never
 * sent to an AI provider. `notSpecified` is a real answer: the person chose
 * not to say.
 */
export const BIOLOGICAL_SEXES = ["female", "male", "notSpecified"] as const;

export const biologicalSexSchema = z.enum(BIOLOGICAL_SEXES);

export type BiologicalSex = z.infer<typeof biologicalSexSchema>;

/**
 * A manually set daily calorie target: a finite number above zero. Deliberately
 * no lower or upper bound — those are target policy, not storage.
 */
export const manualTargetKcalSchema = z
  .number({ invalid_type_error: "must be a number" })
  .finite("must be finite")
  .positive("must be greater than zero");

/**
 * How many meals a day the person wants: a whole number from one up to the
 * number of canonical slots. Which slots those are is not decided here.
 */
export const MEALS_PER_DAY_MIN = 1;
export const MEALS_PER_DAY_MAX = NUTRITION_SLOT_IDS.length;

export const mealsPerDaySchema = z
  .number({ invalid_type_error: "must be a number" })
  .int("must be a whole number")
  .min(MEALS_PER_DAY_MIN)
  .max(MEALS_PER_DAY_MAX);

/**
 * Activity level as Nutrition understands it.
 *
 * `activityLevel` already exists on profile documents, but no current screen
 * sets it and nothing in the app defines its values, so whatever is stored is
 * of unknown origin. Only these exact ids count as an answer; anything else —
 * another spelling, another language, a number — reads as invalid and is left
 * in the document as it is.
 */
export const NUTRITION_ACTIVITY_LEVELS = [
  "sedentary",
  "lightlyActive",
  "moderatelyActive",
  "veryActive",
  "extremelyActive",
] as const;

export const nutritionActivityLevelSchema = z.enum(NUTRITION_ACTIVITY_LEVELS);

export type NutritionActivityLevel = z.infer<typeof nutritionActivityLevelSchema>;

/**
 * The dietary preferences onboarding offers today, read as they are. This
 * mirrors the existing vocabulary and does not redesign it.
 */
export const NUTRITION_DIETARY_PREFERENCES = ["vegan", "vegetarian", "keto", "highProtein", "noPreference"] as const;

export const nutritionDietaryPreferenceSchema = z.enum(NUTRITION_DIETARY_PREFERENCES);

export type NutritionDietaryPreference = z.infer<typeof nutritionDietaryPreferenceSchema>;

/** A body measurement or an age: a finite number above zero, unbounded here. */
const positiveNumberSchema = z.number().finite().positive();

/* ------------------------------------------------------------------ *
 * The Nutrition view of a profile
 * ------------------------------------------------------------------ */

export interface NutritionProfile {
  age: ProfileAnswer<number>;
  /** As stored; onboarding collects centimetres. */
  height: ProfileAnswer<number>;
  /** As stored; onboarding collects kilograms. */
  weight: ProfileAnswer<number>;
  biologicalSex: ProfileAnswer<BiologicalSex>;
  activityLevel: ProfileAnswer<NutritionActivityLevel>;
  dietaryPreference: ProfileAnswer<NutritionDietaryPreference>;
  /** The person's choice, in the target modes of `TargetVersion`. */
  nutritionTargetMode: ProfileAnswer<NutritionTargetMode>;
  manualTargetKcal: ProfileAnswer<number>;
  mealsPerDay: ProfileAnswer<number>;
}

/**
 * Read the Nutrition-relevant fields of a raw profile document.
 *
 * Accepts any historical document, including none at all, and never throws.
 */
export const parseNutritionProfile = (raw: Record<string, unknown> | null | undefined): NutritionProfile => {
  const doc = raw ?? {};
  return {
    age: readAnswer(doc.age, positiveNumberSchema),
    height: readAnswer(doc.height, positiveNumberSchema),
    weight: readAnswer(doc.weight, positiveNumberSchema),
    biologicalSex: readAnswer(doc.biologicalSex, biologicalSexSchema),
    activityLevel: readAnswer(doc.activityLevel, nutritionActivityLevelSchema),
    dietaryPreference: readAnswer(doc.dietaryPreference, nutritionDietaryPreferenceSchema),
    nutritionTargetMode: readAnswer(doc.nutritionTargetMode, nutritionTargetModeSchema),
    manualTargetKcal: readAnswer(doc.manualTargetKcal, manualTargetKcalSchema),
    mealsPerDay: readAnswer(doc.mealsPerDay, mealsPerDaySchema),
  };
};

/* ------------------------------------------------------------------ *
 * Eligibility
 * ------------------------------------------------------------------ */

/**
 * Nutrition V2 is for adults only. This gate is Nutrition's own: the app's
 * onboarding age policy is unchanged, and younger people keep using the rest
 * of the app.
 */
export const NUTRITION_MIN_AGE = 18;

export const NUTRITION_ELIGIBILITY_REASONS = ["eligible", "minor", "missingAge"] as const;

export type NutritionEligibilityReason = (typeof NUTRITION_ELIGIBILITY_REASONS)[number];

/** Reason codes, never display text; the UI decides what to say. */
export type NutritionEligibility =
  | { eligible: true; reason: "eligible" }
  | { eligible: false; reason: "minor" | "missingAge" };

/**
 * Whether the person may use Nutrition V2. An age that is missing or not a
 * usable number is `missingAge` — never assumed to be adult.
 */
export const getNutritionEligibility = (profile: Pick<NutritionProfile, "age">): NutritionEligibility => {
  if (profile.age.status !== "answered") return { eligible: false, reason: "missingAge" };
  return profile.age.value >= NUTRITION_MIN_AGE
    ? { eligible: true, reason: "eligible" }
    : { eligible: false, reason: "minor" };
};
