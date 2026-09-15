import { describe, expect, it } from "vitest";
import {
  buildExecutionSetViewModels,
  buildRecordedPerformance,
  parseSetCount,
  readTargetDayExercises,
  resolveExecutionTarget,
  resolveSessionWorkoutDay,
  type ExecutionSelection,
} from "./workoutExecution";
import type { ActualSetPerformance } from "./setPerformance";
import { createSessionPayload } from "./trainingSession";
import { getWorkoutDateString } from "./workoutDateUtils";

/*
  The execution identity rule without React or storage: a bound session is the
  workout being run, and the calendar only ever describes what Start would
  bind.
*/

const PLAN = { id: "plan-1", created_at: "2026-09-07T08:00:00Z" };
const STARTED = Date.parse("2026-09-07T10:00:00Z");
/** Started on Monday of Week 1, with its date captured. */
const MONDAY = createSessionPayload("plan-1", "Week 1", 0, STARTED, "2026-09-07");
/** A Week 2 Thursday session started before sessions captured their date. */
const LEGACY = createSessionPayload("plan-1", "Week 2", 3, STARTED);

const MONDAY_TARGET = {
  source: "session", planId: "plan-1", weekKey: "Week 1", dayIndex: 0, workoutDay: "2026-09-07",
};

const select = (weekKey: string, dayIndex: number, workoutDay: string): ExecutionSelection =>
  ({ weekKey, dayIndex, workoutDay });

describe("execution identity", () => {
  it("follows the selection only while no session is bound", () => {
    expect(resolveExecutionTarget(null, select("Week 2", 3, "2026-09-17"), PLAN)).toEqual({
      source: "selection", planId: "plan-1", weekKey: "Week 2", dayIndex: 3, workoutDay: "2026-09-17",
    });
  });

  it("keeps the bound session's plan day for every day the calendar can select", () => {
    for (const weekKey of ["Week 1", "Week 2", "Week 4"]) {
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const browsed = select(weekKey, dayIndex, getWorkoutDateString(PLAN.created_at, weekKey, dayIndex));

        expect(resolveExecutionTarget(MONDAY, browsed, PLAN)).toEqual(MONDAY_TARGET);
      }
    }
  });

  it("does not re-point a session at a different loaded plan", () => {
    // Stale until validation ends it - but never quietly moved onto the plan on screen.
    const otherPlan = { id: "plan-2", created_at: PLAN.created_at };

    expect(resolveExecutionTarget(MONDAY, select("Week 1", 1, "2026-09-08"), otherPlan)).toEqual(MONDAY_TARGET);
  });
});

describe("the session's calendar day", () => {
  it("is the date the session captured at start", () => {
    const plannedElsewhere = { id: "plan-1", created_at: "2026-08-03T08:00:00Z" };

    expect(resolveSessionWorkoutDay(MONDAY, plannedElsewhere)).toBe("2026-09-07");
  });

  it("is derived from the session's own plan when the session predates captured dates", () => {
    expect(resolveSessionWorkoutDay(LEGACY, PLAN)).toBe("2026-09-17");
    expect(resolveExecutionTarget(LEGACY, select("Week 1", 1, "2026-09-08"), PLAN).workoutDay).toBe("2026-09-17");
  });

  it("is left unknown rather than borrowed from the calendar", () => {
    expect(resolveSessionWorkoutDay(LEGACY, { id: "plan-2", created_at: PLAN.created_at })).toBeUndefined();
    expect(resolveSessionWorkoutDay(LEGACY, { id: "plan-1", created_at: null })).toBeUndefined();
    expect(resolveSessionWorkoutDay(LEGACY, null)).toBeUndefined();
    expect(resolveExecutionTarget(LEGACY, select("Week 1", 1, "2026-09-08"), null).workoutDay).toBeUndefined();
  });
});

describe("the bound day's exercises", () => {
  const WEEK_1 = [
    { day: "Montag", exercises: [{ name: "Kniebeugen", sets: 3, reps: "8" }, { name: "Rudern", sets: 3, reps: "10" }] },
    { day: "Dienstag", exercises: [{ name: "Bankdrücken", sets: 2, reps: "8–12" }] },
    { day: "Mittwoch", exercises: [] },
  ];
  const readWeek = (weekKey: string) => (weekKey === "Week 1" ? WEEK_1 : []);
  const at = (dayIndex: number, planId: string | undefined = "plan-1", weekKey = "Week 1") =>
    ({ planId, weekKey, dayIndex });

  it("reads the target's day in plan order", () => {
    expect(readTargetDayExercises(at(0), "plan-1", readWeek).map((exercise) => exercise.name))
      .toEqual(["Kniebeugen", "Rudern"]);
    expect(readTargetDayExercises(at(1), "plan-1", readWeek).map((exercise) => exercise.name))
      .toEqual(["Bankdrücken"]);
  });

  it("resolves nothing against a plan the target was not started from", () => {
    expect(readTargetDayExercises(at(0), "plan-2", readWeek)).toEqual([]);
    expect(readTargetDayExercises(at(0), undefined, readWeek)).toEqual([]);
    expect(readTargetDayExercises(at(0, undefined), undefined, readWeek)).toEqual([]);
  });

  it("reads a rest day, a missing day or week and malformed content as empty", () => {
    expect(readTargetDayExercises(at(2), "plan-1", readWeek)).toEqual([]);
    expect(readTargetDayExercises(at(6), "plan-1", readWeek)).toEqual([]);
    expect(readTargetDayExercises(at(0, "plan-1", "Week 3"), "plan-1", readWeek)).toEqual([]);
    expect(readTargetDayExercises(at(0), "plan-1", () => ({}))).toEqual([]);
    expect(readTargetDayExercises(at(0), "plan-1", () => [{ day: "Montag" }])).toEqual([]);
    expect(readTargetDayExercises(at(0), "plan-1", () => [null])).toEqual([]);
  });
});

const NOT_RECORDED = { source: "none", reps: null, weightKg: null };
const recorded = (reps: number | null, weightKg: number | null): ActualSetPerformance =>
  ({ source: "user-recorded", reps, weightKg });

describe("the set view model", () => {
  const BENCH = { name: "Bankdrücken", sets: 3, reps: "8–12", weight: "60 kg", rest: "90s" };

  it("describes each planned set with the prescription exactly as written", () => {
    expect(buildExecutionSetViewModels(BENCH, 1, () => false)).toEqual([1, 2, 3].map((setNumber) => ({
      key: `1:${setNumber}`,
      exerciseIndex: 1,
      setNumber,
      prescription: { reps: "8–12", weight: "60 kg", restSeconds: 90 },
      completed: false,
      actual: NOT_RECORDED,
      previous: null,
    })));
  });

  it("adds last time as a read-only reference by exact set number, never as today's actual", () => {
    const sets = buildExecutionSetViewModels(BENCH, 0, () => false, () => undefined, {
      workoutDay: "2026-09-08",
      sets: { 1: { reps: 10, weightKg: 52.5 }, 3: { reps: null, weightKg: 40 }, 5: { reps: 6, weightKg: null } },
    });

    expect(sets.map((set) => set.previous)).toEqual([{ reps: 10, weightKg: 52.5 }, null, { reps: null, weightKg: 40 }]);
    expect(sets.map((set) => set.actual)).toEqual([NOT_RECORDED, NOT_RECORDED, NOT_RECORDED]);
    expect(sets.map((set) => set.completed)).toEqual([false, false, false]);
    expect(sets.map((set) => set.prescription.reps)).toEqual(["8–12", "8–12", "8–12"]);
  });

  it("takes completion from set tracking and nowhere else", () => {
    const lookups: [number, number][] = [];
    const sets = buildExecutionSetViewModels(BENCH, 2, (exerciseIndex, setNumber) => {
      lookups.push([exerciseIndex, setNumber]);
      return setNumber === 2;
    });

    expect(sets.map((set) => set.completed)).toEqual([false, true, false]);
    expect(lookups).toEqual([[2, 1], [2, 2], [2, 3]]);
  });

  it("never presents a ticked set as performed reps or load", () => {
    const [ticked] = buildExecutionSetViewModels({ ...BENCH, sets: 1 }, 0, () => true, () => ({
      source: "completion-only", reps: null, weightKg: null,
    }));

    expect(ticked.completed).toBe(true);
    // The prescription stays the plan's target and is not copied into actual.
    expect(ticked.prescription).toEqual({ reps: "8–12", weight: "60 kg", restSeconds: 90 });
    expect(ticked.actual).toEqual({ source: "completion-only", reps: null, weightKg: null });
    expect(JSON.stringify(ticked)).not.toMatch(/repsCompleted|weightUsed/);
  });

  it("keeps completion, prescription and recorded performance as three separate layers", () => {
    const [open, done] = buildExecutionSetViewModels({ ...BENCH, sets: 2 }, 0,
      (_exerciseIndex, setNumber) => setNumber === 2,
      (_exerciseIndex, setNumber) => (setNumber === 1 ? recorded(10, 52.5) : recorded(null, 55)));

    expect(open).toMatchObject({ completed: false, actual: recorded(10, 52.5), prescription: { reps: "8–12", weight: "60 kg" } });
    expect(done).toMatchObject({ completed: true, actual: recorded(null, 55), prescription: { reps: "8–12", weight: "60 kg" } });
  });

  it("keeps time, numeric and load-free prescriptions untouched", () => {
    expect(buildExecutionSetViewModels({ name: "Plank", sets: 1, reps: "30 Sekunden" }, 0, () => false)[0].prescription)
      .toEqual({ reps: "30 Sekunden", weight: undefined, restSeconds: 60 });
    expect(buildExecutionSetViewModels({ name: "Dips", sets: "2", reps: 10, rest: "1:30" }, 0, () => false)
      .map((set) => set.prescription))
      .toEqual([{ reps: 10, weight: undefined, restSeconds: 90 }, { reps: 10, weight: undefined, restSeconds: 90 }]);
  });

  it("reads the planned set count the way the set list always has", () => {
    expect(parseSetCount(4)).toBe(4);
    expect(parseSetCount("5")).toBe(5);
    expect(parseSetCount("drei")).toBe(3);
    expect(buildExecutionSetViewModels({ name: "Rudern", sets: "drei", reps: "10" }, 0, () => false)).toHaveLength(3);
  });
});

describe("recorded performance for the finish summary", () => {
  const EXERCISES = [
    { name: "Bankdrücken", sets: 3, reps: "8–12", weight: "60 kg" },
    { name: "Plank", sets: 2, reps: "30 Sekunden" },
    { name: "Rudern", sets: 2, reps: "10", weight: "40 kg" },
  ];
  const stored: Record<string, ActualSetPerformance> = {
    "0:1": recorded(10, 52.5),
    "0:3": recorded(null, 57.5),
    // Ticked but nothing recorded, and a legacy set with copied numbers.
    "2:1": { source: "completion-only", reps: null, weightKg: null },
    "2:2": { source: "unverified", reps: null, weightKg: null },
  };

  it("lists only explicitly recorded values, in plan order, without the prescription", () => {
    expect(buildRecordedPerformance(
      EXERCISES,
      (exerciseIndex, setNumber) => exerciseIndex === 0 && setNumber === 1,
      (exerciseIndex, setNumber) => stored[`${exerciseIndex}:${setNumber}`],
    )).toEqual([{
      exerciseIndex: 0,
      name: "Bankdrücken",
      sets: [
        { setNumber: 1, reps: 10, weightKg: 52.5, completed: true },
        { setNumber: 3, reps: null, weightKg: 57.5, completed: false },
      ],
    }]);
  });

  it("is empty when nothing was recorded", () => {
    expect(buildRecordedPerformance(EXERCISES, () => true, () => undefined)).toEqual([]);
  });
});
