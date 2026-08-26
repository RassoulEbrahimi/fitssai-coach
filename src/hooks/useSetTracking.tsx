import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection, getDocs, query, where, doc, addDoc, deleteDoc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseAction } from "@/hooks/useSupabaseAction";
import { useOfflineQueue } from "./useOfflineQueue";
import { queryKeys } from "@/lib/queryKeys";
import { isWorkoutDayString } from "@/lib/workoutLog";

interface ToggleSetParams {
  planId: string; weekKey: string; dayIndex: number; exerciseIndex: number;
  setNumber: number; repsCompleted: number; weightUsed?: number | null; completed: boolean;
  /**
   * `YYYY-MM-DD` for the day being logged, from the date the user actually has
   * selected — not "today". Logging a set against a past day must record that
   * day. Optional so an older caller still produces a valid document.
   */
  workoutDay?: string;
}

interface SetLog {
  id: string; workout_log_id: string; set_number: number;
  reps_completed: number; weight_used: number | null; completed_at: string;
}

type SetsMap = Record<number, Record<number, SetLog>>;

interface ToggleSetContext { previousSets: SetsMap | undefined; }

export function useSetTracking(planId: string | undefined, weekKey: string, dayIndex: number) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineQueue();
  const queryKey = queryKeys.sets.byDay(planId, weekKey, dayIndex);

  const { data: completedSets, isLoading: isLoadingSets, refetch: refetchSets } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!user || !planId) return {};
      // Get workout_logs for this plan/week/day
      const logsRef = collection(db, "users", user.uid, "workout_logs");
      const logSnap = await getDocs(query(logsRef,
        where("planId",   "==", planId),
        where("weekKey",  "==", weekKey),
        where("dayIndex", "==", dayIndex),
      ));

      const setsMap: SetsMap = {};
      await Promise.all(logSnap.docs.map(async (logDoc) => {
        const exerciseIndex: number = logDoc.data().exerciseIndex ?? -1;
        if (exerciseIndex < 0) return;
        const setsRef = collection(db, "users", user.uid, "workout_logs", logDoc.id, "workout_set_logs");
        const setsSnap = await getDocs(setsRef);
        if (!setsMap[exerciseIndex]) setsMap[exerciseIndex] = {};
        setsSnap.docs.forEach(sd => {
          const sd_ = sd.data() as any;
          setsMap[exerciseIndex][sd_.setNumber] = {
            id: sd.id, workout_log_id: logDoc.id,
            set_number: sd_.setNumber, reps_completed: sd_.repsCompleted,
            weight_used: sd_.weightUsed ?? null,
            completed_at: sd_.completedAt instanceof Timestamp ? sd_.completedAt.toDate().toISOString() : "",
          };
        });
      }));
      return setsMap;
    },
    enabled: !!user && !!planId,
    staleTime: 30_000,
  });

  const toggleSetMutation = useSupabaseAction<any, ToggleSetParams, ToggleSetContext>({
    action: async (params: ToggleSetParams) => {
      if (!user) throw new Error("Not authenticated");
      const logsRef = collection(db, "users", user.uid, "workout_logs");
      // Find or create workout_log for this exercise position
      const logSnap = await getDocs(query(logsRef,
        where("planId",        "==", params.planId),
        where("weekKey",       "==", params.weekKey),
        where("dayIndex",      "==", params.dayIndex),
        where("exerciseIndex", "==", params.exerciseIndex),
      ));
      let logId: string;
      if (!logSnap.empty) {
        logId = logSnap.docs[0].id;
      } else {
        const newLog = await addDoc(logsRef, {
          planId: params.planId, weekKey: params.weekKey,
          dayIndex: params.dayIndex, exerciseIndex: params.exerciseIndex,
          // Lets a set be placed on a calendar without re-deriving the date
          // from the plan's start Monday.
          ...(isWorkoutDayString(params.workoutDay) ? { workoutDay: params.workoutDay } : {}),
          completed: false, createdAt: Timestamp.now(),
        });
        logId = newLog.id;
      }
      // Find existing set_log
      const setsRef = collection(db, "users", user.uid, "workout_logs", logId, "workout_set_logs");
      const setSnap = await getDocs(query(setsRef, where("setNumber", "==", params.setNumber)));

      if (params.completed) {
        if (setSnap.empty) {
          await addDoc(setsRef, {
            setNumber: params.setNumber, repsCompleted: params.repsCompleted,
            weightUsed: params.weightUsed ?? null, completedAt: Timestamp.now(),
          });
        }
      } else {
        if (!setSnap.empty) {
          await deleteDoc(doc(db, "users", user.uid, "workout_logs", logId, "workout_set_logs", setSnap.docs[0].id));
        }
      }
      return { success: true };
    },
    offlineActionType: "TOGGLE_SET",
    queryKey: [...queryKey],
    messages: { error: "Fehler beim Speichern des Satzes" },
    onMutate: async (params: ToggleSetParams) => {
      await queryClient.cancelQueries({ queryKey });
      const previousSets = queryClient.getQueryData<SetsMap>(queryKey);
      queryClient.setQueryData(queryKey, (old: SetsMap | undefined) => {
        const newData = { ...(old || {}) };
        if (!newData[params.exerciseIndex]) newData[params.exerciseIndex] = {};
        if (params.completed) {
          newData[params.exerciseIndex][params.setNumber] = {
            id: "optimistic", workout_log_id: "optimistic",
            set_number: params.setNumber, reps_completed: params.repsCompleted,
            weight_used: params.weightUsed ?? null, completed_at: new Date().toISOString(),
          };
        } else {
          const ex = { ...newData[params.exerciseIndex] };
          delete ex[params.setNumber];
          newData[params.exerciseIndex] = ex;
        }
        return newData;
      });
      return { previousSets };
    },
    onError: (_err: any, params: ToggleSetParams, context: ToggleSetContext | undefined) => {
      if (context?.previousSets && isOnline) queryClient.setQueryData(queryKey, context.previousSets);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.completion.byWeek(planId, weekKey) });
    },
  });

  const isSetCompleted    = (ei: number, sn: number) => !!completedSets?.[ei]?.[sn];
  const getCompletedCount = (ei: number)              => Object.keys(completedSets?.[ei] || {}).length;
  const getSetDetails     = (ei: number, sn: number)  => completedSets?.[ei]?.[sn];

  return {
    completedSets, isLoadingSets, refetchSets,
    toggleSet:      toggleSetMutation.mutate,
    toggleSetAsync: toggleSetMutation.mutateAsync,
    isTogglingSet:  toggleSetMutation.isPending,
    isSetCompleted, getCompletedSetsCount: getCompletedCount, getSetDetails,
  };
}
