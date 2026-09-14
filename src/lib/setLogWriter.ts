import { collection, doc, getDocs, query, runTransaction, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isWorkoutDayString } from "@/lib/workoutLog";
import { planSetLogWrite, type SetLogChange } from "@/lib/setPerformance";
import type { ExerciseWritePosition, SetWritePosition } from "@/lib/setWriteIntents";

/**
 * The one writer for a planned set's document, online and in offline replay.
 *
 * Both used to find-or-create in their own way: online by query and `addDoc`,
 * replay by query and a blind `setDoc`. A blind write was harmless while a set
 * document said nothing but "ticked"; now it can carry recorded reps and
 * weight, and replacing it on a lookup miss would erase them. So the document
 * is re-read inside a transaction and changed through `planSetLogWrite`,
 * wherever the change comes from.
 *
 * Existing auto-ID documents stay where they are: a set is found by its
 * position, and the first match - by parent id, then document id - is the
 * one written. The set reader in `useSetTracking` uses the same order, so the
 * document written is the document shown. Only a set with no document yet is
 * created, at a position-derived address.
 *
 * `checkpoint` runs after every await and inside each transaction: account
 * ownership for a live write, account and queue claim for a replay.
 */

/*
  Position-derived ID for an exercise log with none yet. The `offline-` prefix
  is historical - replay introduced it - and is kept so the online writer lands
  on parents replay already created instead of adding a second one.

  A stable ID makes two writers address one document, which is the point, and
  the hazard: the lookup that decides "create" can report empty while the
  document exists - `getDocs` is served from a cold in-memory cache whenever
  the SDK considers itself offline. So a create never writes blind; it re-reads
  its own address inside a transaction first.
*/
export const exercisePositionLogId = (position: ExerciseWritePosition): string =>
  `offline-exercise_${encodeURIComponent(JSON.stringify([position.planId, position.weekKey, position.dayIndex, position.exerciseIndex]))}`;

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/** Un-ticking or clearing never needs a document that does not exist. */
const mayCreate = (change: SetLogChange): boolean =>
  change.kind === "completion"
    ? change.completed
    : (change.reps !== undefined && change.reps !== null) ||
      (change.weightKg !== undefined && change.weightKg !== null);

export const writeSetLogChange = async (
  uid: string,
  target: SetWritePosition & { workoutDay?: string },
  change: SetLogChange,
  checkpoint: () => void
): Promise<void> => {
  checkpoint();
  const logsRef = collection(db, "users", uid, "workout_logs");
  const logSnap = await getDocs(query(logsRef,
    where("planId",        "==", target.planId),
    where("weekKey",       "==", target.weekKey),
    where("dayIndex",      "==", target.dayIndex),
    where("exerciseIndex", "==", target.exerciseIndex),
  ));
  checkpoint();
  const parentIds = [...logSnap.docs].sort(byId).map((logDoc) => logDoc.id);

  let address: { logId: string; setId: string } | undefined;
  for (const logId of parentIds) {
    const setsRef = collection(db, "users", uid, "workout_logs", logId, "workout_set_logs");
    const setSnap = await getDocs(query(setsRef, where("setNumber", "==", target.setNumber)));
    checkpoint();
    const existing = [...setSnap.docs].sort(byId)[0];
    if (existing) {
      address = { logId, setId: existing.id };
      break;
    }
  }

  if (!address) {
    const logId = parentIds[0] ?? exercisePositionLogId(target);
    if (parentIds.length === 0 && mayCreate(change)) {
      // Create if absent, never replace. This parent exists only to give the
      // set somewhere to hang; an existing one already carries the user's
      // exercise completion and date, and `completed: false` is an initial
      // value, not a desired one.
      const logRef = doc(logsRef, logId);
      await runTransaction(db, async (transaction) => {
        const current = await transaction.get(logRef);
        checkpoint();
        if (current.exists()) return;
        transaction.set(logRef, {
          planId: target.planId, weekKey: target.weekKey,
          dayIndex: target.dayIndex, exerciseIndex: target.exerciseIndex,
          // Lets a set be placed on a calendar without re-deriving the date
          // from the plan's start Monday.
          ...(isWorkoutDayString(target.workoutDay) ? { workoutDay: target.workoutDay } : {}),
          completed: false, createdAt: Timestamp.now(),
        });
      });
      checkpoint();
    }
    address = { logId, setId: `set_${target.setNumber}` };
  }

  const setRef = doc(db, "users", uid, "workout_logs", address.logId, "workout_set_logs", address.setId);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(setRef);
    checkpoint();
    const plan = planSetLogWrite(
      current.exists() ? current.data() : undefined,
      target.setNumber,
      change,
      () => Timestamp.now(),
    );
    if (plan.type === "write") transaction.set(setRef, plan.data);
    else if (plan.type === "delete") transaction.delete(setRef);
  });
};
