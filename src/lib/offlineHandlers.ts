import { assertAccountOwner } from "@/lib/accountIdentity";
import { db } from "@/lib/firebase";
import {
  collection, getDocs, query, where, doc, updateDoc, runTransaction, Timestamp,
} from "firebase/firestore";
import { writeDaySessionRecord } from "@/lib/daySessionRecord";
import { queryKeys } from "@/lib/queryKeys";
import { isWorkoutDayString } from "@/lib/workoutLog";
import {
  isLegacyDayCompletionPayload, type ToggleDayPayload, type UpdateSetPerformancePayload,
} from "@/lib/offlineQueue";
import { exercisePositionLogId, writeSetLogChange } from "@/lib/setLogWriter";
import { isValidPerformanceChange } from "@/lib/setPerformance";
import { readSetWritePosition } from "@/lib/setWriteIntents";

type ToggleSetPayload = {
  planId: string; weekKey: string; dayIndex: number; exerciseIndex: number;
  setNumber: number; completed: boolean;
  /** Carried through the queue so a replayed write dates the same day. */
  workoutDay?: string;
};
type ToggleExercisePayload = {
  planId: string; weekKey: string; dayIndex: number; exerciseIndex: number;
  completed: boolean; durationMinutes?: number; caloriesBurned?: number;
};

export const handlers = {
  /*
    Both set handlers go through the shared set writer, which finds existing
    documents by position, creates missing ones at position-derived addresses
    and re-reads every address inside a transaction - see setLogWriter.ts.
  */
  TOGGLE_SET: async (payload: ToggleSetPayload, ownerUid: string, checkpoint?: () => void) => {
    const assertCanWrite = () => { assertAccountOwner(ownerUid); checkpoint?.(); };
    const uid = assertAccountOwner(ownerUid);
    // Explicit fields, not a spread of the payload: an entry queued by an
    // older build still carries prescription-copied reps/weight, and they
    // must not reach the document as if they had been performed. Un-ticking
    // keeps whatever the user did record on the set.
    await writeSetLogChange(uid, {
      planId: payload.planId, weekKey: payload.weekKey, dayIndex: payload.dayIndex,
      exerciseIndex: payload.exerciseIndex, setNumber: payload.setNumber, workoutDay: payload.workoutDay,
    }, { kind: "completion", completed: payload.completed === true }, assertCanWrite);
    return [
      queryKeys.sets.byDay(payload.planId, payload.weekKey, payload.dayIndex),
      queryKeys.completion.byWeek(payload.planId, payload.weekKey),
    ];
  },

  /**
   * Recorded reps and/or weight for one set, as the user entered them.
   *
   * Nothing here touches completion. A malformed entry - an unusable position,
   * a value out of range, or neither value present - cannot be replayed
   * truthfully, so it is dropped loudly instead of written.
   */
  UPDATE_SET_PERFORMANCE: async (payload: UpdateSetPerformancePayload, ownerUid: string, checkpoint?: () => void) => {
    const assertCanWrite = () => { assertAccountOwner(ownerUid); checkpoint?.(); };
    const uid = assertAccountOwner(ownerUid);
    const position = readSetWritePosition(payload);
    if (!position || !isValidPerformanceChange(payload)) {
      console.warn('[OfflineQueue] Dropping a set performance entry with an unusable position or value.', payload);
      return [];
    }
    await writeSetLogChange(uid, { ...position, workoutDay: payload.workoutDay }, {
      kind: "performance",
      ...(payload.reps !== undefined ? { reps: payload.reps } : {}),
      ...(payload.weightKg !== undefined ? { weightKg: payload.weightKg } : {}),
    }, assertCanWrite);
    return [queryKeys.sets.byDay(position.planId, position.weekKey, position.dayIndex)];
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
      // The same position-derived address the set writer creates, and the
      // same lookup-miss rule: re-read it before deciding create or edit.
      const logRef = doc(logsRef, exercisePositionLogId(payload));
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
