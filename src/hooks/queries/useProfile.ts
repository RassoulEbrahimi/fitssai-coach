import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import type { ZodType } from "zod";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import {
  parseCoachingPreferences,
  type CoachingPreferences,
} from "@/lib/coachingPreferences";
import { queryKeys } from "@/lib/queryKeys";
import {
  answeredValue,
  biologicalSexSchema,
  manualTargetKcalSchema,
  mealsPerDaySchema,
  nutritionTargetModeSchema,
  parseNutritionProfile,
  type BiologicalSex,
  type NutritionTargetMode,
} from "@shared/nutrition";

export interface Profile extends CoachingPreferences {
  id: string;
  email?: string;
  full_name?: string | null;
  avatar_path?: string | null;
  height?: number | null;
  weight?: number | null;
  fitness_goal?: string | null;
  activity_level?: string | null;
  experience_level?: string | null;
  age?: number | null;
  dietary_preference?: string | null;
  role?: string;
  /*
    Nutrition V2 answers. `null` until the person gives one; a stored value
    this build does not recognise also reads as `null` and is left in the
    document untouched. Nutrition reads its own view through
    `parseNutritionProfile`, which additionally tells the two apart.
  */
  biological_sex?: BiologicalSex | null;
  nutrition_target_mode?: NutritionTargetMode | null;
  manual_target_kcal?: number | null;
  meals_per_day?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** The Nutrition V2 answers as the profile exposes them: recognised, or `null`. */
const nutritionAnswers = (d: Record<string, unknown>) => {
  const nutrition = parseNutritionProfile(d);
  return {
    biological_sex:        answeredValue(nutrition.biologicalSex),
    nutrition_target_mode: answeredValue(nutrition.nutritionTargetMode),
    manual_target_kcal:    answeredValue(nutrition.manualTargetKcal),
    meals_per_day:         answeredValue(nutrition.mealsPerDay),
  };
};

export const docToProfile = (id: string, d: Record<string, any>): Profile => ({
  id,
  // Absent on every profile created before these questions existed. The parser
  // returns undefined rather than a default, so "never answered" stays
  // distinguishable from "answered".
  ...parseCoachingPreferences(d),
  full_name:          d.fullName           ?? null,
  fitness_goal:       d.fitnessGoal        ?? null,
  dietary_preference: d.dietaryPreference  ?? null,
  experience_level:   d.experienceLevel    ?? null,
  activity_level:     d.activityLevel      ?? null,
  weight:             d.weight             ?? null,
  height:             d.height             ?? null,
  age:                d.age                ?? null,
  avatar_path:        null,
  role:               d.role               ?? "user",
  ...nutritionAnswers(d),
  created_at: d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : null,
  updated_at: d.updatedAt instanceof Timestamp ? d.updatedAt.toDate().toISOString() : null,
});

/**
 * A supplied Nutrition answer must be one the contract accepts; `null` clears
 * it. Refused before anything is written, so a bad value can never land in the
 * document and then silently read back as "no answer".
 */
const checkedNutritionAnswer = <T>(field: string, value: T | null, schema: ZodType<T>): T | null => {
  if (value !== null && !schema.safeParse(value).success) {
    throw new RangeError(`Invalid profile value for ${field}`);
  }
  return value;
};

/**
 * The Firestore fields a profile save writes: exactly the fields supplied.
 * A field left `undefined` is not written, so a partial save never clears or
 * defaults anything it was not given.
 */
export const profileWriteFields = (values: Partial<Profile>): Record<string, unknown> => {
  const fsData: Record<string, unknown> = {};
  if (values.full_name          !== undefined) fsData.fullName          = values.full_name;
  if (values.fitness_goal       !== undefined) fsData.fitnessGoal       = values.fitness_goal;
  if (values.dietary_preference !== undefined) fsData.dietaryPreference = values.dietary_preference;
  if (values.experience_level   !== undefined) fsData.experienceLevel   = values.experience_level;
  if (values.activity_level     !== undefined) fsData.activityLevel     = values.activity_level;
  if (values.weight             !== undefined) fsData.weight            = values.weight;
  if (values.height             !== undefined) fsData.height            = values.height;
  if (values.age                !== undefined) fsData.age               = values.age;
  if (values.equipment          !== undefined) fsData.equipment         = values.equipment;
  if (values.daysPerWeek        !== undefined) fsData.daysPerWeek       = values.daysPerWeek;
  if (values.sessionMinutes     !== undefined) fsData.sessionMinutes    = values.sessionMinutes;
  if (values.biological_sex        !== undefined) fsData.biologicalSex       = checkedNutritionAnswer("biologicalSex", values.biological_sex, biologicalSexSchema);
  if (values.nutrition_target_mode !== undefined) fsData.nutritionTargetMode = checkedNutritionAnswer("nutritionTargetMode", values.nutrition_target_mode, nutritionTargetModeSchema);
  if (values.manual_target_kcal    !== undefined) fsData.manualTargetKcal    = checkedNutritionAnswer("manualTargetKcal", values.manual_target_kcal, manualTargetKcalSchema);
  if (values.meals_per_day         !== undefined) fsData.mealsPerDay         = checkedNutritionAnswer("mealsPerDay", values.meals_per_day, mealsPerDaySchema);
  return fsData;
};

export const useProfile = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.profile.me(user?.id),
    queryFn: async () => {
      if (!user) return null;
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) return null;
      return docToProfile(user.uid, snap.data() as Record<string, any>);
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 60,
  });
};

export const useUpdateProfile = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (values: Partial<Profile>) => {
      if (!user) throw new Error("Not authenticated");
      const fsData = { updatedAt: Timestamp.now(), ...profileWriteFields(values) };
      await setDoc(doc(db, "users", user.uid), fsData, { merge: true });
    },
    /*
      The cached profile is the only thing the UI reads, and it survives this
      write: it is kept fresh for an hour and persisted to localStorage, so a
      screen mounted right after a save — the dashboard, straight after
      onboarding — would otherwise render the pre-save entry (for a new user:
      null, i.e. every field a placeholder) until something else happened to
      refetch it.

      So write what was just saved into the cache before anything reads it,
      then invalidate so the next mount reconciles with the server. Seeding
      alone would leave the cache authoritative on a guess; invalidating alone
      would still render the pre-save entry while the refetch is in flight.
    */
    onSuccess: (_result, values) => {
      if (!user) return;
      const key = queryKeys.profile.me(user.id);

      queryClient.setQueryData<Profile | null>(key, (previous) => ({
        ...(previous ?? {}),
        ...values,
        id: user.uid,
      }));
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
};
