/**
 * What counts as a completed workout day.
 *
 * `users/{uid}/workout_logs` holds two families of document that share most of
 * their field names, and this module is the one place that tells them apart:
 *
 *   Day sessions — `{planId, workoutDay, weekKey?, dayIndex?, completed,
 *     completedAt, durationSec?}`, written by `useWorkoutLogs.toggleDay`, the
 *     `TOGGLE_DAY` offline handler and `recordSessionDuration`. One document
 *     per plan day. This is the only record that can say a workout day was
 *     completed.
 *
 *   Exercise positions — `{planId, weekKey, dayIndex, exerciseIndex,
 *     completed, ...}`, written by `useWeekCompletion.toggleExercise`,
 *     `useSetTracking.toggleSet` and both offline handlers. Set logs hang off
 *     these as a subcollection. One document per exercise, and its `completed`
 *     means *that exercise* was ticked off — never the day.
 *
 * Both families carry `weekKey`, `dayIndex` and `completed`, so those three
 * fields alone cannot distinguish them: reading them as a day completion turns
 * a single ticked exercise into a finished training day. `exerciseIndex` is
 * what separates the two — it is written by every exercise-position path and
 * by none of the day paths — so it, not the presence of a completion flag, is
 * the discriminator here.
 *
 * Everything below is a pure predicate over stored fields. It reads the
 * documents the app already writes; nothing is migrated, rewritten or
 * inferred. A row that cannot be proven to be a completed day session is
 * reported as not completed rather than guessed at, because the cost of
 * over-counting is telling somebody they trained when they did not.
 */

/** A stored `workout_logs` document, as loosely as it may actually be shaped. */
export interface WorkoutLogRecord {
  weekKey?: unknown;
  dayIndex?: unknown;
  exerciseIndex?: unknown;
  workoutDay?: unknown;
  completed?: unknown;
  durationSec?: unknown;
}

/**
 * Which family a stored document belongs to.
 *
 * `"unknown"` is a real answer and not a failure: a legacy row with neither an
 * exercise position nor a day identity (the junk the pre-PR48 offline replay
 * could write) is not evidence of anything, and saying so is more useful than
 * forcing it into one of the two families.
 */
export type WorkoutLogKind = "day-session" | "exercise" | "unknown";

/** A completed day, identified by its position in the plan. */
export interface WorkoutDayCompletion {
  weekKey: string;
  dayIndex: number;
}

/** `YYYY-MM-DD`, the form every day log's `workoutDay` is written in. */
const WORKOUT_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A usable `"Week 1"`-style key, or null. */
export const readLogWeekKey = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

/** A usable Monday-based day index (0..6), or null. */
export const readLogDayIndex = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6 ? value : null;

/** A usable `YYYY-MM-DD` calendar day, or null. */
export const readLogWorkoutDay = (value: unknown): string | null =>
  typeof value === "string" && WORKOUT_DAY_PATTERN.test(value) ? value : null;

/**
 * Whether the document is positioned at an exercise rather than at a day.
 *
 * Deliberately `!= null` rather than "is a number": a row that carries an
 * `exerciseIndex` the app cannot read is still a row somebody wrote at an
 * exercise position, and promoting it to a day session would be exactly the
 * guess this module exists to avoid.
 */
export const hasExercisePosition = (log: WorkoutLogRecord): boolean =>
  log.exerciseIndex !== undefined && log.exerciseIndex !== null;

/** Whether the document can be placed on a specific day of a specific week. */
export const hasPlanPosition = (log: WorkoutLogRecord): boolean =>
  readLogWeekKey(log.weekKey) !== null && readLogDayIndex(log.dayIndex) !== null;

/**
 * Which family a stored document belongs to.
 *
 * A day session is a row with no exercise position that can still be placed on
 * a day — by its `workoutDay`, or by `weekKey` + `dayIndex`. Anything else is
 * unknown.
 */
export const classifyWorkoutLog = (log: WorkoutLogRecord | null | undefined): WorkoutLogKind => {
  if (!log) return "unknown";
  if (hasExercisePosition(log)) {
    const index = log.exerciseIndex;
    const readable = typeof index === "number" && Number.isInteger(index) && index >= 0;
    // Either way it is not a day session; the distinction only says whether
    // the row is a readable exercise log or unreadable history.
    return readable ? "exercise" : "unknown";
  }
  if (readLogWorkoutDay(log.workoutDay) !== null || hasPlanPosition(log)) return "day-session";
  return "unknown";
};

/** True only for the day/session record — never for an exercise or a set. */
export const isDaySessionLog = (log: WorkoutLogRecord | null | undefined): boolean =>
  classifyWorkoutLog(log) === "day-session";

/**
 * **The authoritative rule.** A workout day is completed when — and only when —
 * its day session record says `completed: true`.
 *
 * A completed exercise, every set of an exercise, a measured duration, the
 * mere existence of logs and any percentage of progress are all explicitly not
 * evidence of a completed day. `completed` is compared to `true` rather than
 * coerced, so a truthy legacy value (`"yes"`, `1`) stays uncounted instead of
 * becoming a completion nobody recorded.
 */
export const isCompletedWorkoutDay = (log: WorkoutLogRecord | null | undefined): boolean =>
  isDaySessionLog(log) && log?.completed === true;

/** The day sessions among a set of logs, in their original order. */
export const readDaySessionLogs = <T extends WorkoutLogRecord>(
  logs: readonly T[]
): T[] => logs.filter((log) => isDaySessionLog(log));

/**
 * Every completed workout day that can be placed in the plan, once each.
 *
 * De-duplicated on `weekKey` + `dayIndex`, so a day that somehow carries two
 * completed session rows still counts as one training day — a completion count
 * that can exceed the number of planned days is not a count of days.
 *
 * A completed day session with no plan position (a pre-PR48 day log, which
 * carries only a date whose derivation may be wrong) is left out: it is a real
 * completion the week simply cannot place, and understating the week is the
 * safer error.
 */
export const readCompletedWorkoutDays = (
  logs: readonly WorkoutLogRecord[]
): WorkoutDayCompletion[] => {
  const seen = new Set<string>();
  const completions: WorkoutDayCompletion[] = [];

  logs.forEach((log) => {
    if (!isCompletedWorkoutDay(log)) return;
    const weekKey = readLogWeekKey(log.weekKey);
    const dayIndex = readLogDayIndex(log.dayIndex);
    if (weekKey === null || dayIndex === null) return;

    const key = `${weekKey}|${dayIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    completions.push({ weekKey, dayIndex });
  });

  return completions;
};

/**
 * Every completed workout day as a `YYYY-MM-DD` calendar date, once each.
 *
 * The date-addressed counterpart of `readCompletedWorkoutDays`, for the
 * surfaces that count days inside a calendar week rather than inside a plan
 * week. De-duplicated for the same reason: two session rows on one date are
 * still one training day.
 */
export const readCompletedWorkoutDayDates = (
  logs: readonly WorkoutLogRecord[]
): string[] => {
  const days: string[] = [];
  const seen = new Set<string>();

  logs.forEach((log) => {
    if (!isCompletedWorkoutDay(log)) return;
    const workoutDay = readLogWorkoutDay(log.workoutDay);
    if (workoutDay === null || seen.has(workoutDay)) return;
    seen.add(workoutDay);
    days.push(workoutDay);
  });

  return days;
};

/** Whether a specific plan day is completed, given the whole log set. */
export const isPlanDayCompleted = (
  logs: readonly WorkoutLogRecord[],
  weekKey: string,
  dayIndex: number
): boolean =>
  logs.some(
    (log) =>
      isCompletedWorkoutDay(log) &&
      readLogWeekKey(log.weekKey) === weekKey &&
      readLogDayIndex(log.dayIndex) === dayIndex
  );

/**
 * Whether the calendar day `workoutDay` was completed.
 *
 * The date-addressed form of the same rule, for the surfaces that hold a
 * calendar day rather than a plan position. Still a day-session-only check: an
 * exercise row that happens to carry a `workoutDay` — set tracking writes one
 * — never answers this question.
 */
export const isWorkoutDayCompleted = (
  logs: readonly WorkoutLogRecord[],
  workoutDay: string
): boolean =>
  logs.some((log) => isCompletedWorkoutDay(log) && readLogWorkoutDay(log.workoutDay) === workoutDay);
