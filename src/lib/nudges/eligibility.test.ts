import { describe, it, expect } from "vitest";
import { evaluateTrainingNudges } from "./eligibility";
import { PLANNED_SESSION_TEXT, UNFINISHED_SESSION_TEXT } from "./copy";
import type { WorkoutPlan } from "@/lib/types";

/*
  The nudge rule, walked through the transitions a real user makes in a week.

  Every case is a plan, a date and a set of stored logs handed to a pure
  function — no clock, no query, no component. The ones that matter most are
  the two the completion cleanup exists for: a day with one ticked exercise is
  still open (B), and a day whose session record says completed is silent (C).
  Getting either backwards means nagging somebody who is finished or going
  quiet on somebody who has barely started.
*/

/** Monday 2025-01-06 is the plan's first day; Mon/Wed/Fri are training days. */
const PLAN_CREATED_AT = "2025-01-06T08:00:00.000Z";

const exercises = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ name: `Übung ${index + 1}`, sets: 3, reps: 10 }));

/** Mon, Wed and Fri carry exercises; Tue, Thu, Sat, Sun are rest days. */
const week = () => [
  { day: "Montag", exercises: exercises(3) },
  { day: "Dienstag", exercises: [] },
  { day: "Mittwoch", exercises: exercises(3) },
  { day: "Donnerstag", exercises: [] },
  { day: "Freitag", exercises: exercises(3) },
  { day: "Samstag", exercises: [] },
  { day: "Sonntag", exercises: [] },
];

const plan = (): WorkoutPlan =>
  ({
    id: "plan-1",
    created_at: PLAN_CREATED_AT,
    content: {
      "Week 1": week(),
      "Week 2": week(),
      "Week 3": week(),
      "Week 4": week(),
    },
  }) as unknown as WorkoutPlan;

/** Noon in Berlin, so no timezone shift can move the date under the test. */
const at = (isoDay: string) => new Date(`${isoDay}T11:00:00.000Z`);

const MONDAY_WEEK_1 = at("2025-01-06");
const TUESDAY_WEEK_1 = at("2025-01-07");
const WEDNESDAY_WEEK_1 = at("2025-01-08");

/** A completed day session: no exerciseIndex, and `completed: true`. */
const daySession = (weekKey: string, dayIndex: number, workoutDay: string) => ({
  id: `day-${weekKey}-${dayIndex}`,
  week_key: weekKey,
  day_index: dayIndex,
  workout_day: workoutDay,
  completed: true,
});

/** An exercise row: carries an exerciseIndex, so it never completes a day. */
const exerciseLog = (weekKey: string, dayIndex: number, exerciseIndex: number, completed = true) => ({
  id: `ex-${weekKey}-${dayIndex}-${exerciseIndex}`,
  week_key: weekKey,
  day_index: dayIndex,
  exercise_index: exerciseIndex,
  workout_day: "2025-01-06",
  completed,
});

describe("nudge eligibility", () => {
  it("A. nudges on a planned day with nothing logged", () => {
    const result = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs: [] });

    expect(result.eligible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.context?.weekKey).toBe("Week 1");
    expect(result.context?.dayIndex).toBe(0);
    expect(result.nudges[0].type).toBe("planned-session-today");
    expect(result.nudges[0].title).toBe(PLANNED_SESSION_TEXT.title);
  });

  it("B. still nudges when only exercises are ticked off", () => {
    /*
      The whole point of the authoritative rule: three completed exercise rows
      are not a completed day. The nudge stays, and only its wording changes.
    */
    const logs = [
      exerciseLog("Week 1", 0, 0),
      exerciseLog("Week 1", 0, 1),
      exerciseLog("Week 1", 0, 2),
    ];
    const result = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs });

    expect(result.eligible).toBe(true);
    expect(result.context?.hasStarted).toBe(true);
    expect(result.nudges[0].type).toBe("unfinished-session");
    expect(result.nudges[0].title).toBe(UNFINISHED_SESSION_TEXT.title);
  });

  it("C. goes silent once the day session record says completed", () => {
    const logs = [
      exerciseLog("Week 1", 0, 0),
      daySession("Week 1", 0, "2025-01-06"),
    ];
    const result = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("day-completed");
    expect(result.nudges).toEqual([]);
  });

  it("C2. accepts a date-addressed completion as proof too", () => {
    // A day log without a plan position still completes the day it names.
    const logs = [{ id: "d", workout_day: "2025-01-06", completed: true }];
    const result = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs });

    expect(result.reason).toBe("day-completed");
  });

  it("D. never nudges on a rest day", () => {
    const result = evaluateTrainingNudges({ plan: plan(), date: TUESDAY_WEEK_1, logs: [] });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("rest-day");
  });

  it("E. never nudges before the plan starts or after Week 4", () => {
    const before = evaluateTrainingNudges({ plan: plan(), date: at("2025-01-01"), logs: [] });
    expect(before.reason).toBe("before-plan-start");

    // Week 4 ends 2025-02-02; the Monday after is outside the programme.
    const after = evaluateTrainingNudges({ plan: plan(), date: at("2025-02-03"), logs: [] });
    expect(after.reason).toBe("plan-finished");
    expect(after.nudges).toEqual([]);
  });

  it("F. never nudges without a plan", () => {
    expect(evaluateTrainingNudges({ plan: null, date: MONDAY_WEEK_1, logs: [] }).reason).toBe(
      "no-plan"
    );
    expect(
      evaluateTrainingNudges({ plan: undefined, date: MONDAY_WEEK_1, logs: null }).reason
    ).toBe("no-plan");
    // A plan with no start date cannot place a day, so it cannot nudge either.
    const undated = { id: "p", content: { "Week 1": week() } } as unknown as WorkoutPlan;
    expect(evaluateTrainingNudges({ plan: undated, date: MONDAY_WEEK_1, logs: [] }).reason).toBe(
      "no-plan"
    );
  });

  it("G2. keeps one training-day identity across the wording change", () => {
    /*
      The delivery key must not move when the day's wording does. Ticking one
      exercise renames the nudge; a key carrying that name would look like a
      second nudge and interrupt the same session twice.
    */
    const untouched = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs: [] });
    const started = evaluateTrainingNudges({
      plan: plan(),
      date: MONDAY_WEEK_1,
      logs: [exerciseLog("Week 1", 0, 0)],
    });

    expect(untouched.nudges[0].type).toBe("planned-session-today");
    expect(started.nudges[0].type).toBe("unfinished-session");
    expect(started.nudges[0].key).not.toBe(untouched.nudges[0].key);
    expect(started.nudges[0].dayKey).toBe(untouched.nudges[0].dayKey);
    expect(started.nudges[0].dayKey).toBe("plan-1|Week 1|0");
  });

  it("G3. gives every nudge on one day the same day identity", () => {
    // One dismissal has to be able to close the day, weekly line included.
    const result = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs: [] });

    expect(new Set(result.nudges.map((nudge) => nudge.dayKey)).size).toBe(1);
  });

  it("G. produces the same nudge key for the same training day", () => {
    // The key is what the delivery record dedupes on across reloads.
    const first = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs: [] });
    const second = evaluateTrainingNudges({ plan: plan(), date: at("2025-01-06"), logs: [] });

    expect(first.nudges[0].key).toBe(second.nudges[0].key);
    expect(first.nudges[0].key).toContain("plan-1");
  });

  it("H. the next planned training day is a new nudge", () => {
    const monday = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs: [] });
    const wednesday = evaluateTrainingNudges({ plan: plan(), date: WEDNESDAY_WEEK_1, logs: [] });

    expect(wednesday.eligible).toBe(true);
    expect(wednesday.context?.dayIndex).toBe(2);
    expect(wednesday.nudges[0].key).not.toBe(monday.nudges[0].key);
    // And a different training day, so the delivery record cannot suppress it.
    expect(wednesday.nudges[0].dayKey).not.toBe(monday.nudges[0].dayKey);
  });

  it("ignores logs that cannot be placed in either family", () => {
    /*
      Pre-PR48 replay junk: no exercise position, no day identity, a truthy
      completion flag. It is evidence of nothing, so it neither completes the
      day nor counts as having started it.
    */
    const logs = [{ id: "junk", completed: "yes" }, { id: "junk-2", completed: true }];
    const result = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs });

    expect(result.eligible).toBe(true);
    expect(result.context?.hasStarted).toBe(false);
    expect(result.nudges[0].type).toBe("planned-session-today");
  });

  it("does not treat a non-boolean completion flag as a completed day", () => {
    const logs = [{ id: "d", week_key: "Week 1", day_index: 0, workout_day: "2025-01-06", completed: 1 }];
    const result = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs });

    expect(result.eligible).toBe(true);
  });
});

describe("weekly consistency", () => {
  it("reports open sessions from completed day records only", () => {
    const result = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs: [] });

    expect(result.context?.scheduledThisWeek).toBe(3);
    expect(result.context?.completedThisWeek).toBe(0);
    expect(result.context?.openThisWeek).toBe(3);
    expect(result.nudges[1].type).toBe("weekly-consistency");
    expect(result.nudges[1].title).toBe(
      "Diese Woche sind noch 3 von 3 geplanten Einheiten offen."
    );
  });

  it("counts a completed day against the week", () => {
    // Wednesday, with Monday already finished: 1 of 3 done, 2 still open.
    const logs = [daySession("Week 1", 0, "2025-01-06")];
    const result = evaluateTrainingNudges({ plan: plan(), date: WEDNESDAY_WEEK_1, logs });

    expect(result.context?.completedThisWeek).toBe(1);
    expect(result.nudges[1].title).toBe(
      "Diese Woche sind noch 2 von 3 geplanten Einheiten offen."
    );
  });

  it("stays quiet when today is the only open session", () => {
    // Repeating "noch 1 von 3 offen" under the day nudge adds nothing.
    const logs = [daySession("Week 1", 0, "2025-01-06"), daySession("Week 1", 4, "2025-01-10")];
    const result = evaluateTrainingNudges({ plan: plan(), date: WEDNESDAY_WEEK_1, logs });

    expect(result.nudges).toHaveLength(1);
    expect(result.nudges[0].type).toBe("planned-session-today");
  });

  it("never leaves the app as a browser notification", () => {
    const result = evaluateTrainingNudges({ plan: plan(), date: MONDAY_WEEK_1, logs: [] });

    expect(result.nudges.filter((nudge) => nudge.browserDeliverable)).toHaveLength(1);
    expect(result.nudges[1].browserDeliverable).toBe(false);
  });
});

describe("nudge evaluation is read-only", () => {
  it("mutates neither the plan nor the logs", () => {
    const source = plan();
    const logs = [exerciseLog("Week 1", 0, 0)];
    const planBefore = JSON.stringify(source);
    const logsBefore = JSON.stringify(logs);

    evaluateTrainingNudges({ plan: source, date: MONDAY_WEEK_1, logs });
    evaluateTrainingNudges({ plan: source, date: WEDNESDAY_WEEK_1, logs });

    expect(JSON.stringify(source)).toBe(planBefore);
    expect(JSON.stringify(logs)).toBe(logsBefore);
  });

  it("works on frozen inputs, so no write can hide in it", () => {
    const frozenPlan = Object.freeze(plan());
    const frozenLogs = Object.freeze([Object.freeze(exerciseLog("Week 1", 0, 0))]);

    expect(() =>
      evaluateTrainingNudges({ plan: frozenPlan, date: MONDAY_WEEK_1, logs: frozenLogs })
    ).not.toThrow();
  });
});
