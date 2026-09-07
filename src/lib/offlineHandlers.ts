import { auth } from "@/lib/firebase";
import { db } from "@/lib/firebase";
import {
  collection, getDocs, query, where, doc, addDoc, deleteDoc, updateDoc, Timestamp,
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

export const handlers = {
  TOGGLE_SET: async (payload: ToggleSetPayload) => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("Not authenticated");
    const logsRef = collection(db, "users", uid, "workout_logs");
    const logSnap = await getDocs(query(logsRef,
      where("planId",        "==", payload.planId),
      where("weekKey",       "==", payload.weekKey),
      where("dayIndex",      "==", payload.dayIndex),
      where("exerciseIndex", "==", payload.exerciseIndex),
    ));
    let logId: string;
    if (!logSnap.empty) { logId = logSnap.docs[0].id; }
    else {
      const newLog = await addDoc(logsRef, {
        planId: payload.planId, weekKey: payload.weekKey,
        dayIndex: payload.dayIndex, exerciseIndex: payload.exerciseIndex,
        ...(isWorkoutDayString(payload.workoutDay) ? { workoutDay: payload.workoutDay } : {}),
        completed: false, createdAt: Timestamp.now(),
      });
      logId = newLog.id;
    }
    const setsRef = collection(db, "users", uid, "workout_logs", logId, "workout_set_logs");
    const setSnap = await getDocs(query(setsRef, where("setNumber", "==", payload.setNumber)));
    if (payload.completed) {
      if (setSnap.empty) await addDoc(setsRef, { setNumber: payload.setNumber, repsCompleted: payload.repsCompleted, weightUsed: payload.weightUsed ?? null, completedAt: Timestamp.now() });
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
  TOGGLE_DAY_COMPLETION: async (payload: ToggleExercisePayload) => {
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

    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("Not authenticated");
    const logsRef = collection(db, "users", uid, "workout_logs");
    const snap = await getDocs(query(logsRef,
      where("planId",        "==", payload.planId),
      where("weekKey",       "==", payload.weekKey),
      where("dayIndex",      "==", payload.dayIndex),
      where("exerciseIndex", "==", payload.exerciseIndex),
    ));
    if (!snap.empty) {
      await updateDoc(doc(db, "users", uid, "workout_logs", snap.docs[0].id), {
        completed: payload.completed, completedAt: payload.completed ? Timestamp.now() : null,
      });
    } else {
      await addDoc(logsRef, {
        planId: payload.planId, weekKey: payload.weekKey, dayIndex: payload.dayIndex,
        exerciseIndex: payload.exerciseIndex, completed: payload.completed,
        completedAt: payload.completed ? Timestamp.now() : null, createdAt: Timestamp.now(),
        durationMinutes: payload.durationMinutes ?? null, caloriesBurned: payload.caloriesBurned ?? null,
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
  TOGGLE_DAY: async (payload: ToggleDayPayload) => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("Not authenticated");
    if (!payload.planId || !isWorkoutDayString(payload.workoutDay)) {
      console.warn('[OfflineQueue] Dropping a day completion with unusable metadata.', payload);
      return [];
    }

    await writeDaySessionRecord({ uid, planId: payload.planId, workoutDay: payload.workoutDay }, {
      weekKey: payload.weekKey,
      dayIndex: payload.dayIndex,
      completed: payload.completed,
      completedAt: payload.completed ? Timestamp.now() : null,
    });

    return [
      queryKeys.logs.byPlan(payload.planId),
      queryKeys.completion.byWeek(payload.planId, payload.weekKey),
    ];
  },
};
