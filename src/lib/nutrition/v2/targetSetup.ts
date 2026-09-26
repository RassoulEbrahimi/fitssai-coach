import {
  BIOLOGICAL_SEXES,
  NUTRITION_ACTIVITY_LEVELS,
  answeredValue,
  parseNutritionProfile,
  type BiologicalSex,
  type NutritionActivityLevel,
  type NutritionProfile,
  type NutritionTargetMode,
  type ProfileAnswer,
} from "@shared/nutrition";
import { FITNESS_GOALS, type FitnessGoal } from "@shared/fitnessGoal";
import type { Profile } from "@/hooks/queries/useProfile";
import { parseNutritionNumberInput } from "./recording";

/**
 * The TARGET part of Nutrition setup, pure.
 *
 * The setup edits profile answers through the existing profile save
 * (`useUpdateProfile`, NUT-03) — there is no second profile store — and only
 * then asks the server for a target. The server reads the saved profile
 * itself; nothing built here is ever sent as a target input.
 *
 * Every answer is validated by `parseNutritionProfile`, the NUT-03 reader, so
 * the setup accepts exactly what Nutrition will later read as an answer. An
 * empty field is "leave as it is", never "clear": the setup does not decide
 * which fields a target needs — the server's policy does.
 */

/** The profile fields the setup offers, per mode. Not a statement of what a policy requires. */
export const TARGET_SETUP_FIELDS = {
  calculated: ["height", "weight", "biologicalSex", "activityLevel", "fitnessGoal"],
  manual: ["manualTargetKcal"],
} as const satisfies Record<NutritionTargetMode, readonly string[]>;

export type TargetSetupField = (typeof TARGET_SETUP_FIELDS)[NutritionTargetMode][number];

export interface TargetSetupDraft {
  mode: NutritionTargetMode;
  height: string;
  weight: string;
  biologicalSex: BiologicalSex | "";
  activityLevel: NutritionActivityLevel | "";
  fitnessGoal: FitnessGoal | "";
  manualTargetKcal: string;
}

export const TARGET_SETUP_OPTIONS = {
  biologicalSex: BIOLOGICAL_SEXES,
  activityLevel: NUTRITION_ACTIVITY_LEVELS,
  fitnessGoal: FITNESS_GOALS,
} as const;

/**
 * The profile document fields Nutrition reads, rebuilt from the app's cached
 * `Profile`. Its fields are the stored values (or `null`), so parsing this
 * gives the same answers as parsing `users/{uid}` itself.
 */
export const nutritionProfileDocument = (profile: Profile | null | undefined): Record<string, unknown> | null =>
  profile
    ? {
        age: profile.age,
        height: profile.height,
        weight: profile.weight,
        biologicalSex: profile.biological_sex,
        fitnessGoal: profile.fitness_goal,
        activityLevel: profile.activity_level,
        dietaryPreference: profile.dietary_preference,
        nutritionTargetMode: profile.nutrition_target_mode,
        manualTargetKcal: profile.manual_target_kcal,
        mealsPerDay: profile.meals_per_day,
      }
    : null;

/** The Nutrition view of the cached profile. */
export const nutritionProfileOf = (profile: Profile | null | undefined): NutritionProfile =>
  parseNutritionProfile(nutritionProfileDocument(profile));

const numberText = (value: number | null) => (value === null ? "" : String(value));

/** The setup's starting point: what the profile already answers. */
export const initialTargetSetupDraft = (profile: Profile | null | undefined): TargetSetupDraft => {
  const nutrition = nutritionProfileOf(profile);
  return {
    mode: answeredValue(nutrition.nutritionTargetMode) ?? "calculated",
    height: numberText(answeredValue(nutrition.height)),
    weight: numberText(answeredValue(nutrition.weight)),
    biologicalSex: answeredValue(nutrition.biologicalSex) ?? "",
    activityLevel: answeredValue(nutrition.activityLevel) ?? "",
    fitnessGoal: answeredValue(nutrition.fitnessGoal) ?? "",
    manualTargetKcal: numberText(answeredValue(nutrition.manualTargetKcal)),
  };
};

export type TargetSetupPlan =
  | { ok: true; changes: Partial<Profile> }
  | { ok: false; invalidFields: TargetSetupField[] };

/** A typed answer that NUT-03 reads back as `answered`, or `undefined`. */
const answeredAs = (field: string, value: unknown): unknown => {
  const answer = (parseNutritionProfile({ [field]: value }) as unknown as Record<string, { status: string }>)[field];
  return answer?.status === "answered" ? value : undefined;
};

/**
 * The profile fields to save for `draft`: the offered fields of its mode that
 * differ from the profile, plus the chosen mode. Invalid answers are reported
 * by name and nothing is saved.
 */
export const planTargetSetupSave = (profile: Profile | null | undefined, draft: TargetSetupDraft): TargetSetupPlan => {
  const current = nutritionProfileOf(profile);
  const changes: Partial<Profile> = {};
  const invalidFields: TargetSetupField[] = [];

  const read = (field: TargetSetupField): unknown => {
    const raw = draft[field];
    if (raw === "") return undefined;
    if (field === "height" || field === "weight" || field === "manualTargetKcal") {
      const parsed = parseNutritionNumberInput(raw);
      if (!parsed.valid || parsed.value === null) {
        invalidFields.push(field);
        return undefined;
      }
      return answeredAs(field, parsed.value) ?? (invalidFields.push(field), undefined);
    }
    return answeredAs(field, raw) ?? (invalidFields.push(field), undefined);
  };

  for (const field of TARGET_SETUP_FIELDS[draft.mode]) {
    const value = read(field);
    if (value === undefined || value === answeredValue(current[field] as ProfileAnswer<unknown>)) continue;
    switch (field) {
      case "height":
        changes.height = value as number;
        break;
      case "weight":
        changes.weight = value as number;
        break;
      case "biologicalSex":
        changes.biological_sex = value as BiologicalSex;
        break;
      case "activityLevel":
        changes.activity_level = value as NutritionActivityLevel;
        break;
      case "fitnessGoal":
        changes.fitness_goal = value as FitnessGoal;
        break;
      case "manualTargetKcal":
        changes.manual_target_kcal = value as number;
        break;
    }
  }

  if (invalidFields.length > 0) return { ok: false, invalidFields };
  if (answeredValue(current.nutritionTargetMode) !== draft.mode) changes.nutrition_target_mode = draft.mode;
  return { ok: true, changes };
};
