import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { TARGET_TIMEZONE } from "./dateUtils";

/**
 * Shared shape and helpers for `users/{uid}/workout_logs` documents.
 *
 * The collection holds documents written by four different call sites that grew
 * apart over time, in two families:
 *
 *   Exercise-position logs — `{planId, weekKey, dayIndex, exerciseIndex, ...}`
 *     written by `useWeekCompletion.toggleExercise`, `useSetTracking.toggleSet`
 *     and both offline handlers. Set logs hang off these as a subcollection.
 *
 *   Day logs — `{planId, workoutDay, completed, completedAt}`
 *     written by `useWorkoutLogs.toggleDay`, read by `useWeeklyActivity`.
 *
 * Neither family carried enough metadata to join a set back to a calendar day,
 * and no session duration was ever stored. This module defines what *new*
 * writes carry. It is purely additive: nothing here is required to be present
 * on a document, every reader tolerates its absence, and no existing field is
 * removed or rewritten. Old documents stay exactly as they are.
 */

/** `YYYY-MM-DD` in Europe/Berlin — the app's calendar-day authority. */
export type WorkoutDayString = string;

/**
 * Metadata every new `workout_logs` write carries, so a document can be placed
 * on a calendar without reconstructing it from the plan's start date.
 */
export interface WorkoutLogMetadata {
  planId: string;
  weekKey: string;
  dayIndex: number;
  workoutDay: WorkoutDayString;
}

/**
 * A log as read back. Every field beyond `id` is optional: documents written
 * before this module existed carry only some of them, and readers must cope.
 */
export interface StoredWorkoutLog {
  id: string;
  planId?: string | null;
  weekKey?: string | null;
  dayIndex?: number | null;
  exerciseIndex?: number | null;
  workoutDay?: WorkoutDayString | null;
  completed?: boolean | null;
  /** Measured wall-clock seconds. Absent on every pre-PR47 document. */
  durationSec?: number | null;
}

/** A day's worth of exercise is not a plausible session; treat longer as bogus. */
export const MAX_SESSION_SEC = 12 * 60 * 60;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Measured session length in whole seconds, or `null` when it cannot be
 * trusted.
 *
 * Returns null rather than 0 for every failure mode, because 0 would read as
 * "trained for no time" and end up in an average. Rejected: a missing or
 * non-numeric start, a start in the future (a clock change mid-session, or a
 * tampered payload), and a span longer than `MAX_SESSION_SEC` — which is what a
 * session left running overnight looks like.
 */
export const computeDurationSec = (
  startedAt: number | null | undefined,
  endedAt: number
): number | null => {
  if (!isFiniteNumber(startedAt) || startedAt <= 0) return null;
  if (!isFiniteNumber(endedAt)) return null;

  const elapsedMs = endedAt - startedAt;
  if (elapsedMs < 0) return null;

  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds > MAX_SESSION_SEC) return null;

  return seconds;
};

/**
 * `YYYY-MM-DD` for a date, read as a Berlin wall-clock day.
 *
 * Formatting a UTC instant directly would move the day across midnight for
 * anyone west of Berlin, so the instant is shifted into the zone first.
 */
export const toWorkoutDay = (date: Date): WorkoutDayString =>
  format(toZonedTime(date, TARGET_TIMEZONE), "yyyy-MM-dd");

/** True for a well-formed `YYYY-MM-DD`. Used to keep junk out of new writes. */
export const isWorkoutDayString = (value: unknown): value is WorkoutDayString =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Measured minutes across logs, and how many sessions had no measurement.
 *
 * Only real durations are summed. Sessions without one are counted separately
 * instead of contributing zero, so a caller can say "at least this much" rather
 * than presenting a partial total as if it were complete.
 */
export interface MeasuredDuration {
  /** Whole minutes, summed from `durationSec` only. */
  measuredMinutes: number;
  /** Logs that carried a usable `durationSec`. */
  measuredCount: number;
  /** Logs with no usable `durationSec` — pre-PR47 documents, mostly. */
  unmeasuredCount: number;
}

/** A stored duration is usable only if it is a sane, finite, positive span. */
export const readDurationSec = (value: unknown): number | null => {
  if (!isFiniteNumber(value)) return null;
  if (value <= 0) return null;
  if (value > MAX_SESSION_SEC) return null;
  return Math.floor(value);
};

export const summariseMeasuredDuration = (
  logs: readonly Pick<StoredWorkoutLog, "durationSec">[]
): MeasuredDuration => {
  let totalSec = 0;
  let measuredCount = 0;
  let unmeasuredCount = 0;

  logs.forEach((log) => {
    const seconds = readDurationSec(log.durationSec);
    if (seconds === null) {
      unmeasuredCount += 1;
      return;
    }
    totalSec += seconds;
    measuredCount += 1;
  });

  return {
    measuredMinutes: Math.round(totalSec / 60),
    measuredCount,
    unmeasuredCount,
  };
};

/**
 * Whether a stored log carries the full metadata new writes produce.
 *
 * Two kinds of row predate that: documents written before PR47 (no
 * `workoutDay` on set logs, no `durationSec` anywhere), and day completions
 * written by the pre-PR47 `addDays(created_at)` path, whose `workoutDay` can
 * be off by the plan's offset from Monday when the plan was not created on a
 * Monday.
 *
 * This only reports; it never mutates, and no migration exists. It lets a
 * consumer decide for itself how much weight to give partial history rather
 * than silently mixing the two.
 */
export const hasCanonicalMetadata = (log: StoredWorkoutLog): boolean =>
  typeof log.planId === "string" && log.planId.length > 0 &&
  typeof log.weekKey === "string" && log.weekKey.length > 0 &&
  typeof log.dayIndex === "number" && Number.isInteger(log.dayIndex) &&
  isWorkoutDayString(log.workoutDay);

export interface HistoryCoverage {
  total: number;
  /** Rows a date-sensitive metric can trust without reconstruction. */
  canonical: number;
  /** Rows missing some metadata; their dates may predate the date fix. */
  partial: number;
}

export const summariseHistoryCoverage = (
  logs: readonly StoredWorkoutLog[]
): HistoryCoverage => {
  const canonical = logs.filter(hasCanonicalMetadata).length;
  return { total: logs.length, canonical, partial: logs.length - canonical };
};
