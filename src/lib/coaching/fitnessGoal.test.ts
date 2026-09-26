import { describe, it, expect } from "vitest";
import {
  FITNESS_GOALS,
  FITNESS_GOAL_OPTIONS,
  fitnessGoalLabel,
  isFitnessGoal,
  normaliseFitnessGoal,
} from "./fitnessGoal";
import * as sharedFitnessGoal from "@shared/fitnessGoal";

describe("normaliseFitnessGoal", () => {
  it.each(FITNESS_GOALS)("maps the canonical value %s to itself", (goal) => {
    expect(normaliseFitnessGoal(goal)).toBe(goal);
  });

  it.each([
    ["muscle_gain", "gainMuscle"],
    ["weight_loss", "loseFat"],
    ["endurance", "improveCardio"],
    ["maintenance", "maintain"],
  ] as const)("maps the legacy profile value %s to %s", (legacy, canonical) => {
    expect(normaliseFitnessGoal(legacy)).toBe(canonical);
  });

  it.each([
    ["gain-muscle", "gainMuscle"],
    ["lose-fat", "loseFat"],
    ["improve-cardio", "improveCardio"],
  ] as const)("maps the kebab-case catalogue key %s to %s", (legacy, canonical) => {
    expect(normaliseFitnessGoal(legacy)).toBe(canonical);
  });

  it("is idempotent", () => {
    const once = normaliseFitnessGoal("muscle_gain");
    expect(normaliseFitnessGoal(once)).toBe("gainMuscle");
  });

  it("tolerates surrounding whitespace", () => {
    expect(normaliseFitnessGoal("  muscle_gain  ")).toBe("gainMuscle");
  });

  it.each([undefined, null, "", "  ", "bulk", "GAINMUSCLE", 42, {}, []])(
    "returns undefined for %s rather than guessing",
    (value) => {
      expect(normaliseFitnessGoal(value)).toBeUndefined();
    }
  );
});

describe("isFitnessGoal", () => {
  it("accepts only canonical values", () => {
    expect(isFitnessGoal("gainMuscle")).toBe(true);
    // A legacy value is storable but not canonical; it must be normalised first.
    expect(isFitnessGoal("muscle_gain")).toBe(false);
    expect(isFitnessGoal(undefined)).toBe(false);
  });
});

describe("fitnessGoalLabel", () => {
  it("labels canonical values in German", () => {
    expect(fitnessGoalLabel("gainMuscle")).toBe("Muskeln aufbauen");
    expect(fitnessGoalLabel("loseFat")).toBe("Fett verlieren");
    expect(fitnessGoalLabel("improveCardio")).toBe("Kardio verbessern");
    expect(fitnessGoalLabel("maintain")).toBe("Halten");
  });

  it("labels legacy values with the same German label", () => {
    // Regression: profiles carrying the canonical spelling used to render the
    // raw identifier, because the label map only covered the snake_case era.
    expect(fitnessGoalLabel("muscle_gain")).toBe(fitnessGoalLabel("gainMuscle"));
    expect(fitnessGoalLabel("weight_loss")).toBe(fitnessGoalLabel("loseFat"));
    expect(fitnessGoalLabel("endurance")).toBe(fitnessGoalLabel("improveCardio"));
    expect(fitnessGoalLabel("maintenance")).toBe(fitnessGoalLabel("maintain"));
  });

  it("returns null for an unknown value instead of echoing it", () => {
    expect(fitnessGoalLabel("bulk")).toBeNull();
    expect(fitnessGoalLabel(undefined)).toBeNull();
  });
});

describe("FITNESS_GOAL_OPTIONS", () => {
  it("offers only canonical values, so new writes are never legacy", () => {
    expect(FITNESS_GOAL_OPTIONS).toHaveLength(FITNESS_GOALS.length);
    FITNESS_GOAL_OPTIONS.forEach((option) => {
      expect(isFitnessGoal(option.value)).toBe(true);
      expect(option.label.length).toBeGreaterThan(0);
    });
  });
});

describe("shared extraction", () => {
  it("re-exports the one shared vocabulary and normaliser, not a copy", () => {
    expect(FITNESS_GOALS).toBe(sharedFitnessGoal.FITNESS_GOALS);
    expect(normaliseFitnessGoal).toBe(sharedFitnessGoal.normaliseFitnessGoal);
    expect(isFitnessGoal).toBe(sharedFitnessGoal.isFitnessGoal);
  });

  it("keeps the canonical vocabulary and its order", () => {
    expect(FITNESS_GOALS).toEqual(["gainMuscle", "loseFat", "improveCardio", "maintain"]);
  });

  it("keeps the select options exactly", () => {
    expect(FITNESS_GOAL_OPTIONS).toEqual([
      { value: "gainMuscle", label: "Muskeln aufbauen" },
      { value: "loseFat", label: "Fett verlieren" },
      { value: "improveCardio", label: "Kardio verbessern" },
      { value: "maintain", label: "Halten" },
    ]);
  });

  it("labels the kebab-case catalogue keys like their canonical goal", () => {
    expect(fitnessGoalLabel("gain-muscle")).toBe("Muskeln aufbauen");
    expect(fitnessGoalLabel("lose-fat")).toBe("Fett verlieren");
    expect(fitnessGoalLabel("improve-cardio")).toBe("Kardio verbessern");
  });
});
