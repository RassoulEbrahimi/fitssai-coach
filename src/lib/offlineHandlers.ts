import { auth } from "@/lib/firebase";
import { db } from "@/lib/firebase";
import {
  collection, getDocs, query, where, doc, addDoc, deleteDoc, updateDoc, Timestamp,
} from "firebase/firestore";
import { queryKeys } from "@/lib/queryKeys";

type ToggleSetPayload = {
  planId: string; weekKey: string; dayIndex: number; exerciseIndex: number;
  setNumber: number; repsCompleted: number; weightUsed?: number | null; completed: boolean;
};
type ToggleDayPayload = {
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

  TOGGLE_DAY_COMPLETION: async (payload: ToggleDayPayload) => {
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
};
