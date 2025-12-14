import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseAction } from "@/hooks/useSupabaseAction";
import { useOfflineQueue } from "./useOfflineQueue";
import { queryKeys } from "@/lib/queryKeys";

interface ToggleSetParams {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
  setNumber: number;
  repsCompleted: number;
  weightUsed?: number | null;
  completed: boolean;
}

interface SetLog {
  id: string;
  workout_log_id: string;
  set_number: number;
  reps_completed: number;
  weight_used: number | null;
  completed_at: string;
}

interface WorkoutLogWithSets {
  id: string;
  exercise_index: number;
  workout_set_logs: SetLog[];
}

interface ToggleSetResponse {
  success: boolean;
  data: unknown;
}

interface ToggleSetContext {
  previousSets: Record<number, Record<number, SetLog>> | undefined;
}

// Standalone action function
const toggleSetAction = async (params: ToggleSetParams): Promise<ToggleSetResponse> => {
  const { data, error } = await supabase.functions.invoke('toggle-set', {
    body: params,
  });

  if (error) throw error;
  if (!data?.success) throw new Error('Invalid response from server');

  return data as ToggleSetResponse;
};

export function useSetTracking(planId: string | undefined, weekKey: string, dayIndex: number) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineQueue();

  // ✅ NEW: Centralized Key Generation
  const queryKey = queryKeys.sets.byDay(planId, weekKey, dayIndex);

  const {
    data: completedSets,
    isLoading: isLoadingSets,
    refetch: refetchSets,
  } = useQuery({
    // ✅ NEW: Use centralized key
    queryKey,
    queryFn: async () => {
      if (!user || !planId) return {};

      const { data, error } = await supabase
        .from('workout_logs')
        .select(`
          id,
          exercise_index,
          workout_set_logs (
            id,
            set_number,
            reps_completed,
            weight_used,
            completed_at
          )
        `)
        .eq('user_id', user.id)
        .eq('plan_id', planId)
        .eq('week_key', weekKey)
        .eq('day_index', dayIndex);

      if (error) {
        console.error('Error fetching set logs:', error);
        return {};
      }

      const setsMap: Record<number, Record<number, SetLog>> = {};
      const logs = data as unknown as WorkoutLogWithSets[];

      logs?.forEach((log) => {
        if (!setsMap[log.exercise_index]) {
          setsMap[log.exercise_index] = {};
        }
        log.workout_set_logs?.forEach((setLog) => {
          setsMap[log.exercise_index][setLog.set_number] = setLog;
        });
      });

      return setsMap;
    },
    enabled: !!user && !!planId,
    staleTime: 30_000,
  });

  const toggleSetMutation = useSupabaseAction<ToggleSetResponse, ToggleSetParams, ToggleSetContext>({
    action: toggleSetAction,
    offlineActionType: 'TOGGLE_SET',
    // ✅ NEW: Use centralized key for auto-invalidation
    queryKey, 
    messages: {
      error: 'Fehler beim Speichern des Satzes',
    },
    onMutate: async (params: ToggleSetParams) => {
      // ✅ NEW: Cancel using centralized key
      await queryClient.cancelQueries({ queryKey });

      const previousSets = queryClient.getQueryData<Record<number, Record<number, SetLog>>>(queryKey);

      // Optimistic update
      queryClient.setQueryData(
        queryKey,
        (old: Record<number, Record<number, SetLog>> | undefined) => {
          const newData = { ...(old || {}) };
          if (!newData[params.exerciseIndex]) {
            newData[params.exerciseIndex] = {};
          }

          if (params.completed) {
            newData[params.exerciseIndex][params.setNumber] = {
              id: 'optimistic',
              workout_log_id: 'optimistic',
              set_number: params.setNumber,
              reps_completed: params.repsCompleted,
              weight_used: params.weightUsed ?? null,
              completed_at: new Date().toISOString(),
            };
          } else {
            const exerciseSets = { ...newData[params.exerciseIndex] };
            delete exerciseSets[params.setNumber];
            newData[params.exerciseIndex] = exerciseSets;
          }

          return newData;
        }
      );

      return { previousSets };
    },
    onError: (err, params, context: ToggleSetContext | undefined) => {
      if (context?.previousSets && isOnline) {
        // ✅ NEW: Rollback using centralized key
        queryClient.setQueryData(queryKey, context.previousSets);
      }
    },
    // ✅ NEW: Consistency Fix!
    // When a set is toggled, it might finish the exercise.
    // So we must refresh the dashboard (week completion) to show the green checkmark.
    onSettled: () => {
       queryClient.invalidateQueries({ 
         queryKey: queryKeys.completion.byWeek(planId, weekKey) 
       });
    }
  });

  const isSetCompleted = (exerciseIndex: number, setNumber: number): boolean => {
    return !!completedSets?.[exerciseIndex]?.[setNumber];
  };

  const getCompletedSetsCount = (exerciseIndex: number): number => {
    const exerciseSets = completedSets?.[exerciseIndex];
    return exerciseSets ? Object.keys(exerciseSets).length : 0;
  };

  const getSetDetails = (exerciseIndex: number, setNumber: number): SetLog | undefined => {
    return completedSets?.[exerciseIndex]?.[setNumber];
  };

  return {
    completedSets,
    isLoadingSets,
    refetchSets,
    toggleSet: toggleSetMutation.mutate,
    toggleSetAsync: toggleSetMutation.mutateAsync,
    isTogglingSet: toggleSetMutation.isPending,
    isSetCompleted,
    getCompletedSetsCount,
    getSetDetails,
  };
}