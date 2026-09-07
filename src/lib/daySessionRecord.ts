import { collection, doc, getDocs, query, runTransaction, Timestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isDaySessionLog } from "@/lib/workoutCompletion";
import { isWorkoutDayString } from "@/lib/workoutLog";

interface DaySessionIdentity {
  uid: string;
  planId: string;
  workoutDay: string;
}

/** Shared by duration saves, day toggles and day-toggle replay. No historical repair. */
export const writeDaySessionRecord = async (
  { uid, planId, workoutDay }: DaySessionIdentity,
  changes: { weekKey?: string; dayIndex?: number; durationSec?: number; durationMeasuredAt?: Timestamp;
    completed?: boolean; completedAt?: Timestamp | null },
): Promise<void> => {
  if (!uid || !planId || !isWorkoutDayString(workoutDay)) throw new Error("Invalid day session identity");

  const logs = collection(db, "users", uid, "workout_logs");
  const matches = await getDocs(query(logs, where("planId", "==", planId), where("workoutDay", "==", workoutDay)));
  // PR #60's existing discriminator also excludes unreadable exercise indices.
  const existing = matches.docs.filter(row => isDaySessionLog(row.data()))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  // Concurrent first saves and retries converge on one address. Existing day
  // documents keep their IDs; no rows are moved, deleted or reclassified.
  const id = existing?.id ?? `day-session_${encodeURIComponent(planId)}_${workoutDay}`;
  const ref = doc(logs, id);
  await runTransaction(db, async transaction => {
    const current = await transaction.get(ref);
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
