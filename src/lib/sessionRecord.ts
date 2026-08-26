import {
  collection, getDocs, query, where, addDoc, updateDoc, doc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
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

/**
 * Record the measured length of a finished session.
 *
 * Ending a session is **not** the same as completing the workout: the user can
 * finish at any point, and `handleCloseSummary` fires either way. So this
 * writes `durationSec` and the day's identity — and never touches `completed`.
 * Completion stays owned by the per-exercise logs, which record what was
 * actually done.
 *
 * The write is idempotent by construction: `durationSec` is set to an absolute
 * value, never incremented, so replaying it (a double-tap, a retry) stores the
 * same number rather than accumulating. When a day document already exists it
 * is updated in place, preserving its id and any completion state on it.
 */
export const recordSessionDuration = async (
  input: SessionRecordInput
): Promise<SessionRecordOutcome> => {
  const { uid, planId, weekKey, dayIndex, workoutDay, startedAt, endedAt } = input;

  if (!uid || !planId || !weekKey || !isWorkoutDayString(workoutDay)) {
    return { status: "skipped", reason: "incomplete-metadata" };
  }
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return { status: "skipped", reason: "incomplete-metadata" };
  }

  const durationSec = computeDurationSec(startedAt, endedAt);
  if (durationSec === null) {
    // A missing, future or implausible start time. Writing 0 here would be a
    // measurement claim we cannot make, so nothing is stored at all.
    return { status: "skipped", reason: "no-duration" };
  }

  const logsRef = collection(db, "users", uid, "workout_logs");
  const existing = await getDocs(
    query(logsRef, where("planId", "==", planId), where("workoutDay", "==", workoutDay))
  );

  if (!existing.empty) {
    await updateDoc(doc(db, "users", uid, "workout_logs", existing.docs[0].id), {
      weekKey,
      dayIndex,
      durationSec,
      durationMeasuredAt: Timestamp.now(),
    });
  } else {
    await addDoc(logsRef, {
      planId,
      weekKey,
      dayIndex,
      workoutDay,
      durationSec,
      durationMeasuredAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      // Deliberately absent: `completed`. Ending a session says nothing about
      // whether the workout was finished.
    });
  }

  return { status: "written", durationSec };
};
