import { assertAccountOwner } from "@/lib/accountIdentity";
import { db } from "@/lib/firebase";
import {
  collection, getDocs, query, where, doc, setDoc, deleteDoc, updateDoc, runTransaction, Timestamp,
} from "firebase/firestore";
import { writeDaySessionRecord } from "@/lib/daySessionRecord";
import { queryKeys } from "@/lib/queryKeys";
import { isWorkoutDayString } from "@/lib/workoutLog";
import { isLegacyDayCompletionPayload, type ToggleDayPayload } from "@/lib/offlineQueue";

type ToggleSetPayload = {
  planId: string; weekKey: string; dayIndex: number; exerciseIndex: number;
  setNumber: number; repsCompleted: number; weightUsed?: number | null; completed: boolean;
  /** Carried through the queue so a replayed write dates the same day. */
  workoutDay?: string;
};
type ToggleExercisePayload = {
  planId: string; weekKey: string; dayIndex: number; exerciseIndex: number;
  completed: boolean; durationMinutes?: number; caloriesBurned?: number;
};

// Same existing position identity; only new replay documents get stable IDs.
// Existing auto-ID documents remain in place. No historical identity migration.
//
// A stable ID makes two replays address one document, which is the point — and
// the hazard. The lookup that decides "create" or "update" can report empty
// while the document exists: `getDocs` is served from a cold in-memory cache
// whenever the SDK considers itself offline, which is exactly the state a
// reconnecting replay runs in. With an auto-ID that miss cost a duplicate row;
// with this ID it would land on the real document. So neither create path here
// writes blind — each re-reads its own address inside a transaction first.
const replayLogId = (payload: ToggleExercisePayload | ToggleSetPayload) =>
  `offline-exercise_${encodeURIComponent(JSON.stringify([payload.planId, payload.weekKey, payload.dayIndex, payload.exerciseIndex]))}`;

export const handlers = {
  TOGGLE_SET: async (payload: ToggleSetPayload, ownerUid: string, checkpoint?: () => void) => {
    const assertCanWrite = () => { assertAccountOwner(ownerUid); checkpoint?.(); };
    const uid = assertAccountOwner(ownerUid);
    const logsRef = collection(db, "users", uid, "workout_logs");
    const logSnap = await getDocs(query(logsRef,
      where("planId",        "==", payload.planId),
      where("weekKey",       "==", payload.weekKey),
      where("dayIndex",      "==", payload.dayIndex),
      where("exerciseIndex", "==", payload.exerciseIndex),
    ));
    let logId: string;
    if (!logSnap.empty) { logId = [...logSnap.docs].sort((a, b) => a.id.localeCompare(b.id))[0].id; }
    else {
      // Create if absent, never replace. This branch exists only to give the
      // set somewhere to hang; it has nothing to say about the exercise. An
      // existing parent already carries the user's completion, duration and
      // date, and `completed: false` below is an initial value, not a desired
      // one — writing it over a finished exercise would un-complete it.
      logId = replayLogId(payload);
      const logRef = doc(logsRef, logId);
      assertCanWrite();
      await runTransaction(db, async transaction => {
        const current = await transaction.get(logRef);
        assertCanWrite();
        if (current.exists()) return;
        transaction.set(logRef, {
          planId: payload.planId, weekKey: payload.weekKey,
          dayIndex: payload.dayIndex, exerciseIndex: payload.exerciseIndex,
          ...(isWorkoutDayString(payload.workoutDay) ? { workoutDay: payload.workoutDay } : {}),
          completed: false, createdAt: Timestamp.now(),
        });
      });
    }
    assertCanWrite();
    const setsRef = collection(db, "users", uid, "workout_logs", logId, "workout_set_logs");
    const setSnap = await getDocs(query(setsRef, where("setNumber", "==", payload.setNumber)));
    assertCanWrite();
    if (payload.completed) {
      if (setSnap.empty) await setDoc(doc(setsRef, `set_${payload.setNumber}`), { setNumber: payload.setNumber, repsCompleted: payload.repsCompleted, weightUsed: payload.weightUsed ?? null, completedAt: Timestamp.now() });
    } else {
      if (!setSnap.empty) await deleteDoc(doc(db, "users", uid, "workout_logs", logId, "workout_set_logs", setSnap.docs[0].id));
    }
    return [
      queryKeys.sets.byDay(payload.planId, payload.weekKey, payload.dayIndex),
      queryKeys.completion.byWeek(payload.planId, payload.weekKey),
    ];
  },

  /**
   * One *exercise* position. The name is historical — see offlineQueue.ts.
   *
   * A pre-PR48 day completion could also land here, carrying only
   * `{workoutDateStr, completed}`. Replaying that as an exercise log would
   * write planId/weekKey/dayIndex/exerciseIndex as `undefined`, which is how
   * junk documents got into `workout_logs`. There is no way to recover the
   * plan position from that payload, and guessing one would attach the user's
   * completion to a day they never trained — so the entry is dropped, loudly.
   */
  TOGGLE_DAY_COMPLETION: async (payload: ToggleExercisePayload, ownerUid: string, checkpoint?: () => void) => {
    assertAccountOwner(ownerUid);
    // Bound to a boolean on purpose: as a type predicate this would narrow the
    // remaining branch to `never`, since the two shapes are disjoint.
    const isLegacyDayEntry: boolean = isLegacyDayCompletionPayload(payload);
    if (isLegacyDayEntry) {
      console.warn(
        '[OfflineQueue] Dropping a pre-PR48 day-completion entry: it carries a date but no plan position, and inventing one would date the completion wrongly.',
        { workoutDateStr: (payload as { workoutDateStr?: string }).workoutDateStr }
      );
      return [];
    }

    const uid = assertAccountOwner(ownerUid);
    const logsRef = collection(db, "users", uid, "workout_logs");
    const snap = await getDocs(query(logsRef,
      where("planId",        "==", payload.planId),
      where("weekKey",       "==", payload.weekKey),
      where("dayIndex",      "==", payload.dayIndex),
      where("exerciseIndex", "==", payload.exerciseIndex),
    ));
    assertAccountOwner(ownerUid);
    checkpoint?.();
    // What this operation actually asked for. Clearing `completedAt` on an
    // uncompletion is intended; nothing else here is.
    const completionChange = {
      completed: payload.completed, completedAt: payload.completed ? Timestamp.now() : null,
    };
    // An optional value the payload never carried is an absence, not an
    // instruction to erase the one already stored. `?? null` is right for a
    // document being created — it matches what the online writer stores — and
    // wrong for one being updated.
    const measurements = {
      ...(payload.durationMinutes !== undefined ? { durationMinutes: payload.durationMinutes } : {}),
      ...(payload.caloriesBurned !== undefined ? { caloriesBurned: payload.caloriesBurned } : {}),
    };
    if (!snap.empty) {
      await updateDoc(doc(db, "users", uid, "workout_logs", [...snap.docs].sort((a, b) => a.id.localeCompare(b.id))[0].id), completionChange);
    } else {
      // Same lookup miss as in TOGGLE_SET, same rule: re-read this exact
      // address before deciding whether this is a create or an edit.
      const logRef = doc(logsRef, replayLogId(payload));
      await runTransaction(db, async transaction => {
        const current = await transaction.get(logRef);
        assertAccountOwner(ownerUid);
        checkpoint?.();
        if (current.exists()) {
          transaction.update(logRef, { ...completionChange, ...measurements });
          return;
        }
        transaction.set(logRef, {
          planId: payload.planId, weekKey: payload.weekKey, dayIndex: payload.dayIndex,
          exerciseIndex: payload.exerciseIndex, ...completionChange, createdAt: Timestamp.now(),
          durationMinutes: payload.durationMinutes ?? null, caloriesBurned: payload.caloriesBurned ?? null,
        });
      });
    }
    return [
      queryKeys.completion.byWeek(payload.planId, payload.weekKey),
      queryKeys.logs.byPlan(payload.planId),
    ];
  },

  /**
   * A whole plan day, replayed with the same semantics as the online write in
   * `useWorkoutLogs.toggleDay`: use the guarded day/session writer to update or create
   * a day record without selecting an exercise row.
   *
   * The date travels in the payload, so a Tuesday queued offline still writes
   * Tuesday when it replays on Thursday. Nothing here reads a clock.
   */
  TOGGLE_DAY: async (payload: ToggleDayPayload, ownerUid: string, checkpoint?: () => void) => {
    const uid = assertAccountOwner(ownerUid);
    if (!payload.planId || !isWorkoutDayString(payload.workoutDay)) {
      console.warn('[OfflineQueue] Dropping a day completion with unusable metadata.', payload);
      return [];
    }

    await writeDaySessionRecord({ uid, planId: payload.planId, workoutDay: payload.workoutDay }, {
      weekKey: payload.weekKey,
      dayIndex: payload.dayIndex,
      completed: payload.completed,
      completedAt: payload.completed ? Timestamp.now() : null,
    }, checkpoint);

    return [
      queryKeys.logs.byPlan(payload.planId),
      queryKeys.completion.byWeek(payload.planId, payload.weekKey),
    ];
  },
};
