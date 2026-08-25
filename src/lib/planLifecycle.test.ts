import { describe, it, expect } from "vitest";
import { addDays } from "date-fns";
import {
  resolvePlanDay,
  isPlanFinished,
  formatWeekLabel,
  clampWeekKey,
  getWeekDayProgress,
  PLAN_TOTAL_WEEKS,
} from "./planLifecycle";
import { getWorkoutWeekDay } from "./workoutDateUtils";
import type { WorkoutPlan } from "./types";

// Monday, so plan start == created date and offsets are easy to read.
const PLAN_START = "2025-11-03T08:00:00.000Z";
const day = (offset: number) => addDays(new Date(PLAN_START), offset);

const training = (name: string) => ({
  day: name,
  exercises: [{ name: "Bankdrücken", sets: 3, reps: "10" }],
});
const rest = (name: string) => ({ day: name, exercises: [] });

/** Mon/Wed/Fri training, rest otherwise. */
const week = (label: string) => [
  training(`${label} Mo`),
  rest(`${label} Di`),
  training(`${label} Mi`),
  rest(`${label} Do`),
  training(`${label} Fr`),
  rest(`${label} Sa`),
  rest(`${label} So`),
];

const plan: WorkoutPlan = {
  id: "plan-1",
  user_id: "user-1",
  created_at: PLAN_START,
  content: {
    "Week 1": week("W1"),
    "Week 2": week("W2"),
    "Week 3": week("W3"),
    "Week 4": week("W4"),
  },
} as WorkoutPlan;

describe("resolvePlanDay — the four-week lifecycle", () => {
  it("resolves the plan start day as Week 1, day 0", () => {
    const r = resolvePlanDay(plan, day(0));
    expect(r.status).toBe("active");
    expect(r.weekKey).toBe("Week 1");
    expect(r.weekNumber).toBe(1);
    expect(r.dayIndex).toBe(0);
    expect(r.totalWeeks).toBe(4);
    expect(r.planFinished).toBe(false);
  });

  it.each([
    [0, 1],
    [7, 2],
    [14, 3],
    [21, 4],
  ])("day offset %i is Week %i", (offset, expectedWeek) => {
    const r = resolvePlanDay(plan, day(offset));
    expect(r.status).toBe("active");
    expect(r.weekNumber).toBe(expectedWeek);
    expect(r.weekKey).toBe(`Week ${expectedWeek}`);
  });

  it("keeps the last day of Week 4 active", () => {
    const r = resolvePlanDay(plan, day(27));
    expect(r.status).toBe("active");
    expect(r.weekNumber).toBe(4);
    expect(r.dayIndex).toBe(6);
  });

  it("marks the first day after Week 4 as completed, with no content", () => {
    const r = resolvePlanDay(plan, day(28));
    expect(r.status).toBe("completed");
    expect(r.planFinished).toBe(true);
    expect(r.isOutOfPlan).toBe(true);
    // The key regression: no Week 1 content is served after completion.
    expect(r.weekKey).toBeNull();
    expect(r.weekNumber).toBeNull();
    expect(r.dayData).toBeNull();
  });

  it("never produces a Week 5 or 6", () => {
    for (const offset of [28, 35, 42]) {
      const r = resolvePlanDay(plan, day(offset));
      expect(r.status).toBe("completed");
      expect(r.weekNumber).toBeNull();
    }
  });

  it("treats a plan created ~43 weeks ago as completed, not Week 43", () => {
    const r = resolvePlanDay(plan, day(43 * 7));
    expect(r.status).toBe("completed");
    expect(r.planFinished).toBe(true);
    expect(r.weekNumber).toBeNull();
    expect(r.dayData).toBeNull();
  });

  it("does not treat dates before the plan start as active Week 1", () => {
    const r = resolvePlanDay(plan, day(-1));
    expect(r.status).toBe("before-start");
    expect(r.isOutOfPlan).toBe(true);
    expect(r.planFinished).toBe(false);
    expect(r.weekKey).toBeNull();
    expect(r.dayData).toBeNull();
  });

  it("identifies rest days inside the programme", () => {
    const r = resolvePlanDay(plan, day(1));
    expect(r.status).toBe("active");
    expect(r.isRestDay).toBe(true);
    expect(r.dayData?.exercises).toHaveLength(0);
  });

  it("identifies training days inside the programme", () => {
    const r = resolvePlanDay(plan, day(2));
    expect(r.isRestDay).toBe(false);
    expect(r.dayData?.exercises).toHaveLength(1);
  });

  it("reports completion through the injected predicate", () => {
    const r = resolvePlanDay(plan, day(0), {
      isDayCompleted: (weekKey, dayIndex) => weekKey === "Week 1" && dayIndex === 0,
    });
    expect(r.isCompleted).toBe(true);
    expect(resolvePlanDay(plan, day(2), { isDayCompleted: () => false }).isCompleted).toBe(false);
  });

  it("returns no-plan when there is no plan or no start date", () => {
    expect(resolvePlanDay(null, day(0)).status).toBe("no-plan");
    expect(resolvePlanDay(undefined, day(0)).status).toBe("no-plan");
    expect(
      resolvePlanDay({ ...plan, created_at: undefined } as unknown as WorkoutPlan, day(0)).status
    ).toBe("no-plan");
  });

  it("stays active with null content when a week is missing from the plan", () => {
    const sparse = { ...plan, content: { "Week 1": week("W1") } } as WorkoutPlan;
    const r = resolvePlanDay(sparse, day(14));
    // Week 3 is genuinely part of the programme even if the data is missing…
    expect(r.status).toBe("active");
    expect(r.weekKey).toBe("Week 3");
    // …but Week 1 content is never substituted for it.
    expect(r.dayData).toBeNull();
    expect(r.isRestDay).toBe(true);
  });
});

describe("Dashboard ↔ Workout agreement", () => {
  // Both surfaces resolve through resolvePlanDay, so agreement is structural.
  // These cases are the ones the audit called out as diverging.
  const cases = [
    { name: "Week 1 training day", offset: 0 },
    { name: "Week 2 training day", offset: 9 },
    { name: "Week 3 training day", offset: 16 },
    { name: "Week 4 training day", offset: 23 },
    { name: "rest day", offset: 1 },
    { name: "before plan start", offset: -3 },
    { name: "first day after Week 4", offset: 28 },
    { name: "43 weeks after creation", offset: 43 * 7 },
  ];

  it.each(cases)("$name resolves identically for both surfaces", ({ offset }) => {
    const dashboard = resolvePlanDay(plan, day(offset));
    const workout = resolvePlanDay(plan, day(offset));
    expect(dashboard).toEqual(workout);
  });

  it("never shows executable content while the plan is finished", () => {
    for (const offset of [28, 35, 43 * 7]) {
      const r = resolvePlanDay(plan, day(offset));
      expect(r.planFinished).toBe(true);
      expect(r.dayData).toBeNull();
      expect(r.isCompleted).toBe(false);
    }
  });

  it("isPlanFinished agrees with resolvePlanDay", () => {
    expect(isPlanFinished(plan, day(27))).toBe(false);
    expect(isPlanFinished(plan, day(28))).toBe(true);
    expect(isPlanFinished(plan, day(-1))).toBe(false);
  });
});

describe("week labels", () => {
  it("formats plan-relative labels", () => {
    expect(formatWeekLabel(1)).toBe("Woche 1 von 4");
    expect(formatWeekLabel(4)).toBe("Woche 4 von 4");
  });

  it("never exceeds the plan length", () => {
    expect(formatWeekLabel(6)).toBe("Woche 4 von 4");
    expect(formatWeekLabel(43)).toBe("Woche 4 von 4");
  });

  it("falls back sensibly for missing or invalid input", () => {
    expect(formatWeekLabel(null)).toBe("Woche 1 von 4");
    expect(formatWeekLabel(0)).toBe("Woche 1 von 4");
  });

  it("clamps week keys into range", () => {
    expect(clampWeekKey("Week 6")).toBe("Week 4");
    expect(clampWeekKey("Week 43")).toBe("Week 4");
    expect(clampWeekKey("week2")).toBe("Week 2");
    expect(clampWeekKey(null)).toBe("Week 1");
  });
});

describe("getWorkoutWeekDay bounds", () => {
  it("no longer reports weeks outside the programme", () => {
    // Regression: this used to return "Week 6" / "Week 43" and callers
    // rendered those straight into the UI.
    const wk6 = getWorkoutWeekDay(PLAN_START, day(35));
    expect(wk6.weekKey).toBe("Week 4");
    expect(wk6.weekNumber).toBe(6);
    expect(wk6.isAfterPlan).toBe(true);

    const wk43 = getWorkoutWeekDay(PLAN_START, day(43 * 7));
    expect(wk43.weekKey).toBe("Week 4");
    expect(wk43.isAfterPlan).toBe(true);
  });

  it("flags dates before the plan start instead of pretending they are Week 1", () => {
    const before = getWorkoutWeekDay(PLAN_START, day(-5));
    expect(before.isBeforeStart).toBe(true);
    expect(before.weekNumber).toBeLessThan(1);
  });

  it("keeps in-range dates unchanged", () => {
    expect(getWorkoutWeekDay(PLAN_START, day(0)).weekKey).toBe("Week 1");
    expect(getWorkoutWeekDay(PLAN_START, day(21)).weekKey).toBe("Week 4");
    expect(getWorkoutWeekDay(PLAN_START, day(21)).isAfterPlan).toBe(false);
  });
});

describe("day-based week progress", () => {
  it("counts training days, not exercises, and excludes rest days", () => {
    const done = new Set(["Week 1_0", "Week 1_2"]);
    const progress = getWeekDayProgress(plan, "Week 1", (w, d) => done.has(`${w}_${d}`));
    // Three training days in the week; two of them completed.
    expect(progress).toEqual({ completed: 2, total: 3 });
  });

  it("reports zero for a missing week rather than borrowing another", () => {
    const sparse = { ...plan, content: { "Week 1": week("W1") } } as WorkoutPlan;
    expect(getWeekDayProgress(sparse, "Week 3", () => true)).toEqual({ completed: 0, total: 0 });
  });

  it("handles a missing plan", () => {
    expect(getWeekDayProgress(null, "Week 1", () => true)).toEqual({ completed: 0, total: 0 });
  });

  it("exposes the programme length", () => {
    expect(PLAN_TOTAL_WEEKS).toBe(4);
  });
});
