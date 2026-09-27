import { describe, expect, it } from "vitest";
import type { Profile } from "@/hooks/queries/useProfile";
import { initialTargetSetupDraft, nutritionProfileOf, planTargetSetupSave, type TargetSetupDraft } from "./targetSetup";

/*
  NUT-08: the target setup's profile edits, validated with the NUT-03 reader
  and saved through the normal profile save. Only changed answers are saved;
  an empty field never clears one; nothing here decides which fields a target
  needs.
*/

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "alice",
  age: 34,
  height: 172.5,
  weight: 68.25,
  biological_sex: "female",
  activity_level: "moderatelyActive",
  fitness_goal: "lose-fat",
  nutrition_target_mode: "calculated",
  manual_target_kcal: 1950.5,
  dietary_preference: "vegan",
  ...overrides,
});

const draft = (overrides: Partial<TargetSetupDraft> = {}): TargetSetupDraft => ({
  ...initialTargetSetupDraft(profile()),
  ...overrides,
});

describe("the Nutrition view of the cached profile", () => {
  it("reads the same answers the server reads from the document", () => {
    const nutrition = nutritionProfileOf(profile({ activity_level: "sehr aktiv" }));
    expect(nutrition.height).toEqual({ status: "answered", value: 172.5 });
    expect(nutrition.fitnessGoal).toEqual({ status: "answered", value: "loseFat" });
    expect(nutrition.activityLevel).toEqual({ status: "invalid" });
    expect(nutritionProfileOf(null).age).toEqual({ status: "missing" });
  });
});

describe("the setup draft", () => {
  it("starts from the answered profile values", () => {
    expect(initialTargetSetupDraft(profile())).toEqual({
      mode: "calculated",
      height: "172.5",
      weight: "68.25",
      biologicalSex: "female",
      activityLevel: "moderatelyActive",
      fitnessGoal: "loseFat",
      manualTargetKcal: "1950.5",
    });
  });

  it("leaves unanswered and unrecognised values empty rather than guessing", () => {
    expect(
      initialTargetSetupDraft(profile({ height: null, activity_level: "sehr aktiv", nutrition_target_mode: null }))
    ).toMatchObject({ mode: "calculated", height: "", activityLevel: "" });
  });
});

describe("planning the profile save", () => {
  it("saves nothing when nothing changed", () => {
    expect(planTargetSetupSave(profile(), draft())).toEqual({ ok: true, changes: {} });
  });

  it("saves only the fields that changed, in profile terms", () => {
    expect(planTargetSetupSave(profile(), draft({ weight: "70,5", activityLevel: "veryActive" }))).toEqual({
      ok: true,
      changes: { weight: 70.5, activity_level: "veryActive" },
    });
  });

  it("keeps a stored legacy goal spelling that means the same goal", () => {
    expect(planTargetSetupSave(profile({ fitness_goal: "weight_loss" }), draft({ fitnessGoal: "loseFat" }))).toEqual({
      ok: true,
      changes: {},
    });
  });

  it("never clears an answer because a field was left empty", () => {
    expect(planTargetSetupSave(profile(), draft({ height: "", biologicalSex: "" }))).toEqual({ ok: true, changes: {} });
  });

  it("saves the chosen mode, and only the manual field in manual mode", () => {
    expect(planTargetSetupSave(profile(), draft({ mode: "manual", manualTargetKcal: "2100", weight: "99" }))).toEqual({
      ok: true,
      changes: { manual_target_kcal: 2100, nutrition_target_mode: "manual" },
    });
  });

  it.each([
    ["height", { height: "0" }],
    ["height", { height: "abc" }],
    ["weight", { weight: "-3" }],
    ["manualTargetKcal", { mode: "manual" as const, manualTargetKcal: "0" }],
  ])("refuses an invalid %s and saves nothing", (field, overrides) => {
    expect(planTargetSetupSave(profile(), draft(overrides))).toEqual({ ok: false, invalidFields: [field] });
  });

  it("introduces no bound of its own on a manual target", () => {
    // Bounds are unsigned target policy; the setup accepts any positive number the storage schema accepts.
    expect(planTargetSetupSave(profile(), draft({ mode: "manual", manualTargetKcal: "1" }))).toMatchObject({ ok: true });
    expect(planTargetSetupSave(profile(), draft({ mode: "manual", manualTargetKcal: "50000" }))).toMatchObject({ ok: true });
  });
});
