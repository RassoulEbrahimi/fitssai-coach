import { describe, expect, it } from "vitest";
import { parseNutritionProfile } from "@shared/nutrition";
import { docToProfile, profileWriteFields, type Profile } from "@/hooks/queries/useProfile";
import {
  NUTRITION_PROFILE_FIELDS,
  NUTRITION_PROFILE_OPTIONS,
  getNutritionProfileCompleteness,
  initialNutritionProfileDraft,
  nutritionProfileCompletenessOf,
  planNutritionProfileSave,
  type NutritionProfileDraft,
} from "./profileCompletion";

/*
  NUT-12D.1: Nutrition profile completeness and the completion save, pure.
  Profiles are built with the app's own `docToProfile`, so every case starts
  from what the profile cache really holds for a stored document.
*/

const profileOf = (doc: Record<string, unknown>): Profile => docToProfile("alice", doc);

const LEGACY_DOC = {
  age: 30,
  height: 177,
  weight: 75,
  fitnessGoal: "loseFat",
  dietaryPreference: "vegetarian",
};

const COMPLETE_DOC = {
  ...LEGACY_DOC,
  biologicalSex: "female",
  activityLevel: "moderatelyActive",
  mealsPerDay: 3,
};

const draftOf = (doc: Record<string, unknown>, changes: Partial<NutritionProfileDraft> = {}): NutritionProfileDraft => ({
  ...initialNutritionProfileDraft(profileOf(doc)),
  ...changes,
});

describe("getNutritionProfileCompleteness", () => {
  it("covers exactly the eight Nutrition profile answers, never the target mode or a manual target", () => {
    expect(NUTRITION_PROFILE_FIELDS).toEqual([
      "age",
      "height",
      "weight",
      "fitnessGoal",
      "dietaryPreference",
      "biologicalSex",
      "activityLevel",
      "mealsPerDay",
    ]);
    // A manual target mode without kcal does not make a profile incomplete.
    expect(
      getNutritionProfileCompleteness(parseNutritionProfile({ ...COMPLETE_DOC, nutritionTargetMode: "manual", manualTargetKcal: null }))
    ).toEqual({ status: "complete" });
  });

  it("names the missing answers of a legacy account", () => {
    expect(getNutritionProfileCompleteness(parseNutritionProfile(LEGACY_DOC))).toEqual({
      status: "incomplete",
      missing: ["biologicalSex", "activityLevel", "mealsPerDay"],
      invalid: [],
    });
  });

  it("names every answer of an absent profile as missing", () => {
    expect(getNutritionProfileCompleteness(parseNutritionProfile(null))).toEqual({
      status: "incomplete",
      missing: [...NUTRITION_PROFILE_FIELDS],
      invalid: [],
    });
  });

  it("tells unrecognised stored values apart from missing ones, and infers nothing", () => {
    expect(
      getNutritionProfileCompleteness(
        parseNutritionProfile({ ...COMPLETE_DOC, activityLevel: "moderate", dietaryPreference: "no-preference", age: "30" })
      )
    ).toEqual({ status: "incomplete", missing: [], invalid: ["age", "dietaryPreference", "activityLevel"] });
  });

  it("accepts notSpecified and a historical goal spelling as answers", () => {
    expect(
      getNutritionProfileCompleteness(parseNutritionProfile({ ...COMPLETE_DOC, biologicalSex: "notSpecified", fitnessGoal: "weight_loss" }))
    ).toEqual({ status: "complete" });
  });

  it("reads the cached profile the same way as the stored document", () => {
    expect(nutritionProfileCompletenessOf(profileOf(COMPLETE_DOC))).toEqual({ status: "complete" });
    expect(nutritionProfileCompletenessOf(profileOf(LEGACY_DOC))).toEqual(getNutritionProfileCompleteness(parseNutritionProfile(LEGACY_DOC)));
    expect(nutritionProfileCompletenessOf(null).status).toBe("incomplete");
  });
});

describe("initialNutritionProfileDraft", () => {
  it("prefills every recognised answer and leaves the rest empty", () => {
    expect(initialNutritionProfileDraft(profileOf({ ...LEGACY_DOC, fitnessGoal: "muscle_gain", activityLevel: "moderate" }))).toEqual({
      age: "30",
      height: "177",
      weight: "75",
      fitnessGoal: "gainMuscle",
      dietaryPreference: "vegetarian",
      biologicalSex: "",
      activityLevel: "",
      mealsPerDay: "",
    });
  });

  it("offers exactly the recognised vocabularies", () => {
    expect(NUTRITION_PROFILE_OPTIONS.fitnessGoal).toEqual(["gainMuscle", "loseFat", "improveCardio", "maintain"]);
    expect(NUTRITION_PROFILE_OPTIONS.dietaryPreference).toEqual(["vegan", "vegetarian", "keto", "highProtein", "noPreference"]);
    expect(NUTRITION_PROFILE_OPTIONS.biologicalSex).toEqual(["female", "male", "notSpecified"]);
    expect(NUTRITION_PROFILE_OPTIONS.mealsPerDay).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("planNutritionProfileSave", () => {
  it("writes only the answers that were added", () => {
    const plan = planNutritionProfileSave(
      profileOf(LEGACY_DOC),
      draftOf(LEGACY_DOC, { biologicalSex: "notSpecified", activityLevel: "lightlyActive", mealsPerDay: 5 })
    );
    expect(plan).toEqual({ ok: true, changes: { biological_sex: "notSpecified", activity_level: "lightlyActive", meals_per_day: 5 } });
    if (!plan.ok) throw new Error("expected a plan");
    // Through the existing write path: the same document fields, and nothing else.
    expect(profileWriteFields(plan.changes)).toEqual({ biologicalSex: "notSpecified", activityLevel: "lightlyActive", mealsPerDay: 5 });
  });

  it("writes nothing when nothing changed, including a historical goal spelling left as it was", () => {
    const doc = { ...COMPLETE_DOC, fitnessGoal: "muscle_gain", weight: 75.5 };
    expect(planNutritionProfileSave(profileOf(doc), draftOf(doc))).toEqual({ ok: true, changes: {} });
  });

  it("writes a changed number, typed with a decimal comma or spaces", () => {
    expect(planNutritionProfileSave(profileOf(LEGACY_DOC), draftOf(LEGACY_DOC, { weight: " 80 ", age: "31,0" }))).toEqual({
      ok: true,
      changes: { age: 31, weight: 80 },
    });
  });

  it("refuses numbers outside onboarding's bounds, with onboarding's error codes", () => {
    expect(
      planNutritionProfileSave(profileOf(LEGACY_DOC), draftOf(LEGACY_DOC, { age: "12", height: "251", weight: "70,5" }))
    ).toEqual({ ok: false, errors: { age: "too_small", height: "too_big", weight: "invalid_type" } });
    expect(planNutritionProfileSave(profileOf(LEGACY_DOC), draftOf(LEGACY_DOC, { age: "dreißig" }))).toEqual({
      ok: false,
      errors: { age: "invalid" },
    });
  });

  it("never clears an answer: emptying one is refused, an empty open field stays open", () => {
    expect(planNutritionProfileSave(profileOf(LEGACY_DOC), draftOf(LEGACY_DOC, { height: "" }))).toEqual({
      ok: false,
      errors: { height: "required" },
    });
    expect(planNutritionProfileSave(profileOf({}), draftOf({}, { age: "40" }))).toEqual({ ok: true, changes: { age: 40 } });
  });

  it("leaves an unrecognised stored value untouched unless a new answer is chosen", () => {
    const doc = { ...COMPLETE_DOC, activityLevel: "moderate" };
    expect(planNutritionProfileSave(profileOf(doc), draftOf(doc))).toEqual({ ok: true, changes: {} });
    expect(planNutritionProfileSave(profileOf(doc), draftOf(doc, { activityLevel: "veryActive" }))).toEqual({
      ok: true,
      changes: { activity_level: "veryActive" },
    });
  });

  it("refuses a choice outside the recognised vocabulary", () => {
    const draft = draftOf(LEGACY_DOC, { biologicalSex: "other" as NutritionProfileDraft["biologicalSex"], mealsPerDay: 6 });
    expect(planNutritionProfileSave(profileOf(LEGACY_DOC), draft)).toEqual({
      ok: false,
      errors: { biologicalSex: "invalid", mealsPerDay: "invalid" },
    });
  });

  it("lets a minor correct the age, whatever Nutrition's own age gate says", () => {
    const doc = { ...COMPLETE_DOC, age: 16 };
    expect(planNutritionProfileSave(profileOf(doc), draftOf(doc, { age: "17" }))).toEqual({ ok: true, changes: { age: 17 } });
  });
});
