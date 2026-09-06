import {
  classifyWorkoutLog,
  isCompletedWorkoutDay,
  isPlanDayCompleted,
  isWorkoutDayCompleted,
  readCompletedWorkoutDayDates,
  readCompletedWorkoutDays,
  type WorkoutDayCompletion,
  type WorkoutLogKind,
  type WorkoutLogRecord,
} from "@shared/workoutCompletion";

/**
 * The client's adapter onto the shared completion rule.
 *
 * The rule itself — a workout day is completed only when its day session
 * record says so — lives in `shared/workoutCompletion.ts` and is the same code
 * the backend runs, so the dashboard, the weekly review and the activity chart
 * cannot drift apart on what "completed" means. This module only translates
 * shapes: the app reads the same documents through two spellings, camelCase
 * straight from Firestore and the snake_case `WorkoutLog` the query layer
 * hands to components.
 */

/** A log in either spelling the app uses. Both are read; neither is required. */
export interface AnyWorkoutLogShape {
  weekKey?: unknown;
  week_key?: unknown;
  dayIndex?: unknown;
  day_index?: unknown;
  exerciseIndex?: unknown;
  exercise_index?: unknown;
  workoutDay?: unknown;
  workout_day?: unknown;
  completed?: unknown;
  durationSec?: unknown;
  duration_sec?: unknown;
}

/** Pick whichever spelling carries a value, camelCase first. */
const pick = (camel: unknown, snake: unknown): unknown =>
  camel === undefined || camel === null ? snake : camel;

/** One stored log, in the shape the shared rule reads. */
export const toWorkoutLogRecord = (log: AnyWorkoutLogShape | null | undefined): WorkoutLogRecord => ({
  weekKey: pick(log?.weekKey, log?.week_key),
  dayIndex: pick(log?.dayIndex, log?.day_index),
  exerciseIndex: pick(log?.exerciseIndex, log?.exercise_index),
  workoutDay: pick(log?.workoutDay, log?.workout_day),
  completed: log?.completed,
  durationSec: pick(log?.durationSec, log?.duration_sec),
});

export const toWorkoutLogRecords = (
  logs: readonly (AnyWorkoutLogShape | null | undefined)[] | null | undefined
): WorkoutLogRecord[] => (logs ?? []).map(toWorkoutLogRecord);

/** Which family a stored log belongs to. See `shared/workoutCompletion.ts`. */
export const classifyLog = (log: AnyWorkoutLogShape | null | undefined): WorkoutLogKind =>
  classifyWorkoutLog(toWorkoutLogRecord(log));

/** True only for a day/session record — never for an exercise or a set. */
export const isDaySessionLog = (log: AnyWorkoutLogShape | null | undefined): boolean =>
  classifyLog(log) === "day-session";

/** True only when this row is the day session record and it says completed. */
export const isCompletedDayLog = (log: AnyWorkoutLogShape | null | undefined): boolean =>
  isCompletedWorkoutDay(toWorkoutLogRecord(log));

/** The day session records among a set of logs, in their original order. */
export const filterDaySessionLogs = <T extends AnyWorkoutLogShape>(
  logs: readonly T[] | null | undefined
): T[] => (logs ?? []).filter((log) => isDaySessionLog(log));

/** Every completed plan day, once each. */
export const readCompletedDays = (
  logs: readonly (AnyWorkoutLogShape | null | undefined)[] | null | undefined
): WorkoutDayCompletion[] => readCompletedWorkoutDays(toWorkoutLogRecords(logs));

/** Every completed workout day as a `YYYY-MM-DD` calendar date, once each. */
export const readCompletedDayDates = (
  logs: readonly (AnyWorkoutLogShape | null | undefined)[] | null | undefined
): string[] => readCompletedWorkoutDayDates(toWorkoutLogRecords(logs));

/**
 * Whether a given plan position is completed.
 *
 * Converted one log at a time rather than up front: these run once per day
 * cell on every dashboard render, and `some` stops at the first match.
 */
export const isPlanDayComplete = (
  logs: readonly (AnyWorkoutLogShape | null | undefined)[] | null | undefined,
  weekKey: string,
  dayIndex: number
): boolean =>
  (logs ?? []).some((log) => isPlanDayCompleted([toWorkoutLogRecord(log)], weekKey, dayIndex));

/** Whether a given `YYYY-MM-DD` calendar day is completed. */
export const isCalendarDayComplete = (
  logs: readonly (AnyWorkoutLogShape | null | undefined)[] | null | undefined,
  workoutDay: string
): boolean =>
  (logs ?? []).some((log) => isWorkoutDayCompleted([toWorkoutLogRecord(log)], workoutDay));

export type { WorkoutDayCompletion, WorkoutLogKind };
