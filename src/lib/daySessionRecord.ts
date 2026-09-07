import { collection, doc, getDocs, query, runTransaction, Timestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { assertAccountOwner } from "@/lib/accountIdentity";
import { isDaySessionLog } from "@/lib/workoutCompletion";
import { isWorkoutDayString } from "@/lib/workoutLog";

interface DaySessionIdentity {
  uid: string;
  planId: string;
  workoutDay: string;
}

/**
 * Shared by duration saves, day toggles and day-toggle replay. No historical repair.
 *
 * `uid` is the account this write is addressed to and therefore the account it
 * must still belong to. The check is intrinsic rather than a parameter a caller
 * supplies: an optional guard defaulting to a no-op let any caller opt out of
 * the invariant by simply not passing one, which is the opposite of what a
 * safe default should do. Every checkpoint below re-reads live identity, so an
 * account switch between the lookup and the commit stops the write instead of
 * completing it under whoever is signed in by then.
 */
export const writeDaySessionRecord = async (
  { uid, planId, workoutDay }: DaySessionIdentity,
  changes: { weekKey?: string; dayIndex?: number; durationSec?: number; durationMeasuredAt?: Timestamp;
    completed?: boolean; completedAt?: Timestamp | null },
  replayCheckpoint?: () => void,
): Promise<void> => {
  if (!uid || !planId || !isWorkoutDayString(workoutDay)) throw new Error("Invalid day session identity");

  const assertCanWrite = () => { assertAccountOwner(uid); replayCheckpoint?.(); };
  assertCanWrite();
  const logs = collection(db, "users", uid, "workout_logs");
  const matches = await getDocs(query(logs, where("planId", "==", planId), where("workoutDay", "==", workoutDay)));
  // PR #60's existing discriminator also excludes unreadable exercise indices.
  const existing = matches.docs.filter(row => isDaySessionLog(row.data()))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  // Concurrent first saves and retries converge on one address. Existing day
  // documents keep their IDs; no rows are moved, deleted or reclassified.
  const id = existing?.id ?? `day-session_${encodeURIComponent(planId)}_${workoutDay}`;
  const ref = doc(logs, id);
  assertCanWrite();
  await runTransaction(db, async transaction => {
    const current = await transaction.get(ref);
    assertCanWrite();
    if (current.exists()) {
      const data = current.data();
      if (data.planId !== planId || data.workoutDay !== workoutDay || !isDaySessionLog(data)) {
        throw new Error("Day session identity conflict");
      }
      transaction.update(ref, changes);
    } else {
      transaction.set(ref, { planId, workoutDay, ...changes, createdAt: Timestamp.now() });
    }
  });
};
