import type { TrainingSessionPayload } from "@/lib/trainingSession";
import { getWorkoutDateString } from "@/lib/workoutDateUtils";
import { parseRestTime } from "@/lib/restTimeParser";
import type { ActualSetPerformance } from "@/lib/setPerformance";
import type { RecordedSetLine } from "@/lib/setPerformanceEntry";
import type { PreviousExercisePerformance, PreviousSetPerformance } from "@/lib/previousPerformance";

/**
 * Which workout the execution UI is running.
 *
 * Selecting a calendar day is browsing. It decides what "Training starten"
 * would bind and what the pre-start preview shows, and nothing else. Once a
 * session is bound, its plan day - plan, week, day and date - is the only
 * identity the running workout may display, count or write against, until the
 * session is explicitly ended.
 *
 * The card used to read its exercises, its set-tracking key and the
 * destination of every set write from the selected day, while finishing read
 * the session. Browsing mid-workout showed and wrote one day and finished
 * another. Every execution concern now asks here instead of choosing between
 * the two itself.
 *
 * Nothing in this module talks to React, Firestore or storage.
 */

/** A plan exercise as the execution UI reads it. Its prescription is displayed, never written back. */
export interface ExecutionExercise {
  name: string;
  sets: number | string;
  reps: number | string;
  weight?: string;
  rest?: string;
}

/** The day on screen: what Start would bind. */
export interface ExecutionSelection {
  weekKey: string;
  dayIndex: number;
  /** `YYYY-MM-DD` of the selected calendar day. */
  workoutDay: string;
}

export interface ExecutionTarget {
  /** `session` whenever a bound session exists; `selection` only before one does. */
  source: "session" | "selection";
  planId: string | undefined;
  weekKey: string;
  dayIndex: number;
  /**
   * `YYYY-MM-DD` the work is recorded against. Undefined only for an older
   * session whose own plan cannot supply its date; the selected day is never
   * substituted for it.
   */
  workoutDay: string | undefined;
}

/** The parts of a loaded plan that can vouch for a session. */
export interface ExecutionPlanIdentity {
  id?: string | null;
  created_at?: string | null;
}

type SessionIdentity = Pick<TrainingSessionPayload, "planId" | "weekKey" | "dayIndex" | "workoutDay">;

/**
 * The calendar day a bound session belongs to.
 *
 * Sessions started since PR #62 captured it at start. Older ones carry only a
 * plan position, resolved against that same plan's start date and nothing
 * else: another plan, or a plan without a start date, yields no date rather
 * than the day the user happens to be looking at. Finishing and set writes both
 * go through here, so they cannot record one session against different days.
 */
export const resolveSessionWorkoutDay = (
  session: SessionIdentity,
  plan: ExecutionPlanIdentity | null | undefined
): string | undefined =>
  session.workoutDay ?? (
    plan?.id === session.planId && plan?.created_at
      ? getWorkoutDateString(plan.created_at, session.weekKey, session.dayIndex)
      : undefined
  );

/**
 * Resolve the execution identity. A bound session always wins, whatever is
 * selected; the selection applies only while nothing is bound.
 */
export const resolveExecutionTarget = (
  session: SessionIdentity | null,
  selection: ExecutionSelection,
  plan: ExecutionPlanIdentity | null | undefined
): ExecutionTarget => {
  if (session) {
    return {
      source: "session",
      planId: session.planId,
      weekKey: session.weekKey,
      dayIndex: session.dayIndex,
      workoutDay: resolveSessionWorkoutDay(session, plan),
    };
  }
  return {
    source: "selection",
    planId: plan?.id ?? undefined,
    weekKey: selection.weekKey,
    dayIndex: selection.dayIndex,
    workoutDay: selection.workoutDay,
  };
};

/**
 * The target's plan day, in plan order.
 *
 * The week is read through the caller's plan reader - the Workout view's own
 * `getWeekContentWithFallback` - so running and browsing interpret a plan the
 * same way, and exercise positions, which set logs are keyed by, line up. A
 * loaded plan other than the target's yields nothing: a session is never
 * resolved against a plan it was not started from.
 */
export const readTargetDayExercises = (
  target: Pick<ExecutionTarget, "planId" | "weekKey" | "dayIndex">,
  loadedPlanId: string | null | undefined,
  readWeek: (weekKey: string) => unknown
): ExecutionExercise[] => {
  if (!target.planId || target.planId !== loadedPlanId) return [];
  const week = readWeek(target.weekKey);
  const day: unknown = Array.isArray(week) ? week[target.dayIndex] : undefined;
  const exercises = (day as { exercises?: unknown } | null | undefined)?.exercises;
  return Array.isArray(exercises) ? (exercises as ExecutionExercise[]) : [];
};

/**
 * Planned set count as the set list reads it: a number as written, a numeric
 * string parsed, and three sets when the count cannot be read.
 */
export const parseSetCount = (sets: number | string): number => {
  if (typeof sets === "number") return sets;
  const parsed = parseInt(String(sets), 10);
  return isNaN(parsed) ? 3 : parsed;
};

/** What was recorded as performed for one set. `none`: nothing is stored for it. */
export interface ExecutionSetActual {
  source: ActualSetPerformance["source"] | "none";
  reps: number | null;
  weightKg: number | null;
}

const NOT_RECORDED: ExecutionSetActual = { source: "none", reps: null, weightKg: null };

type ActualPerformanceReader = (exerciseIndex: number, setNumber: number) => ActualSetPerformance | undefined;

/**
 * One planned set as the execution UI presents it.
 *
 * A view model, not a record: nothing here is stored. Three independent layers:
 * `prescription` is the plan's target exactly as written and is only
 * displayed. `completed` comes from set tracking alone and means the planned
 * set was ticked off - not that those reps or that load were performed.
 * `actual` is what the user explicitly recorded; only a `user-recorded` source
 * carries numbers, and the prescription is never copied into it.
 *
 * Beside them, `previous` is a read-only reference: what was recorded for the
 * same set number the last time this exercise was trained. It never counts as
 * today's actual and never affects completion.
 */
export interface ExecutionSetViewModel {
  key: string;
  exerciseIndex: number;
  setNumber: number;
  prescription: {
    reps: number | string;
    weight?: string;
    restSeconds: number;
  };
  completed: boolean;
  actual: ExecutionSetActual;
  previous: PreviousSetPerformance | null;
}

export const buildExecutionSetViewModels = (
  exercise: ExecutionExercise,
  exerciseIndex: number,
  isSetCompleted: (exerciseIndex: number, setNumber: number) => boolean,
  getActualPerformance?: ActualPerformanceReader,
  previous?: PreviousExercisePerformance
): ExecutionSetViewModel[] => {
  const restSeconds = parseRestTime(exercise.rest);
  return Array.from({ length: parseSetCount(exercise.sets) }, (_, index) => {
    const setNumber = index + 1;
    return {
      key: `${exerciseIndex}:${setNumber}`,
      exerciseIndex,
      setNumber,
      prescription: { reps: exercise.reps, weight: exercise.weight, restSeconds },
      completed: isSetCompleted(exerciseIndex, setNumber),
      actual: getActualPerformance?.(exerciseIndex, setNumber) ?? NOT_RECORDED,
      // Same set number only: never shifted, interpolated or invented.
      previous: previous?.sets[setNumber] ?? null,
    };
  });
};

export interface RecordedExercisePerformance {
  exerciseIndex: number;
  name: string;
  sets: RecordedSetLine[];
}

/**
 * The finish summary's review of recorded performance, in plan order.
 *
 * Explicitly recorded values only. A set with nothing recorded is left out -
 * it is never filled in from the prescription - and an exercise with no
 * recorded set is left out entirely. No totals, estimates or records.
 */
export const buildRecordedPerformance = (
  exercises: readonly ExecutionExercise[],
  isSetCompleted: (exerciseIndex: number, setNumber: number) => boolean,
  getActualPerformance: ActualPerformanceReader
): RecordedExercisePerformance[] =>
  exercises.flatMap((exercise, exerciseIndex) => {
    const sets = Array.from({ length: parseSetCount(exercise.sets) }, (_, index) => index + 1)
      .flatMap((setNumber): RecordedSetLine[] => {
        const actual = getActualPerformance(exerciseIndex, setNumber);
        if (actual?.source !== "user-recorded" || (actual.reps === null && actual.weightKg === null)) return [];
        return [{
          setNumber,
          reps: actual.reps,
          weightKg: actual.weightKg,
          completed: isSetCompleted(exerciseIndex, setNumber),
        }];
      });
    return sets.length > 0 ? [{ exerciseIndex, name: exercise.name, sets }] : [];
  });
