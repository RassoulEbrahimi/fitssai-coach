import { describe, it, expect } from "vitest";
import {
  impliedEquipment,
  maxExercisesForSession,
  validatePlanSemantics,
} from "./semanticValidation";
import type { PlanGenerationInput } from "./planGenerationInput";
import { DAYS_PER_WEEK, PLAN_WEEK_KEYS, type WorkoutPlanContent } from "../../../shared/workoutPlan";

/*
  Checks Zod cannot make. Four structurally perfect weeks of the wrong number
  of training days, or a barbell programme for somebody who owns a band, pass
  the schema without complaint.
*/

const INPUT: PlanGenerationInput = {
  goal: "gainMuscle",
  experienceLevel: "intermediate",
  equipment: ["dumbbells"],
  daysPerWeek: 3,
  sessionMinutes: 60,
};

const exercise = { name: "Kurzhantel-Rudern", sets: 3, reps: "8-12" };

const week = (trainingDays: number, ex = exercise) =>
  Array.from({ length: DAYS_PER_WEEK }, (_, index) => ({
    day: `Tag ${index + 1}`,
    exercises: index < trainingDays ? [ex] : [],
  }));

const plan = (trainingDays: number, ex = exercise): WorkoutPlanContent =>
  Object.fromEntries(
    PLAN_WEEK_KEYS.map((key) => [key, week(trainingDays, ex)])
  ) as unknown as WorkoutPlanContent;

describe("training-day consistency", () => {
  it("accepts a plan with the requested number of training days", () => {
    expect(validatePlanSemantics(plan(3), INPUT)).toEqual([]);
  });

  it.each([2, 4, 5])("rejects %i training days when three were requested", (days) => {
    const issues = validatePlanSemantics(plan(days), INPUT);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toMatch(/Trainingstage/);
  });

  it("rejects a week whose day labels repeat", () => {
    const content = plan(3);
    content["Week 1"] = content["Week 1"].map((day) => ({ ...day, day: "Montag" }));

    expect(validatePlanSemantics(content, INPUT).some((i) => /eindeutig/.test(i.message))).toBe(
      true
    );
  });
});

describe("equipment compatibility", () => {
  it("rejects an exercise needing equipment the user does not have", () => {
    const issues = validatePlanSemantics(
      plan(3, { name: "Langhantel-Kniebeuge", sets: 3, reps: "8" }),
      INPUT
    );

    expect(issues.some((i) => /barbell/.test(i.message))).toBe(true);
  });

  it("accepts anything when the user has a full gym", () => {
    const issues = validatePlanSemantics(
      plan(3, { name: "Langhantel-Kniebeuge", sets: 3, reps: "8" }),
      { ...INPUT, equipment: ["full_gym"] }
    );

    expect(issues).toEqual([]);
  });

  it("implies nothing from a name it does not recognise", () => {
    // Guessing that "Ausfallschritte" needs a barbell would reject a perfectly
    // good bodyweight plan, so unrecognised names imply nothing.
    expect(impliedEquipment("Ausfallschritte")).toBeNull();
    expect(validatePlanSemantics(plan(3, { name: "Ausfallschritte", sets: 3, reps: "10" }), {
      ...INPUT,
      equipment: ["bodyweight"],
    })).toEqual([]);
  });

  it("recognises the unambiguous German keywords", () => {
    expect(impliedEquipment("Klimmzüge")).toBe("pullup_bar");
    expect(impliedEquipment("Kabelzug-Rudern")).toBe("cable_machine");
    expect(impliedEquipment("Kettlebell-Swing")).toBe("kettlebell");
  });
});

describe("session-length plausibility", () => {
  it("is a broad upper bound, not a claim about duration", () => {
    // Roughly one exercise per five minutes cannot be right; a floor of three
    // keeps short sessions legal.
    expect(maxExercisesForSession(60)).toBe(12);
    expect(maxExercisesForSession(15)).toBe(3);
  });

  it("rejects a session with implausibly many exercises", () => {
    const many = Array.from({ length: 20 }, () => exercise);
    const content = plan(3);
    content["Week 1"][0] = { day: "Tag 1", exercises: many };

    expect(
      validatePlanSemantics(content, INPUT).some((i) => /Höchstens/.test(i.message))
    ).toBe(true);
  });

  it("accepts a normal session", () => {
    const content = plan(3);
    content["Week 1"][0] = { day: "Tag 1", exercises: [exercise, exercise, exercise, exercise] };

    expect(validatePlanSemantics(content, INPUT)).toEqual([]);
  });
});

describe("exercise sanity", () => {
  it("rejects an empty exercise name", () => {
    const issues = validatePlanSemantics(plan(3, { name: "   ", sets: 3, reps: "8" }), INPUT);

    expect(issues.some((i) => /Übungsname/.test(i.message))).toBe(true);
  });

  it("reports where the problem is", () => {
    const issues = validatePlanSemantics(plan(3, { name: "  ", sets: 3, reps: "8" }), INPUT);

    expect(issues[0].path).toMatch(/^Week 1\.\d+\.exercises\.\d+$/);
  });
});

describe("German plurals", () => {
  /*
    The first version of this list matched only singular stems, so "Klimmzüge"
    — the form a model actually writes — implied nothing, and a pull-up
    programme for someone with no bar passed the check.
  */
  it.each([
    ["Klimmzüge", "pullup_bar"],
    ["Klimmzug", "pullup_bar"],
    ["Widerstandsbänder-Rudern", "resistance_bands"],
    ["Kabelzüge", "cable_machine"],
    ["Bankdrücken", "barbell"],
    ["Latzüge", "machines"],
  ])("recognises %s", (name, expected) => {
    expect(impliedEquipment(name)).toBe(expected);
  });

  it("rejects a plural-named exercise the user cannot do", () => {
    const issues = validatePlanSemantics(
      plan(3, { name: "Klimmzüge", sets: 3, reps: "6-8" }),
      { ...INPUT, equipment: ["dumbbells"] }
    );

    expect(issues.some((i) => /pullup_bar/.test(i.message))).toBe(true);
  });
});
