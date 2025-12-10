import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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

import { useOfflineQueue } from "./useOfflineQueue";

export function useSetTracking(planId: string | undefined, weekKey: string, dayIndex: number) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isOnline, enqueue } = useOfflineQueue();

  // Query to fetch completed sets for exercises on a specific day
  const {
    data: completedSets,
    isLoading: isLoadingSets,
    refetch: refetchSets,
  } = useQuery({
    queryKey: ['workout-sets', planId, weekKey, dayIndex],
    queryFn: async () => {
      if (!user || !planId) return {};

      // Fetch workout logs with their set logs for this day
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

      // Transform to a map: exerciseIndex -> { setNumber -> SetLog }
      const setsMap: Record<number, Record<number, SetLog>> = {};

      (data as unknown as WorkoutLogWithSets[])?.forEach((log) => {
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

  // Mutation to toggle a set's completion
  const toggleSetMutation = useMutation({
    mutationFn: async (params: ToggleSetParams) => {
      // Check if offline
      if (!isOnline) {
        enqueue('TOGGLE_SET', params);
        return { success: true };
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        const response = await fetch(
          `https://zkamhncwbgieifloosqn.supabase.co/functions/v1/toggle-set`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(params),
          }
        );

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || 'Failed to toggle set');
        }
        return result;
      } catch (error: any) {
        console.error('Error toggling set:', error);

        // Network error handling
        const isNetworkError =
          error.message?.includes('Failed to fetch') ||
          error.message?.includes('Network request failed');

        if (isNetworkError) {
          enqueue('TOGGLE_SET', params);
          return { success: true };
        }
        throw error;
      }
    },
    onMutate: async (params) => {
      // Cancel any outgoing queries
      await queryClient.cancelQueries({ queryKey: ['workout-sets', planId, weekKey, dayIndex] });

      // Snapshot previous value
      const previousSets = queryClient.getQueryData(['workout-sets', planId, weekKey, dayIndex]);

      // Optimistically update
      queryClient.setQueryData(
        ['workout-sets', planId, weekKey, dayIndex],
        (old: Record<number, Record<number, SetLog>> | undefined) => {
          const newData = { ...old };
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

      // Handle offline queueing in onMutate or mutationFn?
      // mutationFn is better for control flow, but we need access to `enqueue`.
      // We can access `enqueue` from the hook scope.

      return { previousSets };
    },
    onError: (err, params, context) => {
      // Rollback on error
      if (context?.previousSets && navigator.onLine) {
        // Only rollback if online. If offline, we keep optimistic update.
        queryClient.setQueryData(
          ['workout-sets', planId, weekKey, dayIndex],
          context.previousSets
        );
      }
      console.error('Error toggling set:', err);
    },
    onSettled: () => {
      // Refetch to ensure consistency
      if (navigator.onLine) {
        queryClient.invalidateQueries({ queryKey: ['workout-sets', planId, weekKey, dayIndex] });
      }
    },
  });

  // Helper to check if a specific set is completed
  const isSetCompleted = (exerciseIndex: number, setNumber: number): boolean => {
    return !!completedSets?.[exerciseIndex]?.[setNumber];
  };

  // Helper to get completed sets count for an exercise
  const getCompletedSetsCount = (exerciseIndex: number): number => {
    const exerciseSets = completedSets?.[exerciseIndex];
    return exerciseSets ? Object.keys(exerciseSets).length : 0;
  };

  // Helper to get set details
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
