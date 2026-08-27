import { describe, it, expect } from "vitest";
import {
  DAYS_PER_WEEK,
  PLAN_TOTAL_WEEKS,
  PLAN_WEEK_KEYS,
  isRestDay,
  validateWorkoutPlanContent,
  workoutPlanContentSchema,
} from "../../shared/workoutPlan";
import { makeValidPlanContent, makeWeek } from "./plan.fixtures";

/*
  This schema is the gate a generated plan must pass before anything is
  persisted. Every test here is a way a model could get the programme wrong.
*/

describe("a valid plan", () => {
  it("accepts a real-shaped four-week plan", () => {
    const result = validateWorkoutPlanContent(makeValidPlanContent());

    expect(result.ok).toBe(true);
  });

  it("accepts a rest day as an empty exercise list", () => {
    const content = makeValidPlanContent();

    expect(isRestDay(content["Week 1"][1])).toBe(true);
    expect(validateWorkoutPlanContent(content).ok).toBe(true);
  });

  it("keeps fields a stored plan carries beyond the minimum contract", () => {
    const content = makeValidPlanContent();
    content["Week 1"][0].exercises[0].completed = true;
    content["Week 1"][0].exercises[0].notes = "schwer";

    const result = validateWorkoutPlanContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content["Week 1"][0].exercises[0].completed).toBe(true);
  });

  it("agrees with the constants the app already uses", () => {
    expect(PLAN_WEEK_KEYS).toHaveLength(PLAN_TOTAL_WEEKS);
    expect(makeWeek()).toHaveLength(DAYS_PER_WEEK);
  });
});

describe("week structure", () => {
  it("requires all four weeks", () => {
    const content = makeValidPlanContent();
    delete (content as Record<string, unknown>)["Week 3"];

    const result = validateWorkoutPlanContent(content);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.path === "Week 3")).toBe(true);
  });

  it("rejects a fifth week rather than silently dropping it", () => {
    const content = { ...makeValidPlanContent(), "Week 5": makeWeek() };

    const result = validateWorkoutPlanContent(content);

    expect(result.ok).toBe(false);
  });

  it("does not let an extra week survive into the parsed plan", () => {
    const parsed = workoutPlanContentSchema.safeParse({
      ...makeValidPlanContent(),
      "Week 5": makeWeek(),
    });

    // Strict mode refuses; nothing is returned that could then be persisted.
    expect(parsed.success).toBe(false);
    if (parsed.success) expect(Object.keys(parsed.data)).not.toContain("Week 5");
  });

  it.each([6, 8])("rejects a week with %i days", (dayCount) => {
    const content = makeValidPlanContent();
    const week = makeWeek();
    content["Week 2"] = (dayCount === 6 ? week.slice(0, 6) : [...week, week[0]]) as typeof week;

    expect(validateWorkoutPlanContent(content).ok).toBe(false);
  });
});

describe("exercise contract", () => {
  const withBadExercise = (exercise: unknown) => {
    const content = makeValidPlanContent();
    content["Week 1"][0].exercises = [exercise as never];
    return validateWorkoutPlanContent(content);
  };

  it.each([
    ["zero sets", { name: "Kniebeuge", sets: 0, reps: "10" }],
    ["negative sets", { name: "Kniebeuge", sets: -3, reps: "10" }],
    ["fractional sets", { name: "Kniebeuge", sets: 2.5, reps: "10" }],
    ["sets as a string", { name: "Kniebeuge", sets: "3", reps: "10" }],
    ["missing name", { sets: 3, reps: "10" }],
    ["empty name", { name: "   ", sets: 3, reps: "10" }],
    ["missing reps", { name: "Kniebeuge", sets: 3 }],
  ])("rejects %s", (_label, exercise) => {
    expect(withBadExercise(exercise).ok).toBe(false);
  });

  it("accepts a rep range, because real plans are written that way", () => {
    expect(withBadExercise({ name: "Kniebeuge", sets: 3, reps: "8-12" }).ok).toBe(true);
  });

  it("says what was wrong and where", () => {
    const result = withBadExercise({ name: "Kniebeuge", sets: 0, reps: "10" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].path).toBe("Week 1.0.exercises.0.sets");
    expect(result.issues[0].message).toMatch(/greater than zero/);
  });
});

describe("non-plans", () => {
  it.each([null, undefined, "plan", 42, [], { weeks: [] }])("rejects %j", (input) => {
    expect(validateWorkoutPlanContent(input).ok).toBe(false);
  });
});
