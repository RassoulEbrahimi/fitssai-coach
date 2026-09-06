import { describe, it, expect } from "vitest";
import { buildWeeklyReviewMetrics, readCompletions, readPlanWeekDays } from "./reviewMetrics";
import { describeRecommendation } from "@shared/weeklyRecommendation";
import type { WorkoutLog, WorkoutPlan } from "@/lib/types";

/*
  The client's half of the weekly review: turning what the app stores into the
  inputs the shared arithmetic expects. What is worth pinning here is what the
  adapter refuses to do — count a log it cannot place in the plan, read a rest
  day as a missed session, or produce zeros where there is no plan at all.
*/

const trainingDay = () => ({
  day: "Montag",
  exercises: [{ name: "Kniebeuge", sets: 3, reps: "8" }],
});
const restDay = () => ({ day: "Dienstag", exercises: [] });

/** Monday, Wednesday and Friday are training days. */
const week = () =>
  Array.from({ length: 7 }, (_, index) => (index % 2 === 0 && index < 5 ? trainingDay() : restDay()));

const plan = (): WorkoutPlan =>
  ({
    id: "plan-1",
    user_id: "user-1",
    created_at: "2026-08-05T09:00:00.000Z",
    content: { "Week 1": week(), "Week 2": week(), "Week 3": week(), "Week 4": week() },
  }) as unknown as WorkoutPlan;

const log = (over: Record<string, unknown>): WorkoutLog =>
  ({
    id: "log",
    plan_id: "plan-1",
    user_id: "user-1",
    workout_day: "2026-08-10",
    completed: true,
    ...over,
  }) as unknown as WorkoutLog;

describe("reading a plan week", () => {
  it("counts training days and leaves rest days at zero", () => {
    const days = readPlanWeekDays(plan(), "Week 2");

    expect(days).toHaveLength(7);
    expect(days.filter((day) => day.exerciseCount > 0).map((day) => day.dayIndex)).toEqual([0, 2, 4]);
  });

  it("accepts the lowercase key form the app has also written", () => {
    const stored = { content: { week2: week() } } as unknown as WorkoutPlan;

    expect(readPlanWeekDays(stored, "Week 2").filter((day) => day.exerciseCount > 0)).toHaveLength(3);
  });

  it("returns seven empty days rather than throwing on a missing week", () => {
    expect(readPlanWeekDays(plan(), "Week 9").every((day) => day.exerciseCount === 0)).toBe(true);
    expect(readPlanWeekDays(null, "Week 1")).toHaveLength(7);
    expect(readPlanWeekDays(plan(), null)).toHaveLength(7);
  });
});

describe("reading completions", () => {
  it("counts only logs that carry a plan position", () => {
    const completions = readCompletions([
      log({ week_key: "Week 2", day_index: 0 }),
      // A pre-PR47 log: its date may be derived from the plan's creation date
      // rather than its start Monday, so it cannot be placed in the week.
      log({ week_key: null, day_index: null, workout_day: null }),
    ]);

    expect(completions).toEqual([{ weekKey: "Week 2", dayIndex: 0, completed: true }]);
  });

  it("returns nothing for a day that was not completed", () => {
    // The reader now yields completed days only, so an unfinished day is
    // absent rather than present-and-false. Both forms count the same in
    // `computeWeekCompletion`, which filters on `completed`.
    expect(readCompletions([log({ week_key: "Week 2", day_index: 0, completed: false })])).toEqual(
      []
    );
  });

  it("ignores an exercise row, however completed it says it is", () => {
    // The row that used to slip through: same week, same day, same flag — but
    // it records one exercise, not the training day.
    expect(
      readCompletions([log({ week_key: "Week 2", day_index: 0, exercise_index: 0 })])
    ).toEqual([]);
  });

  it("counts a completed day once, whatever else was logged that day", () => {
    expect(
      readCompletions([
        log({ week_key: "Week 2", day_index: 0 }),
        log({ week_key: "Week 2", day_index: 0, exercise_index: 0 }),
        log({ week_key: "Week 2", day_index: 0, exercise_index: 1 }),
        log({ week_key: "Week 2", day_index: 0, exercise_index: 2 }),
      ])
    ).toEqual([{ weekKey: "Week 2", dayIndex: 0, completed: true }]);
  });
});

describe("assembling the week", () => {
  it("reports the real fraction of training days", () => {
    const metrics = buildWeeklyReviewMetrics({
      plan: plan(),
      weekKey: "Week 2",
      weekNumber: 2,
      logs: [log({ week_key: "Week 2", day_index: 0 }), log({ week_key: "Week 2", day_index: 2 })],
    });

    expect(metrics.scheduledDays).toBe(3);
    expect(metrics.completedDays).toBe(2);
    expect(metrics.completionPercent).toBe(67);
  });

  it("takes the previous week from the same logs", () => {
    const metrics = buildWeeklyReviewMetrics({
      plan: plan(),
      weekKey: "Week 2",
      weekNumber: 2,
      logs: [0, 2, 4].map((dayIndex) => log({ week_key: "Week 1", day_index: dayIndex })),
    });

    expect(metrics.previousWeek).toEqual({ weekKey: "Week 1", completionPercent: 100 });
  });

  it("has no previous week in Week 1", () => {
    const metrics = buildWeeklyReviewMetrics({
      plan: plan(),
      weekKey: "Week 1",
      weekNumber: 1,
      logs: [],
    });

    expect(metrics.previousWeek).toBeNull();
  });

  it("sums only measured durations", () => {
    const metrics = buildWeeklyReviewMetrics({
      plan: plan(),
      weekKey: "Week 2",
      weekNumber: 2,
      logs: [
        log({ week_key: "Week 2", day_index: 0, duration_sec: 2700 }),
        log({ week_key: "Week 2", day_index: 2 }),
      ],
    });

    expect(metrics.measuredDurationSec).toBe(2700);
    expect(metrics.durationCoverage).toBe("partial");
  });

  it("says there is no plan rather than reporting zeros", () => {
    const metrics = buildWeeklyReviewMetrics({
      plan: null,
      weekKey: null,
      weekNumber: null,
      logs: [],
    });

    expect(metrics.hasPlan).toBe(false);
    expect(metrics.completionPercent).toBeNull();
    expect(describeRecommendation(metrics).headline).toBe("Noch nichts geplant");
  });

  it("says the same for a date outside the four-week programme", () => {
    const metrics = buildWeeklyReviewMetrics({
      plan: plan(),
      weekKey: null,
      weekNumber: null,
      logs: [log({ week_key: "Week 2", day_index: 0 })],
    });

    expect(metrics.hasPlan).toBe(false);
    expect(metrics.completedDays).toBe(0);
  });

  it("survives a plan whose week is not an array", () => {
    const broken = { id: "p", content: { "Week 2": "kaputt" } } as unknown as WorkoutPlan;

    const metrics = buildWeeklyReviewMetrics({
      plan: broken,
      weekKey: "Week 2",
      weekNumber: 2,
      logs: [log({ week_key: "Week 2", day_index: 0 })],
    });

    expect(metrics.scheduledDays).toBe(0);
    expect(metrics.completionPercent).toBeNull();
  });
});
