import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type CompletionMap = Record<string, Record<string, boolean>>;

interface WeekCompletionResponse {
  success: boolean;
  completionMap: CompletionMap;
  weekKey: string;
  planId: string;
}

interface UseWeekCompletionParams {
  planId: string | undefined;
  weekKey: string;
  enabled?: boolean;
}

interface ToggleExerciseParams {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
  completed: boolean;
}

export const useWeekCompletion = ({ planId, weekKey, enabled = true }: UseWeekCompletionParams) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<WeekCompletionResponse>({
    queryKey: ['week-completion', planId, weekKey],
    queryFn: async () => {
      if (!user || !planId) {
        throw new Error('User or planId not available');
      }

      const { data, error } = await supabase.functions.invoke('get-week-completion', {
        body: {
          planId,
          weekKey,
        },
      });

      if (error) {
        console.error('Error fetching week completion:', error);
        throw error;
      }

      if (!data.success) {
        throw new Error('Failed to fetch week completion');
      }

      return data;
    },
    enabled: enabled && !!user && !!planId,
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
    retry: 2,
  });

  const toggleMutation = useMutation({
    mutationFn: async (params: ToggleExerciseParams) => {
      const { data, error } = await supabase.functions.invoke('toggle-exercise', {
        body: {
          planId: params.planId,
          weekKey: params.weekKey,
          dayIndex: params.dayIndex,
          exerciseIndex: params.exerciseIndex,
          completed: params.completed,
        },
      });

      if (error || !data.success) {
        throw error || new Error('Failed to toggle exercise');
      }

      return data;
    },
    onMutate: async (params) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['week-completion', params.planId, params.weekKey] });

      // Snapshot previous value
      const previousData = queryClient.getQueryData<WeekCompletionResponse>([
        'week-completion',
        params.planId,
        params.weekKey,
      ]);

      // Optimistically update
      queryClient.setQueryData<WeekCompletionResponse>(
        ['week-completion', params.planId, params.weekKey],
        (old) => {
          if (!old) return old;
          
          const newCompletionMap = { ...old.completionMap };
          const dayKey = `${params.dayIndex}`;
          const exerciseKey = `${params.exerciseIndex}`;
          
          if (!newCompletionMap[dayKey]) {
            newCompletionMap[dayKey] = {};
          }
          
          newCompletionMap[dayKey] = {
            ...newCompletionMap[dayKey],
            [exerciseKey]: params.completed,
          };

          return {
            ...old,
            completionMap: newCompletionMap,
          };
        }
      );

      return { previousData };
    },
    onError: (error, params, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          ['week-completion', params.planId, params.weekKey],
          context.previousData
        );
      }
      console.error('Error toggling exercise:', error);
    },
    onSuccess: (data, params) => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['week-completion', params.planId, params.weekKey] });
    },
  });

  return {
    completionMap: query.data?.completionMap || {},
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    toggleExercise: toggleMutation.mutate,
    isToggling: toggleMutation.isPending,
  };
};
