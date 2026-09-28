import { describe, it, expect } from "vitest";
import { NUTRITION_SET_TARGET_ERROR_CODES, nutritionValuesSchema, type NutritionTargetProfileValues } from "../../../../shared/nutrition";
import { TargetInfeasibleError, type TargetPolicy } from "./types";
import {
  CALCULATED_TARGET_POLICY_V1,
  MANUAL_TARGET_POLICY_V1,
  TARGET_KCAL_MAX,
  TARGET_KCAL_MIN,
  deriveTargetValues,
} from "./v1";

/*
  NUT-12C.1: TargetPolicy v1, the signed-off constants.

  Expected values are worked by hand from the signed rule, not recomputed
  with the policy's own code. Values that are not exact in binary are
  compared to nine decimals; exact ones (manual kcal, boundaries) with `toBe`.
*/

type Profile = Partial<NutritionTargetProfileValues>;

const run = (policy: TargetPolicy, profile: Profile) =>
  policy.compute(Object.freeze({ mode: policy.mode, profile: Object.freeze({ ...profile }) })) as {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };

const refused = (policy: TargetPolicy, profile: Profile) => {
  try {
    run(policy, profile);
  } catch (error) {
    return error;
  }
  throw new Error("expected the policy to refuse");
};

/** Male, 30 y, 180 cm, 80 kg: RMR 10·80 + 6.25·180 − 5·30 + 5 = 1780. */
const MALE: Profile = { age: 30, height: 180, weight: 80, biologicalSex: "male", activityLevel: "moderatelyActive", fitnessGoal: "maintain" };

/** Female, 40 y, 165 cm, 60 kg: RMR 10·60 + 6.25·165 − 5·40 − 161 = 1270.25. */
const FEMALE: Profile = { age: 40, height: 165, weight: 60, biologicalSex: "female", activityLevel: "lightlyActive", fitnessGoal: "loseFat" };

const expectValues = (actual: ReturnType<typeof run>, expected: { kcal: number; proteinG: number; carbsG: number; fatG: number }) => {
  expect(actual.kcal).toBeCloseTo(expected.kcal, 9);
  expect(actual.proteinG).toBeCloseTo(expected.proteinG, 9);
  expect(actual.carbsG).toBeCloseTo(expected.carbsG, 9);
  expect(actual.fatG).toBeCloseTo(expected.fatG, 9);
  expect(nutritionValuesSchema.safeParse(actual).success).toBe(true);
  // Macro energy adds up to the target: protein and carbs at 4, fat at 9.
  expect(actual.proteinG * 4 + actual.carbsG * 4 + actual.fatG * 9).toBeCloseTo(actual.kcal, 9);
};

/* ------------------------------------------------------------------ *
 * Provenance and inputs
 * ------------------------------------------------------------------ */

describe("provenance", () => {
  it("has stable ids and versions, one policy per mode", () => {
    expect([CALCULATED_TARGET_POLICY_V1.id, CALCULATED_TARGET_POLICY_V1.version, CALCULATED_TARGET_POLICY_V1.mode]).toEqual([
      "calculated-target",
      1,
      "calculated",
    ]);
    expect([MANUAL_TARGET_POLICY_V1.id, MANUAL_TARGET_POLICY_V1.version, MANUAL_TARGET_POLICY_V1.mode]).toEqual([
      "manual-target",
      1,
      "manual",
    ]);
    expect(Object.isFrozen(CALCULATED_TARGET_POLICY_V1)).toBe(true);
    expect(Object.isFrozen(MANUAL_TARGET_POLICY_V1)).toBe(true);
  });

  it("calculated reads exactly the fields its equation reads — not the target mode", () => {
    expect(CALCULATED_TARGET_POLICY_V1.requiredProfileFields).toEqual([
      "age",
      "height",
      "weight",
      "biologicalSex",
      "activityLevel",
      "fitnessGoal",
    ]);
    expect(Object.isFrozen(CALCULATED_TARGET_POLICY_V1.requiredProfileFields)).toBe(true);
  });

  it("manual reads its kcal, weight and goal — not sex, activity, age or the target mode", () => {
    expect(MANUAL_TARGET_POLICY_V1.requiredProfileFields).toEqual(["manualTargetKcal", "weight", "fitnessGoal"]);
    expect(Object.isFrozen(MANUAL_TARGET_POLICY_V1.requiredProfileFields)).toBe(true);
  });

  it("adds exactly one deliberate refusal code to the target contract", () => {
    expect(NUTRITION_SET_TARGET_ERROR_CODES).toEqual([
      "UNAUTHENTICATED",
      "INVALID_REQUEST",
      "NOT_ELIGIBLE",
      "TARGET_POLICY_NOT_CONFIGURED",
      "PROFILE_INCOMPLETE",
      "TARGET_INFEASIBLE",
      "INTERNAL",
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Calculated
 * ------------------------------------------------------------------ */

describe("calculated-target v1", () => {
  it("computes a representative male target (moderately active, maintain)", () => {
    // 1780 × 1.55 = 2759 kcal; protein 80 × 1.6 = 128 g; fat 2759 × 0.25 / 9;
    // carbs (2759 − 512 − 689.75) / 4 = 389.3125 g.
    expectValues(run(CALCULATED_TARGET_POLICY_V1, MALE), { kcal: 2759, proteinG: 128, carbsG: 389.3125, fatG: 689.75 / 9 });
  });

  it("computes a representative female target (lightly active, lose fat)", () => {
    // 1270.25 × 1.375 = 1746.59375; × 0.85 = 1484.6046875 kcal; protein
    // 60 × 1.8 = 108 g; fat 371.151171875 / 9; carbs 681.453515625 / 4.
    expectValues(run(CALCULATED_TARGET_POLICY_V1, FEMALE), {
      kcal: 1484.6046875,
      proteinG: 108,
      carbsG: 170.36337890625,
      fatG: 371.151171875 / 9,
    });
  });

  it("uses −161 for female and +5 for male, and nothing in between", () => {
    const female = run(CALCULATED_TARGET_POLICY_V1, { ...MALE, biologicalSex: "female" });
    const male = run(CALCULATED_TARGET_POLICY_V1, MALE);
    // (1780 − 166) × 1.55 = 2501.7
    expect(female.kcal).toBeCloseTo(2501.7, 9);
    expect(male.kcal - female.kcal).toBeCloseTo(166 * 1.55, 9);
  });

  it.each([
    ["sedentary", 1.2, 2136],
    ["lightlyActive", 1.375, 2447.5],
    ["moderatelyActive", 1.55, 2759],
    ["veryActive", 1.725, 3070.5],
    ["extremelyActive", 1.9, 3382],
  ] as const)("multiplies resting energy by the %s factor %s", (activityLevel, _factor, kcal) => {
    const values = run(CALCULATED_TARGET_POLICY_V1, { ...MALE, activityLevel });
    expectValues(values, { kcal, proteinG: 128, carbsG: (kcal * 0.75 - 512) / 4, fatG: (kcal * 0.25) / 9 });
  });

  it.each([
    ["loseFat", -0.15, 2345.15, 144],
    ["gainMuscle", 0.1, 3034.9, 144],
    ["maintain", 0, 2759, 128],
    ["improveCardio", 0, 2759, 128],
  ] as const)("adjusts %s by %s and sets protein by its rule", (fitnessGoal, _adjustment, kcal, proteinG) => {
    const values = run(CALCULATED_TARGET_POLICY_V1, { ...MALE, fitnessGoal });
    expectValues(values, { kcal, proteinG, carbsG: (kcal * 0.75 - proteinG * 4) / 4, fatG: (kcal * 0.25) / 9 });
  });

  it("refuses biological sex notSpecified: no neutral equation and no stand-in", () => {
    const error = refused(CALCULATED_TARGET_POLICY_V1, { ...MALE, biologicalSex: "notSpecified" });
    expect(error).toBeInstanceOf(TargetInfeasibleError);
  });

  it("accepts a result at the 1200 kcal boundary and refuses one just below it", () => {
    // Male, 101 y, 160 cm, 50 kg: RMR 500 + 1000 − 505 + 5 = 1000; × 1.2 = 1200.
    const edge: Profile = { age: 101, height: 160, weight: 50, biologicalSex: "male", activityLevel: "sedentary", fitnessGoal: "maintain" };
    expect(run(CALCULATED_TARGET_POLICY_V1, edge).kcal).toBeCloseTo(1200, 9);
    // 0.1 y older: RMR 999.5 → 1199.4 kcal. Refused, never clamped to 1200.
    expect(refused(CALCULATED_TARGET_POLICY_V1, { ...edge, age: 101.1 })).toBeInstanceOf(TargetInfeasibleError);
  });

  it("accepts a result at the 6000 kcal boundary and refuses one just above it", () => {
    // Male, 51 y, 200 cm, 400 kg: RMR 4000 + 1250 − 255 + 5 = 5000; × 1.2 = 6000.
    const edge: Profile = { age: 51, height: 200, weight: 400, biologicalSex: "male", activityLevel: "sedentary", fitnessGoal: "maintain" };
    expect(run(CALCULATED_TARGET_POLICY_V1, edge).kcal).toBeCloseTo(6000, 9);
    // 0.1 y younger: RMR 5000.5 → 6000.6 kcal. Refused, never clamped to 6000.
    expect(refused(CALCULATED_TARGET_POLICY_V1, { ...edge, age: 50.9 })).toBeInstanceOf(TargetInfeasibleError);
  });

  it("refuses a target whose protein and fat leave negative carbohydrate energy", () => {
    // Female, 120 y, 100 cm, 200 kg, sedentary, lose fat: RMR 1864 → 1901.28
    // kcal (in range); protein 360 g = 1440 kcal, fat 475.32 kcal → −14.04.
    const heavy: Profile = { age: 120, height: 100, weight: 200, biologicalSex: "female", activityLevel: "sedentary", fitnessGoal: "loseFat" };
    expect(refused(CALCULATED_TARGET_POLICY_V1, heavy)).toBeInstanceOf(TargetInfeasibleError);
  });

  it("treats a missing required field as a wiring fault, not as infeasible", () => {
    const { activityLevel: _dropped, ...partial } = MALE;
    const error = refused(CALCULATED_TARGET_POLICY_V1, partial);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TargetInfeasibleError);
  });
});

/* ------------------------------------------------------------------ *
 * Manual
 * ------------------------------------------------------------------ */

describe("manual-target v1", () => {
  it("takes the answered kcal as the TARGET and derives the macros server-side", () => {
    // 2000 kcal, 70 kg, gain muscle: protein 126 g; fat 500 / 9; carbs
    // (2000 − 504 − 500) / 4 = 249 g.
    const values = run(MANUAL_TARGET_POLICY_V1, { manualTargetKcal: 2000, weight: 70, fitnessGoal: "gainMuscle" });
    expect(values.kcal).toBe(2000);
    expectValues(values, { kcal: 2000, proteinG: 126, carbsG: 249, fatG: 500 / 9 });
  });

  it("uses 1.6 g/kg protein for maintain and improveCardio", () => {
    for (const fitnessGoal of ["maintain", "improveCardio"] as const) {
      expect(run(MANUAL_TARGET_POLICY_V1, { manualTargetKcal: 2000, weight: 70, fitnessGoal }).proteinG).toBeCloseTo(112, 9);
    }
  });

  it("needs neither sex nor activity: a notSpecified person can set a manual target", () => {
    const values = run(MANUAL_TARGET_POLICY_V1, { manualTargetKcal: 1800, weight: 60, fitnessGoal: "loseFat", biologicalSex: "notSpecified" });
    expect(values.kcal).toBe(1800);
  });

  it.each([TARGET_KCAL_MIN, TARGET_KCAL_MAX])("accepts exactly %s kcal", (kcal) => {
    expect(run(MANUAL_TARGET_POLICY_V1, { manualTargetKcal: kcal, weight: 60, fitnessGoal: "maintain" }).kcal).toBe(kcal);
  });

  it.each([1199.999, 1199, 800, 6000.001, 6001, 9000])("refuses %s kcal instead of clamping", (kcal) => {
    const error = refused(MANUAL_TARGET_POLICY_V1, { manualTargetKcal: kcal, weight: 60, fitnessGoal: "maintain" });
    expect(error).toBeInstanceOf(TargetInfeasibleError);
  });

  it("refuses negative carbohydrate energy rather than producing 0 g carbs", () => {
    // 1200 kcal, 130 kg, lose fat: protein 234 g = 936 kcal, fat 300 kcal → −36.
    const error = refused(MANUAL_TARGET_POLICY_V1, { manualTargetKcal: 1200, weight: 130, fitnessGoal: "loseFat" });
    expect(error).toBeInstanceOf(TargetInfeasibleError);
  });

  it("keeps an exactly zero carbohydrate remainder: zero is computed, not clamped", () => {
    // 1200 kcal, 125 kg, lose fat: protein 225 g = 900 kcal, fat 300 kcal → 0.
    const values = run(MANUAL_TARGET_POLICY_V1, { manualTargetKcal: 1200, weight: 125, fitnessGoal: "loseFat" });
    expect(values).toEqual({ kcal: 1200, proteinG: 225, carbsG: 0, fatG: 300 / 9 });
  });
});

/* ------------------------------------------------------------------ *
 * Stored as computed
 * ------------------------------------------------------------------ */

describe("values are stored as computed", () => {
  it("neither rounds nor truncates", () => {
    const values = run(MANUAL_TARGET_POLICY_V1, { manualTargetKcal: 1950.5, weight: 68.25, fitnessGoal: "loseFat" });
    expect(values.kcal).toBe(1950.5);
    expect(values.fatG).toBe((1950.5 * 0.25) / 9);
    expect(Number.isInteger(values.fatG)).toBe(false);
    expect(Number.isInteger(values.carbsG)).toBe(false);
    expect(values.proteinG).toBeCloseTo(122.85, 12);
  });

  it("is deterministic and does not touch its input", () => {
    const profile = Object.freeze({ ...FEMALE });
    expect(run(CALCULATED_TARGET_POLICY_V1, profile)).toEqual(run(CALCULATED_TARGET_POLICY_V1, profile));
    expect(profile).toEqual(FEMALE);
  });

  it("refuses a non-finite TARGET kcal", () => {
    for (const kcal of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => deriveTargetValues(kcal, 70, "maintain")).toThrow(TargetInfeasibleError);
    }
  });
});
