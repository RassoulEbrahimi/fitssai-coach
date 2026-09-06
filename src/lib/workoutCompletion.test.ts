import { describe, it, expect } from "vitest";
import {
  classifyLog,
  filterDaySessionLogs,
  isCalendarDayComplete,
  isCompletedDayLog,
  isDaySessionLog,
  isPlanDayComplete,
  readCompletedDayDates,
  readCompletedDays,
} from "@/lib/workoutCompletion";
import { buildWeeklyReviewMetrics } from "@/lib/coaching/reviewMetrics";
import { readCompletedWorkoutDays } from "@shared/workoutCompletion";
import type { WorkoutLog, WorkoutPlan } from "@/lib/types";

/*
  The one rule, exercised against the documents the app actually writes.

  `users/{uid}/workout_logs` mixes day sessions and exercise positions in one
  collection, and both carry weekKey, dayIndex and completed. Everything below
  is about the difference: a ticked exercise is a ticked exercise, and only the
  day session record can say a training day was completed.
*/

/** A day session, as `useWorkoutLogs.toggleDay` writes it. */
const daySession = (over: Record<string, unknown> = {}): WorkoutLog =>
  ({
    id: "day-log",
    plan_id: "plan-1",
    user_id: "user-1",
    week_key: "Week 1",
    day_index: 0,
    workout_day: "2026-08-10",
    completed: true,
    ...over,
  }) as unknown as WorkoutLog;

/** An exercise position, as `useWeekCompletion.toggleExercise` writes it. */
const exerciseLog = (over: Record<string, unknown> = {}): WorkoutLog =>
  ({
    id: "exercise-log",
    plan_id: "plan-1",
    user_id: "user-1",
    week_key: "Week 1",
    day_index: 0,
    exercise_index: 0,
    completed: true,
    ...over,
  }) as unknown as WorkoutLog;

const trainingDay = () => ({ day: "Tag", exercises: [{ name: "Kniebeuge", sets: 3, reps: "8" }] });
const restDay = () => ({ day: "Tag", exercises: [] });

/** Monday, Wednesday and Friday are training days; the rest are rest days. */
const threeDayWeek = () =>
  Array.from({ length: 7 }, (_, index) => (index % 2 === 0 && index < 5 ? trainingDay() : restDay()));

const plan = (): WorkoutPlan =>
  ({
    id: "plan-1",
    user_id: "user-1",
    created_at: "2026-08-03T09:00:00.000Z",
    content: {
      "Week 1": threeDayWeek(),
      "Week 2": threeDayWeek(),
      "Week 3": threeDayWeek(),
      "Week 4": threeDayWeek(),
    },
  }) as unknown as WorkoutPlan;

const weekOne = (logs: readonly WorkoutLog[]) =>
  buildWeeklyReviewMetrics({ plan: plan(), weekKey: "Week 1", weekNumber: 1, logs });

describe("telling the two families of log apart", () => {
  it("reads a day session as a day session", () => {
    expect(classifyLog(daySession())).toBe("day-session");
    expect(isDaySessionLog(daySession())).toBe(true);
  });

  it("reads an exercise position as an exercise", () => {
    expect(classifyLog(exerciseLog())).toBe("exercise");
    expect(isDaySessionLog(exerciseLog())).toBe(false);
  });

  it("reads an exercise row that carries a date as an exercise, not a day", () => {
    // Set tracking creates the log with the day's `workoutDay` on it, and
    // ticking the exercise then sets `completed` on that same document.
    const setStub = exerciseLog({ workout_day: "2026-08-10" });

    expect(classifyLog(setStub)).toBe("exercise");
    expect(isCompletedDayLog(setStub)).toBe(false);
  });

  it("reads a row with neither a position nor a date as unknown", () => {
    expect(classifyLog({ completed: true })).toBe("unknown");
    expect(classifyLog(null)).toBe("unknown");
  });

  it("keeps only day sessions when filtering", () => {
    const logs = [daySession(), exerciseLog(), exerciseLog({ exercise_index: 1 })];

    expect(filterDaySessionLogs(logs).map((log) => log.id)).toEqual(["day-log"]);
  });
});

describe("A. one completed exercise, session not completed", () => {
  const logs = [exerciseLog()];

  it("does not complete the day", () => {
    expect(readCompletedDays(logs)).toEqual([]);
    expect(isPlanDayComplete(logs, "Week 1", 0)).toBe(false);
    expect(isCalendarDayComplete(logs, "2026-08-10")).toBe(false);
  });

  it("does not complete the day in the weekly review either", () => {
    expect(weekOne(logs).completedDays).toBe(0);
  });
});

describe("B. several completed exercises, session not completed", () => {
  const logs = [0, 1, 2, 3].map((index) => exerciseLog({ exercise_index: index }));

  it("still does not complete the day", () => {
    expect(readCompletedDays(logs)).toEqual([]);
    expect(weekOne(logs).completedDays).toBe(0);
    expect(weekOne(logs).completionPercent).toBe(0);
  });
});

describe("C. explicit day/session completion", () => {
  const logs = [daySession()];

  it("completes the day exactly once", () => {
    expect(readCompletedDays(logs)).toEqual([{ weekKey: "Week 1", dayIndex: 0 }]);
    expect(isPlanDayComplete(logs, "Week 1", 0)).toBe(true);
    expect(isCalendarDayComplete(logs, "2026-08-10")).toBe(true);
    expect(weekOne(logs).completedDays).toBe(1);
  });

  it("says nothing about the other days of the week", () => {
    expect(isPlanDayComplete(logs, "Week 1", 2)).toBe(false);
    expect(weekOne(logs).missedDays).toBe(2);
  });
});

describe("D. completed day plus many exercise rows", () => {
  const logs = [
    daySession(),
    ...[0, 1, 2, 3, 4].map((index) => exerciseLog({ exercise_index: index })),
  ];

  it("is still exactly one completed day", () => {
    expect(readCompletedDays(logs)).toEqual([{ weekKey: "Week 1", dayIndex: 0 }]);
    expect(readCompletedDayDates(logs)).toEqual(["2026-08-10"]);
    expect(weekOne(logs).completedDays).toBe(1);
  });

  it("counts one session for the duration figures, not six", () => {
    const metrics = weekOne(logs);

    expect(metrics.measuredSessionCount + metrics.unmeasuredSessionCount).toBe(1);
  });

  it("counts a duplicated day session once as well", () => {
    const duplicated = [daySession(), daySession({ id: "day-log-2" })];

    expect(readCompletedDays(duplicated)).toHaveLength(1);
    expect(readCompletedDayDates(duplicated)).toEqual(["2026-08-10"]);
  });
});

describe("E. partial session", () => {
  // The day exists — set tracking and a measured duration both wrote to it —
  // but nobody ever marked the workout done.
  const logs = [
    daySession({ completed: false, duration_sec: 1_800 }),
    exerciseLog(),
    exerciseLog({ exercise_index: 1 }),
  ];

  it("is not completed", () => {
    expect(readCompletedDays(logs)).toEqual([]);
    expect(isPlanDayComplete(logs, "Week 1", 0)).toBe(false);
    expect(weekOne(logs).completedDays).toBe(0);
  });

  it("does not let a measured duration stand in for completion", () => {
    expect(weekOne(logs).measuredSessionCount).toBe(1);
    expect(weekOne(logs).completedDays).toBe(0);
  });
});

describe("F. legacy ambiguous rows", () => {
  it("does not count a row that carries neither a position nor a date", () => {
    const logs = [
      { id: "junk", completed: true } as unknown as WorkoutLog,
      { id: "junk-2", completed: true, week_key: "", day_index: null } as unknown as WorkoutLog,
    ];

    expect(readCompletedDays(logs)).toEqual([]);
    expect(weekOne(logs).completedDays).toBe(0);
  });

  it("does not count a row whose exercise index cannot be read", () => {
    // Somebody wrote it at an exercise position; that it is unreadable is not
    // a reason to promote it to a finished training day.
    const logs = [exerciseLog({ exercise_index: "0" })];

    expect(classifyLog(logs[0])).toBe("unknown");
    expect(readCompletedDays(logs)).toEqual([]);
  });

  it("does not read a truthy legacy completion flag as true", () => {
    expect(isCompletedDayLog(daySession({ completed: 1 }))).toBe(false);
    expect(isCompletedDayLog(daySession({ completed: "yes" }))).toBe(false);
  });

  it("leaves a dateless day session out of the week it cannot be placed in", () => {
    // A pre-PR48 day log: a date whose derivation may be wrong, and no plan
    // position at all. Real, but unplaceable — so uncounted.
    const logs = [daySession({ week_key: null, day_index: null })];

    expect(isDaySessionLog(logs[0])).toBe(true);
    expect(readCompletedDays(logs)).toEqual([]);
    expect(weekOne(logs).completedDays).toBe(0);
  });
});

describe("G. a three-day plan week counts true sessions only", () => {
  const day = (dayIndex: number, over: Record<string, unknown> = {}) =>
    daySession({
      id: `day-${dayIndex}`,
      day_index: dayIndex,
      workout_day: `2026-08-${String(3 + dayIndex).padStart(2, "0")}`,
      ...over,
    });

  const noise = [0, 1, 2].map((index) =>
    exerciseLog({ id: `ex-${index}`, day_index: 2, exercise_index: index })
  );

  it("reports 1/3 for one true completed session", () => {
    const metrics = weekOne([day(0), ...noise]);

    expect(metrics.scheduledDays).toBe(3);
    expect(metrics.completedDays).toBe(1);
    expect(metrics.completionPercent).toBe(33);
  });

  it("reports 2/3 for two true completed sessions", () => {
    const metrics = weekOne([day(0), day(2), ...noise]);

    expect(metrics.completedDays).toBe(2);
    expect(metrics.completionPercent).toBe(67);
  });

  it("reports 3/3 for three true completed sessions", () => {
    const metrics = weekOne([day(0), day(2), day(4), ...noise]);

    expect(metrics.completedDays).toBe(3);
    expect(metrics.missedDays).toBe(0);
    expect(metrics.completionPercent).toBe(100);
  });

  it("never exceeds the scheduled days, however many rows a day has", () => {
    const metrics = weekOne([day(0), day(0, { id: "dup" }), ...noise]);

    expect(metrics.completedDays).toBeLessThanOrEqual(metrics.scheduledDays);
    expect(metrics.completedDays).toBe(1);
  });
});

describe("H. every surface agrees", () => {
  const logs = [
    daySession({ id: "d0", day_index: 0, workout_day: "2026-08-03" }),
    daySession({ id: "d2", day_index: 2, workout_day: "2026-08-05", completed: false }),
    ...[0, 1, 2].map((index) =>
      exerciseLog({ id: `ex-${index}`, day_index: 2, exercise_index: index })
    ),
  ];

  it("gives the dashboard, the weekly review and the day helpers one answer", () => {
    // Dashboard (calendar-day form) and the plan-position form.
    expect(isCalendarDayComplete(logs, "2026-08-03")).toBe(true);
    expect(isCalendarDayComplete(logs, "2026-08-05")).toBe(false);
    expect(isPlanDayComplete(logs, "Week 1", 0)).toBe(true);
    expect(isPlanDayComplete(logs, "Week 1", 2)).toBe(false);

    // Activity progress (day dates) and the weekly review (plan positions).
    expect(readCompletedDayDates(logs)).toEqual(["2026-08-03"]);
    expect(readCompletedDays(logs)).toEqual([{ weekKey: "Week 1", dayIndex: 0 }]);
    expect(weekOne(logs).completedDays).toBe(1);
  });

  it("gives the backend the same answer as the client", () => {
    // The backend reads the same documents in their stored camelCase spelling.
    const stored = [
      { planId: "plan-1", weekKey: "Week 1", dayIndex: 0, workoutDay: "2026-08-03", completed: true },
      { planId: "plan-1", weekKey: "Week 1", dayIndex: 2, workoutDay: "2026-08-05", completed: false },
      ...[0, 1, 2].map((index) => ({
        planId: "plan-1",
        weekKey: "Week 1",
        dayIndex: 2,
        exerciseIndex: index,
        completed: true,
      })),
    ];

    expect(readCompletedWorkoutDays(stored)).toEqual(readCompletedDays(logs));
  });
});
