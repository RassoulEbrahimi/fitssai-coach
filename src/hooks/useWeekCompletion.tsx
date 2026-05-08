import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection, getDocs, query, where, doc, addDoc, updateDoc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./useAuth";
import { useOfflineQueue } from "./useOfflineQueue";
import { logEvent, logError } from "@/lib/telemetryClient";
import { toastError } from "@/lib/toastWithIcon";
import { useEffect, useMemo } from "react";
import { CompletionState, setExerciseCompletion } from "@/lib/completionUtils";
import { useSupabaseAction } from "./useSupabaseAction";
import { queryKeys } from "@/lib/queryKeys";

interface UseWeekCompletionParams {
  planId: string | undefined;
  weekKey: string;
  enabled?: boolean;
  availableWeeks?: string[];
}

interface ToggleExerciseParams {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
  completed: boolean;
  durationMinutes?: number;
  caloriesBurned?: number;
}

interface ToggleExerciseContext { previousData: CompletionState | undefined; }

// Build CompletionState from Firestore workout_logs for a given planId + weekKey
const buildCompletionState = (docs: { dayIndex?: number; exerciseIndex?: number; completed?: boolean }[]): CompletionState => {
  const map: CompletionState = {};
  for (const d of docs) {
    if (d.completed && d.dayIndex !== undefined && d.exerciseIndex !== undefined) {
      const key = `${d.exerciseIndex}_${d.dayIndex}`;
      map[key] = true;
    }
  }
  return map;
};

export const useWeekCompletion = ({ planId, weekKey, enabled = true, availableWeeks }: UseWeekCompletionParams) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineQueue();

  const queryKey = queryKeys.completion.byWeek(planId, weekKey);

  const prefetchWeekCompletion = async (targetPlanId: string, targetWeekKey: string) => {
    logEvent("prefetch_week", { planId: targetPlanId, weekKey: targetWeekKey });
    await queryClient.prefetchQuery({
      queryKey: queryKeys.completion.byWeek(targetPlanId, targetWeekKey),
      queryFn: async () => {
        if (!user) throw new Error("User not available");
        const logsRef = collection(db, "users", user.uid, "workout_logs");
        const snap = await getDocs(query(logsRef, where("planId", "==", targetPlanId), where("weekKey", "==", targetWeekKey)));
        return buildCompletionState(snap.docs.map(d => d.data() as any));
      },
      staleTime: 30000,
    });
  };

  const isInvalidWeek = useMemo(() => {
    if (!availableWeeks || availableWeeks.length === 0) return false;
    const n = weekKey.replace(/\s+/g, "").toLowerCase();
    return !availableWeeks.some(w => w.replace(/\s+/g, "").toLowerCase() === n);
  }, [availableWeeks, weekKey]);

  const query_ = useQuery<CompletionState>({
    queryKey,
    queryFn: async () => {
      if (!user || !planId) throw new Error("User or planId not available");
      logEvent("fetch_week_completion_start", { planId, weekKey });
      try {
        const logsRef = collection(db, "users", user.uid, "workout_logs");
        const snap = await getDocs(query(logsRef, where("planId", "==", planId), where("weekKey", "==", weekKey)));
        const state = buildCompletionState(snap.docs.map(d => d.data() as any));
        logEvent("fetch_week_completion_success", { planId, weekKey });
        return state;
      } catch (error: any) {
        logError(error, `fetch_week_completion_failed: ${planId} ${weekKey}`);
        toastError("Fehler beim Laden", "Trainingsplan konnte nicht geladen werden.");
        throw error;
      }
    },
    enabled: enabled && !!user && !!planId && !isInvalidWeek,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    retry: false,
    networkMode: "offlineFirst",
  });

  useEffect(() => {
    if (!isOnline && query_.data && !query_.isFetching) {
      logEvent("offline_fallback", { planId, weekKey });
    }
  }, [isOnline, query_.data, query_.isFetching, planId, weekKey]);

  const { mutate: toggleExercise, isPending: isToggling } = useSupabaseAction<any, ToggleExerciseParams, ToggleExerciseContext>({
    action: async (params: ToggleExerciseParams) => {
      if (!user) throw new Error("Not authenticated");
      const logsRef = collection(db, "users", user.uid, "workout_logs");
      // Find existing log for this exact exercise position
      const snap = await getDocs(query(logsRef,
        where("planId",         "==", params.planId),
        where("weekKey",        "==", params.weekKey),
        where("dayIndex",       "==", params.dayIndex),
        where("exerciseIndex",  "==", params.exerciseIndex),
      ));
      if (!snap.empty) {
        await updateDoc(doc(db, "users", user.uid, "workout_logs", snap.docs[0].id), {
          completed: params.completed,
          completedAt: params.completed ? Timestamp.now() : null,
        });
      } else {
        await addDoc(logsRef, {
          planId:        params.planId,
          weekKey:       params.weekKey,
          dayIndex:      params.dayIndex,
          exerciseIndex: params.exerciseIndex,
          completed:     params.completed,
          completedAt:   params.completed ? Timestamp.now() : null,
          createdAt:     Timestamp.now(),
          durationMinutes: params.durationMinutes ?? null,
          caloriesBurned:  params.caloriesBurned  ?? null,
        });
      }
      return { success: true };
    },
    queryKey: [...queryKey],
    offlineActionType: "TOGGLE_DAY_COMPLETION",
    messages: { error: "Änderung konnte nicht gespeichert werden." },
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<CompletionState>(queryKey);
      queryClient.setQueryData<CompletionState>(queryKey, (old) => {
        if (!old) return old;
        return setExerciseCompletion(old, params.weekKey, params.dayIndex, params.exerciseIndex, params.completed);
      });
      return { previousData };
    },
    onError: (_error: any, _params: any, context: ToggleExerciseContext | undefined) => {
      if (isOnline && context?.previousData) queryClient.setQueryData(queryKey, context.previousData);
    },
  });

  if (isInvalidWeek) {
    return {
      completionMap: {}, isLoading: false, isError: false, error: null,
      toggleExercise: () => {}, isToggling: false, isOnline,
      refetch: async () => ({ data: {}, isError: false }),
      prefetchWeekCompletion, isCached: false, dataUpdatedAt: Date.now(),
    };
  }

  const completionMap = useMemo(() => query_.data || {}, [query_.data]);

  return {
    completionMap, isLoading: query_.isLoading, isError: query_.isError,
    error: query_.error, toggleExercise, isToggling, isOnline,
    refetch: query_.refetch, prefetchWeekCompletion,
    isCached: !!query_.data && query_.isStale,
    dataUpdatedAt: query_.dataUpdatedAt,
  };
};
