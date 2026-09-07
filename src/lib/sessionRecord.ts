import { Timestamp } from "firebase/firestore";
import { writeDaySessionRecord } from "@/lib/daySessionRecord";
import { isBerlinFuture } from "@/lib/dateUtils";
import {
  computeDurationSec,
  isWorkoutDayString,
  type WorkoutLogMetadata,
} from "@/lib/workoutLog";

/**
 * Persisting how long a training session actually ran.
 *
 * Before PR47 the session existed only in localStorage and `endSession` threw
 * it away, so no measured duration survived anywhere. Weekly activity filled
 * the gap with `MINUTES_PER_EXERCISE = 10` — a constant, not a measurement.
 *
 * The duration is written onto the plan-day's `workout_logs` document, which
 * already exists as the day-scoped record `useWeeklyActivity` reads. No new
 * collection, and the shape stays additive.
 *
 * This module deliberately knows nothing about React so the write can be tested
 * against a mocked Firestore without rendering anything.
 */

export interface SessionRecordInput extends WorkoutLogMetadata {
  uid: string;
  /** Epoch ms the session started, as persisted through any reload. */
  startedAt: number | null;
  /** Epoch ms the user ended it. Injected so tests can pin the clock. */
  endedAt: number;
}

export type SessionRecordOutcome =
  /** A duration was measured and written. */
  | { status: "written"; durationSec: number }
  /** The elapsed time was not trustworthy, so nothing was written. */
  | { status: "skipped"; reason: "no-duration" }
  /** The metadata was incomplete, so there was no document to write to. */
  | { status: "skipped"; reason: "incomplete-metadata" };

export class FutureWorkoutDayError extends Error {
  constructor() {
    super("Future workout days cannot be completed");
    this.name = "FutureWorkoutDayError";
  }
}

/**
 * Record the measured length of a finished session.
 *
 * Duration alone never completes a workout. Callers recording only a duration
 * retain this contract; the explicit successful finish action below opts into
 * completion in the same guarded write.
 *
 * The write is idempotent by construction: `durationSec` is set to an absolute
 * value, never incremented, so replaying it (a double-tap, a retry) stores the
 * same number rather than accumulating. When a day document already exists it
 * is updated in place, preserving its id and any completion state on it.
 */
export const recordSessionDuration = async (
  input: SessionRecordInput
): Promise<SessionRecordOutcome> => writeSessionRecord(input, false);

/**
 * The summary's deliberate save-and-finish action. A written result acknowledges
 * duration AND completion together. PR #62's skipped result still means terminal
 * closure without saved-training success, so it writes neither. No checked-set
 * threshold, timer callback or duration-only caller can invoke completion.
 */
export const recordSuccessfulWorkoutFinish = async (
  input: SessionRecordInput
): Promise<SessionRecordOutcome> => writeSessionRecord(input, true);

const writeSessionRecord = async (
  input: SessionRecordInput,
  completeWorkout: boolean,
): Promise<SessionRecordOutcome> => {
  const { uid, planId, weekKey, dayIndex, workoutDay, startedAt, endedAt } = input;

  if (!uid || !planId || !weekKey || !isWorkoutDayString(workoutDay)) {
    return { status: "skipped", reason: "incomplete-metadata" };
  }
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return { status: "skipped", reason: "incomplete-metadata" };
  }

  // Use the same current Berlin day as Dashboard.toggleDayComplete. Check the
  // bound date, not the selected UI day or a supplied/frozen finish timestamp.
  // Reject before any duration or completion write, even for hydrated sessions.
  if (completeWorkout && isBerlinFuture(workoutDay)) throw new FutureWorkoutDayError();

  const durationSec = computeDurationSec(startedAt, endedAt);
  if (durationSec === null) {
    // A missing, future or implausible start time. Writing 0 here would be a
    // measurement claim we cannot make, so nothing is stored at all.
    return { status: "skipped", reason: "no-duration" };
  }

  await writeDaySessionRecord({ uid, planId, workoutDay }, {
    weekKey,
    dayIndex,
    durationSec,
    durationMeasuredAt: Timestamp.now(),
    // Replays use the frozen first finish instant, never the retry clock.
    ...(completeWorkout ? { completed: true, completedAt: Timestamp.fromMillis(endedAt) } : {}),
  });

  return { status: "written", durationSec };
};
