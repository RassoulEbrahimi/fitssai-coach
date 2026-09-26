import { describe, it, expect } from "vitest";
import { FITNESS_GOALS } from "@shared/fitnessGoal";
import {
  BIOLOGICAL_SEXES,
  MEALS_PER_DAY_MAX,
  NUTRITION_ACTIVITY_LEVELS,
  NUTRITION_DIETARY_PREFERENCES,
  NUTRITION_SLOT_IDS,
  NUTRITION_TARGET_MODES,
  answeredValue,
  getNutritionEligibility,
  parseNutritionProfile,
} from "@shared/nutrition";

/** A profile as onboarding has written it for years: no Nutrition V2 fields. */
const legacyProfile = {
  fullName: "Mia",
  age: 31,
  weight: 72,
  height: 168,
  fitnessGoal: "gainMuscle",
  dietaryPreference: "highProtein",
  experienceLevel: "intermediate",
  equipment: ["dumbbells"],
  daysPerWeek: 4,
  sessionMinutes: 45,
  role: "user",
};

const eligibilityFor = (age: unknown) => getNutritionEligibility(parseNutritionProfile({ age }));

describe("Nutrition V2 eligibility", () => {
  it("is eligible at exactly 18", () => {
    expect(eligibilityFor(18)).toEqual({ eligible: true, reason: "eligible" });
  });

  it("is eligible above 18", () => {
    expect(eligibilityFor(19)).toEqual({ eligible: true, reason: "eligible" });
    expect(eligibilityFor(64)).toEqual({ eligible: true, reason: "eligible" });
  });

  it("is ineligible as a minor at 17 and below", () => {
    expect(eligibilityFor(17)).toEqual({ eligible: false, reason: "minor" });
    expect(eligibilityFor(13)).toEqual({ eligible: false, reason: "minor" });
    expect(eligibilityFor(17.9)).toEqual({ eligible: false, reason: "minor" });
  });

  it("is ineligible when the age is missing", () => {
    expect(getNutritionEligibility(parseNutritionProfile({}))).toEqual({ eligible: false, reason: "missingAge" });
    expect(getNutritionEligibility(parseNutritionProfile(null))).toEqual({ eligible: false, reason: "missingAge" });
    expect(getNutritionEligibility(parseNutritionProfile(undefined))).toEqual({
      eligible: false,
      reason: "missingAge",
    });
  });

  it("is ineligible when the age is null", () => {
    expect(eligibilityFor(null)).toEqual({ eligible: false, reason: "missingAge" });
  });

  it.each([["18"], ["adult"], [true], [0], [-20], [Number.NaN], [Number.POSITIVE_INFINITY], [{ years: 30 }], [[30]]])(
    "treats a malformed age (%j) as missing, never as adult",
    (age) => {
      expect(eligibilityFor(age)).toEqual({ eligible: false, reason: "missingAge" });
    }
  );
});

describe("parseNutritionProfile", () => {
  it("reads a legacy profile without any Nutrition V2 field", () => {
    const profile = parseNutritionProfile(legacyProfile);

    expect(profile.age).toEqual({ status: "answered", value: 31 });
    expect(profile.height).toEqual({ status: "answered", value: 168 });
    expect(profile.weight).toEqual({ status: "answered", value: 72 });
    expect(profile.fitnessGoal).toEqual({ status: "answered", value: "gainMuscle" });
    expect(profile.dietaryPreference).toEqual({ status: "answered", value: "highProtein" });
    // Absent stays absent: nothing is defaulted.
    expect(profile.biologicalSex).toEqual({ status: "missing" });
    expect(profile.activityLevel).toEqual({ status: "missing" });
    expect(profile.nutritionTargetMode).toEqual({ status: "missing" });
    expect(profile.manualTargetKcal).toEqual({ status: "missing" });
    expect(profile.mealsPerDay).toEqual({ status: "missing" });
  });

  it("does not read or expose food-category exclusions yet", () => {
    const profile = parseNutritionProfile({ ...legacyProfile, excludedFoodCategories: ["nuts"] });
    expect(Object.keys(profile)).not.toContain("excludedFoodCategories");
  });

  it("does not mutate the document it reads", () => {
    const raw = { ...legacyProfile, activityLevel: "Very active", biologicalSex: "M", fitnessGoal: " muscle_gain " };
    const before = structuredClone(raw);
    parseNutritionProfile(raw);
    expect(raw).toEqual(before);
  });

  describe("biologicalSex", () => {
    it.each(BIOLOGICAL_SEXES)("reads %s", (value) => {
      expect(parseNutritionProfile({ biologicalSex: value }).biologicalSex).toEqual({ status: "answered", value });
    });

    it.each([["M"], ["Female"], ["other"], [""], [1]])("tolerates %j as invalid, which is no answer", (value) => {
      const answer = parseNutritionProfile({ biologicalSex: value }).biologicalSex;
      expect(answer).toEqual({ status: "invalid" });
      expect(answeredValue(answer)).toBeNull();
    });
  });

  describe("fitnessGoal", () => {
    it.each(FITNESS_GOALS)("reads the canonical goal %s", (value) => {
      expect(parseNutritionProfile({ fitnessGoal: value }).fitnessGoal).toEqual({ status: "answered", value });
    });

    it.each([
      ["muscle_gain", "gainMuscle"],
      ["weight_loss", "loseFat"],
      ["endurance", "improveCardio"],
      ["maintenance", "maintain"],
      ["gain-muscle", "gainMuscle"],
      ["lose-fat", "loseFat"],
      ["improve-cardio", "improveCardio"],
    ] as const)("reads the historical spelling %s as %s", (stored, canonical) => {
      expect(parseNutritionProfile({ fitnessGoal: stored }).fitnessGoal).toEqual({
        status: "answered",
        value: canonical,
      });
    });

    it.each([[undefined], [null]])("reads %j as missing", (value) => {
      expect(parseNutritionProfile({ fitnessGoal: value }).fitnessGoal).toEqual({ status: "missing" });
    });

    it("reads a profile without the key as missing", () => {
      expect(parseNutritionProfile({ age: 30 }).fitnessGoal).toEqual({ status: "missing" });
    });

    it.each([["bulk"], ["GAINMUSCLE"], [""], ["constructor"], ["toString"], [3], [{}], [["gainMuscle"]]])(
      "reads the unknown value %j as invalid",
      (value) => {
        const answer = parseNutritionProfile({ fitnessGoal: value }).fitnessGoal;
        expect(answer).toEqual({ status: "invalid" });
        expect(answeredValue(answer)).toBeNull();
      }
    );

    it("leaves the stored historical spelling as it is", () => {
      const raw = { fitnessGoal: "weight_loss" };
      expect(parseNutritionProfile(raw).fitnessGoal).toEqual({ status: "answered", value: "loseFat" });
      expect(raw).toEqual({ fitnessGoal: "weight_loss" });
    });
  });

  describe("nutritionTargetMode", () => {
    it.each(NUTRITION_TARGET_MODES)("reads %s", (value) => {
      expect(parseNutritionProfile({ nutritionTargetMode: value }).nutritionTargetMode).toEqual({
        status: "answered",
        value,
      });
    });

    it.each([["auto"], ["Manual"], [""], [0]])("tolerates %j as invalid", (value) => {
      expect(parseNutritionProfile({ nutritionTargetMode: value }).nutritionTargetMode).toEqual({ status: "invalid" });
    });
  });

  describe("manualTargetKcal", () => {
    it.each([[2200], [1850.5], [1]])("accepts the positive finite number %j", (value) => {
      expect(parseNutritionProfile({ manualTargetKcal: value }).manualTargetKcal).toEqual({
        status: "answered",
        value,
      });
    });

    it.each([[0], [-1800], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY], ["2000"]])(
      "does not accept %j",
      (value) => {
        expect(parseNutritionProfile({ manualTargetKcal: value }).manualTargetKcal).toEqual({ status: "invalid" });
      }
    );
  });

  describe("mealsPerDay", () => {
    it("is bounded by the canonical slots, not by a nutritional rule", () => {
      expect(MEALS_PER_DAY_MAX).toBe(NUTRITION_SLOT_IDS.length);
    });

    it.each([[1], [2], [3], [4], [5]])("accepts %j", (value) => {
      expect(parseNutritionProfile({ mealsPerDay: value }).mealsPerDay).toEqual({ status: "answered", value });
    });

    it.each([[0], [6], [2.5], [-1], [Number.NaN], ["3"]])("does not accept %j", (value) => {
      expect(parseNutritionProfile({ mealsPerDay: value }).mealsPerDay).toEqual({ status: "invalid" });
    });
  });

  describe("activityLevel", () => {
    it.each(NUTRITION_ACTIVITY_LEVELS)("reads the Nutrition level %s", (value) => {
      expect(parseNutritionProfile({ activityLevel: value }).activityLevel).toEqual({ status: "answered", value });
    });

    it.each([["moderate"], ["Very active"], ["SEDENTARY"], ["sehr aktiv"], [3], [""]])(
      "does not turn the unknown stored value %j into an answer",
      (value) => {
        const answer = parseNutritionProfile({ activityLevel: value }).activityLevel;
        expect(answer).toEqual({ status: "invalid" });
        expect(answeredValue(answer)).toBeNull();
      }
    );

    it("reads a missing value as missing", () => {
      expect(parseNutritionProfile({ activityLevel: null }).activityLevel).toEqual({ status: "missing" });
    });
  });

  describe("dietaryPreference", () => {
    it("keeps the existing onboarding vocabulary exactly", () => {
      expect(NUTRITION_DIETARY_PREFERENCES).toEqual(["vegan", "vegetarian", "keto", "highProtein", "noPreference"]);
    });

    it.each(NUTRITION_DIETARY_PREFERENCES)("reads %s unchanged", (value) => {
      expect(parseNutritionProfile({ dietaryPreference: value }).dietaryPreference).toEqual({
        status: "answered",
        value,
      });
    });

    it("does not reinterpret a value outside that vocabulary", () => {
      expect(parseNutritionProfile({ dietaryPreference: "pescetarian" }).dietaryPreference).toEqual({
        status: "invalid",
      });
    });
  });

  it("reads height and weight structurally", () => {
    expect(parseNutritionProfile({ height: 0, weight: -3 })).toMatchObject({
      height: { status: "invalid" },
      weight: { status: "invalid" },
    });
  });
});
