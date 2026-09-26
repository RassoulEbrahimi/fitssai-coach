import { describe, it, expect, vi } from "vitest";

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  Timestamp: class {},
}));
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { docToProfile, profileWriteFields } from "./useProfile";

/** A profile as onboarding has written it: no Nutrition V2 fields. */
const legacyDoc = {
  fullName: "Mia",
  age: 16,
  weight: 58,
  height: 165,
  fitnessGoal: "gainMuscle",
  dietaryPreference: "vegetarian",
  experienceLevel: "beginner",
  equipment: ["bodyweight"],
  daysPerWeek: 3,
  sessionMinutes: 30,
};

describe("docToProfile", () => {
  it("loads a profile without any Nutrition V2 field, every existing field as before", () => {
    expect(docToProfile("u1", legacyDoc)).toEqual({
      id: "u1",
      equipment: ["bodyweight"],
      daysPerWeek: 3,
      sessionMinutes: 30,
      full_name: "Mia",
      fitness_goal: "gainMuscle",
      dietary_preference: "vegetarian",
      experience_level: "beginner",
      activity_level: null,
      weight: 58,
      height: 165,
      // A minor still loads their profile; only Nutrition V2 gates on age.
      age: 16,
      avatar_path: null,
      role: "user",
      biological_sex: null,
      nutrition_target_mode: null,
      manual_target_kcal: null,
      meals_per_day: null,
      created_at: null,
      updated_at: null,
    });
  });

  it("exposes recognised Nutrition V2 answers", () => {
    expect(
      docToProfile("u1", {
        ...legacyDoc,
        biologicalSex: "female",
        nutritionTargetMode: "manual",
        manualTargetKcal: 2100,
        mealsPerDay: 4,
      })
    ).toMatchObject({
      biological_sex: "female",
      nutrition_target_mode: "manual",
      manual_target_kcal: 2100,
      meals_per_day: 4,
    });
  });

  it("reads invalid Nutrition V2 values as no answer instead of failing", () => {
    expect(
      docToProfile("u1", {
        ...legacyDoc,
        biologicalSex: "M",
        nutritionTargetMode: 7,
        manualTargetKcal: -1,
        mealsPerDay: 12,
      })
    ).toMatchObject({
      biological_sex: null,
      nutrition_target_mode: null,
      manual_target_kcal: null,
      meals_per_day: null,
    });
  });

  it("keeps legacy activityLevel and dietaryPreference exactly as stored", () => {
    const profile = docToProfile("u1", { ...legacyDoc, activityLevel: "Very active", dietaryPreference: "paleo" });
    expect(profile.activity_level).toBe("Very active");
    expect(profile.dietary_preference).toBe("paleo");
  });
});

describe("profileWriteFields", () => {
  it("writes exactly what onboarding supplies and no Nutrition V2 field", () => {
    const written = profileWriteFields({
      full_name: "Mia",
      age: 31,
      weight: 72,
      height: 168,
      fitness_goal: "gainMuscle",
      dietary_preference: "highProtein",
      experience_level: "intermediate",
      equipment: ["dumbbells", "bodyweight"],
      daysPerWeek: 4,
      sessionMinutes: 45,
    });

    expect(written).toEqual({
      fullName: "Mia",
      age: 31,
      weight: 72,
      height: 168,
      fitnessGoal: "gainMuscle",
      dietaryPreference: "highProtein",
      experienceLevel: "intermediate",
      equipment: ["dumbbells", "bodyweight"],
      daysPerWeek: 4,
      sessionMinutes: 45,
    });
    for (const key of ["biologicalSex", "nutritionTargetMode", "manualTargetKcal", "mealsPerDay", "excludedFoodCategories"]) {
      expect(written).not.toHaveProperty(key);
    }
  });

  it("writes Nutrition V2 fields only when supplied", () => {
    expect(profileWriteFields({ meals_per_day: 3 })).toEqual({ mealsPerDay: 3 });
    expect(
      profileWriteFields({
        biological_sex: "notSpecified",
        nutrition_target_mode: "calculated",
        manual_target_kcal: 1950,
        meals_per_day: 5,
      })
    ).toEqual({
      biologicalSex: "notSpecified",
      nutritionTargetMode: "calculated",
      manualTargetKcal: 1950,
      mealsPerDay: 5,
    });
  });

  it("clears a Nutrition V2 field only when given null explicitly", () => {
    expect(profileWriteFields({ manual_target_kcal: null })).toEqual({ manualTargetKcal: null });
    expect(profileWriteFields({ manual_target_kcal: undefined })).toEqual({});
  });

  it("refuses an invalid Nutrition V2 value before anything is written", () => {
    expect(() => profileWriteFields({ manual_target_kcal: 0 })).toThrow(RangeError);
    expect(() => profileWriteFields({ manual_target_kcal: Number.NaN })).toThrow(RangeError);
    expect(() => profileWriteFields({ meals_per_day: 6 })).toThrow(RangeError);
    expect(() => profileWriteFields({ biological_sex: "x" as never })).toThrow(RangeError);
    expect(() => profileWriteFields({ nutrition_target_mode: "auto" as never })).toThrow(RangeError);
  });

  it("writes legacy activityLevel and dietaryPreference as given, unnormalised", () => {
    expect(profileWriteFields({ activity_level: "Very active", dietary_preference: "keto" })).toEqual({
      activityLevel: "Very active",
      dietaryPreference: "keto",
    });
  });
});
