import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { beginAccountOperation } from "@/lib/accountIdentity";
import { useSupabaseAction } from "@/hooks/useSupabaseAction";
import { queryKeys } from "@/lib/queryKeys";
import { writeSetLogChange } from "@/lib/setLogWriter";
import {
  applySetLogChangeToState,
  InvalidSetPerformanceError,
  isValidPerformanceChange,
  readSetLogState,
  type ActualSetPerformance,
  type SetLogChange,
  type SetLogState,
} from "@/lib/setPerformance";
import {
  getSetWritesSnapshot,
  hasQueuedSetWrite,
  nextSetWriteSeq,
  setChangesOverRead,
  subscribeSetWrites,
  trackSetWrite,
  whenSetWritesSettled as waitForSetWrites,
  type PositionedSetChange,
  type SetWritePosition,
} from "@/lib/setWriteIntents";

/**
 * Two separate writes to a planned set that never imply each other.
 *
 * Ticking records completion. There are deliberately no reps or weight in it:
 * the checkbox knows the plan's prescription, not what the user performed, and
 * copying one into the other is how set logs came to hold "measurements"
 * nobody measured. Recording performance writes what the user entered, and
 * does not finish the set.
 */
interface SetWriteParams {
  planId: string; weekKey: string; dayIndex: number; exerciseIndex: number; setNumber: number;
  /**
   * `YYYY-MM-DD` for the day being logged, from the date the user actually has
   * selected — not "today". Logging a set against a past day must record that
   * day. Optional so an older caller still produces a valid document.
   */
  workoutDay?: string;
}

interface ToggleSetParams extends SetWriteParams {
  completed: boolean;
}

interface UpdateSetPerformanceParams extends SetWriteParams {
  /** Performed reps. `null` clears them; `undefined` leaves them as they are. */
  reps?: number | null;
  /** Performed load in kg. `null` clears it; `undefined` leaves it as it is. */
  weightKg?: number | null;
}

interface SetWriteResult { success: boolean; queued?: boolean }

interface SetLog {
  id: string; workout_log_id: string; set_number: number; completed_at: string;
  /** Ticked off. A set can carry recorded performance and still be open. */
  completed: boolean;
  /** Reps/weight only when explicitly recorded as performed; see setPerformance.ts. */
  actual: ActualSetPerformance;
}

type SetsMap = Record<number, Record<number, SetLog>>;

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/**
 * When each server read of a day started, keyed by the object it returned.
 * Kept beside the cached data rather than in it: the cache stays exactly what
 * the server said. See setWriteIntents.ts for why the start matters.
 */
const readStarts = new WeakMap<object, number>();

const readStartOf = (data: SetsMap | undefined): number => {
  if (!data) return 0;
  let start = readStarts.get(data);
  if (start === undefined) {
    // Data this hook did not fetch - seeded or restored from a persisted
    // cache - counts as read when first seen.
    start = nextSetWriteSeq();
    readStarts.set(data, start);
  }
  return start;
};

const UNVERIFIED: ActualSetPerformance = { source: "unverified", reps: null, weightKg: null };

const stateOf = (log: SetLog): SetLogState => ({
  completed: log.completed !== false,
  actual: log.actual ?? UNVERIFIED,
  completedAt: log.completed_at,
});

const nowIso = () => new Date().toISOString();

/** Server sets with pending changes laid over them, touching only the sets they name. */
const overlaySets = (server: SetsMap, changes: PositionedSetChange[]): SetsMap => {
  if (changes.length === 0) return server;
  const next: SetsMap = { ...server };
  for (const { position: { exerciseIndex, setNumber }, change } of changes) {
    const current = next[exerciseIndex]?.[setNumber];
    const currentState = current && stateOf(current);
    let state: SetLogState | undefined;
    try {
      state = applySetLogChangeToState(currentState, setNumber, change, nowIso);
    } catch {
      continue;
    }
    if (state === currentState) continue;
    const sets = { ...(next[exerciseIndex] ?? {}) };
    if (!state) {
      delete sets[setNumber];
    } else {
      sets[setNumber] = {
        id: current?.id ?? "optimistic",
        workout_log_id: current?.workout_log_id ?? "optimistic",
        set_number: setNumber,
        completed_at: typeof state.completedAt === "string" ? state.completedAt : "",
        completed: state.completed,
        actual: state.actual,
      };
    }
    next[exerciseIndex] = sets;
  }
  return next;
};

const positionOf = (params: SetWriteParams): SetWritePosition => ({
  planId: params.planId, weekKey: params.weekKey, dayIndex: params.dayIndex,
  exerciseIndex: params.exerciseIndex, setNumber: params.setNumber,
});

const performanceChange = (params: UpdateSetPerformanceParams): SetLogChange => ({
  kind: "performance",
  ...(params.reps !== undefined ? { reps: params.reps } : {}),
  ...(params.weightKg !== undefined ? { weightKg: params.weightKg } : {}),
});

/** The SDK's own shape for "the backend could not be reached". Worth a durable queue entry. */
const isFirestoreUnavailable = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === "unavailable";

export function useSetTracking(planId: string | undefined, weekKey: string, dayIndex: number) {
  const { user } = useAuth();
  const ownerUid = user?.uid;
  const queryClient = useQueryClient();
  const queryKey = queryKeys.sets.byDay(planId, weekKey, dayIndex);

  const { data: serverSets, isLoading: isLoadingSets, refetch: refetchSets } = useQuery({
    queryKey,
    queryFn: async () => {
      const setsMap: SetsMap = {};
      readStarts.set(setsMap, nextSetWriteSeq());
      if (!user || !planId) return setsMap;
      // Get workout_logs for this plan/week/day
      const logsRef = collection(db, "users", user.uid, "workout_logs");
      const logSnap = await getDocs(query(logsRef,
        where("planId",   "==", planId),
        where("weekKey",  "==", weekKey),
        where("dayIndex", "==", dayIndex),
      ));

      const parents = await Promise.all([...logSnap.docs].sort(byId).map(async (logDoc) => {
        const exerciseIndex: number = logDoc.data().exerciseIndex ?? -1;
        if (exerciseIndex < 0) return null;
        const setsRef = collection(db, "users", user.uid, "workout_logs", logDoc.id, "workout_set_logs");
        const setsSnap = await getDocs(setsRef);
        return { logId: logDoc.id, exerciseIndex, docs: [...setsSnap.docs].sort(byId) };
      }));

      // One document per set: the first by parent id, then document id - the
      // same one the set writer changes, so what is shown is what is written.
      for (const parent of parents) {
        if (!parent) continue;
        const sets = (setsMap[parent.exerciseIndex] ??= {});
        for (const setDoc of parent.docs) {
          const data = setDoc.data();
          if (sets[data.setNumber]) continue;
          // Older documents carry prescription-copied numbers; this reads
          // them as unverified rather than as performance, and every document
          // without an explicit open marker as completed.
          const state = readSetLogState(data);
          sets[data.setNumber] = {
            id: setDoc.id, workout_log_id: parent.logId,
            set_number: data.setNumber,
            completed: state.completed,
            actual: state.actual,
            completed_at: data.completedAt instanceof Timestamp ? data.completedAt.toDate().toISOString() : "",
          };
        }
      }
      return setsMap;
    },
    enabled: !!user && !!planId,
    staleTime: 30_000,
    // The read-start record is keyed by the exact object a fetch returned.
    structuralSharing: false,
  });

  const writesSnapshot = useSyncExternalStore(subscribeSetWrites, getSetWritesSnapshot);

  const completedSets = useMemo<SetsMap>(() => {
    const server = serverSets ?? {};
    if (!ownerUid || !planId) return server;
    return overlaySets(server, setChangesOverRead(ownerUid, { planId, weekKey, dayIndex }, readStartOf(serverSets)));
    // `writesSnapshot` stands for the module state read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSets, writesSnapshot, ownerUid, planId, weekKey, dayIndex]);

  /*
    Writes for one exercise position share a lane, so they reach the server -
    or the queue - in the order they were made, and never race each other into
    creating its documents. Once anything for that position is queued, later
    writes queue behind it rather than overtaking it online.
  */
  const exerciseLane = (params: SetWriteParams) =>
    ownerUid
      ? JSON.stringify(["workout-set", ownerUid, params.planId, params.weekKey, params.dayIndex, params.exerciseIndex])
      : null;
  const queueBehindOlderEntries = (params: SetWriteParams) =>
    !!ownerUid && hasQueuedSetWrite(ownerUid, params);

  const toggleSetMutation = useSupabaseAction<SetWriteResult, ToggleSetParams>({
    action: async (params: ToggleSetParams) => {
      if (!user) throw new Error("Not authenticated");
      // Every await in the writer is a chance for authentication to change
      // underneath this write. The owner is fixed here and re-checked at each.
      const stillOwner = beginAccountOperation(user.uid);
      await writeSetLogChange(user.uid, params, { kind: "completion", completed: params.completed }, stillOwner);
      return { success: true };
    },
    offlineActionType: "TOGGLE_SET",
    // An explicit field list, so the queued entry holds completion only even if
    // a caller hands over more than the type allows.
    toOfflinePayload: (params: ToggleSetParams) => ({
      planId: params.planId, weekKey: params.weekKey, dayIndex: params.dayIndex,
      exerciseIndex: params.exerciseIndex, setNumber: params.setNumber, completed: params.completed,
      ...(params.workoutDay !== undefined ? { workoutDay: params.workoutDay } : {}),
    }),
    serializeKey: exerciseLane,
    queueWhen: queueBehindOlderEntries,
    shouldQueueOffline: isFirestoreUnavailable,
    messages: { error: "Fehler beim Speichern des Satzes" },
    onSettled: (_data, _error, params: ToggleSetParams) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.completion.byWeek(params.planId, params.weekKey) });
    },
  });

  const performanceMutation = useSupabaseAction<SetWriteResult, UpdateSetPerformanceParams>({
    action: async (params: UpdateSetPerformanceParams) => {
      if (!user) throw new Error("Not authenticated");
      const stillOwner = beginAccountOperation(user.uid);
      await writeSetLogChange(user.uid, params, performanceChange(params), stillOwner);
      return { success: true };
    },
    offlineActionType: "UPDATE_SET_PERFORMANCE",
    // What was entered and nothing else - never the prescription, never completion.
    toOfflinePayload: (params: UpdateSetPerformanceParams) => ({
      planId: params.planId, weekKey: params.weekKey, dayIndex: params.dayIndex,
      exerciseIndex: params.exerciseIndex, setNumber: params.setNumber,
      ...(params.reps !== undefined ? { reps: params.reps } : {}),
      ...(params.weightKg !== undefined ? { weightKg: params.weightKg } : {}),
      ...(params.workoutDay !== undefined ? { workoutDay: params.workoutDay } : {}),
    }),
    serializeKey: exerciseLane,
    queueWhen: queueBehindOlderEntries,
    shouldQueueOffline: isFirestoreUnavailable,
    messages: { error: "Satzwerte konnten nicht gespeichert werden" },
  });

  const { mutateAsync: toggleMutateAsync } = toggleSetMutation;
  const { mutateAsync: performanceMutateAsync } = performanceMutation;

  const trackWrite = useCallback(<P extends SetWriteParams>(
    params: P,
    change: SetLogChange,
    write: (variables: P) => Promise<SetWriteResult>
  ): Promise<SetWriteResult> => {
    if (!ownerUid) return write(params);
    return trackSetWrite(ownerUid, positionOf(params), change, () => write(params)).then((result) => {
      // Reconcile with the server. The committed intent keeps showing the
      // change until a read that started after the commit arrives.
      if (!result.queued) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sets.byDay(params.planId, params.weekKey, params.dayIndex),
        });
      }
      return result;
    });
  }, [ownerUid, queryClient]);

  // Awaitable per action: each caller learns what happened to its own write.
  const toggleSetAsync = useCallback(
    (params: ToggleSetParams) =>
      trackWrite(params, { kind: "completion", completed: params.completed }, toggleMutateAsync),
    [trackWrite, toggleMutateAsync]
  );

  const toggleSet = useCallback((params: ToggleSetParams) => {
    void toggleSetAsync(params).catch(() => { /* reported by the action */ });
  }, [toggleSetAsync]);

  const updateSetPerformanceAsync = useCallback((params: UpdateSetPerformanceParams) => {
    const change = performanceChange(params);
    if (change.kind !== "performance" || !isValidPerformanceChange(change)) {
      return Promise.reject(new InvalidSetPerformanceError());
    }
    return trackWrite(params, change, performanceMutateAsync);
  }, [trackWrite, performanceMutateAsync]);

  const isSetCompleted = useCallback((ei: number, sn: number) => {
    const log = completedSets[ei]?.[sn];
    return !!log && log.completed !== false;
  }, [completedSets]);
  const getCompletedCount = useCallback(
    (ei: number) => Object.values(completedSets[ei] ?? {}).filter((log) => log.completed !== false).length,
    [completedSets]
  );
  const getSetDetails = useCallback((ei: number, sn: number) => completedSets[ei]?.[sn], [completedSets]);
  const getActualPerformance = useCallback(
    (ei: number, sn: number): ActualSetPerformance | undefined => completedSets[ei]?.[sn]?.actual,
    [completedSets]
  );
  const whenSetWritesSettled = useCallback(
    () => (ownerUid ? waitForSetWrites(ownerUid) : Promise.resolve({ failed: 0 })),
    [ownerUid]
  );

  return {
    completedSets, isLoadingSets, refetchSets,
    toggleSet,
    toggleSetAsync,
    isTogglingSet:  toggleSetMutation.isPending,
    updateSetPerformanceAsync,
    isSetCompleted, getCompletedSetsCount: getCompletedCount, getSetDetails, getActualPerformance,
    whenSetWritesSettled,
  };
}
