import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { useOfflineQueue } from './useOfflineQueue';
import { logEvent, logError, logRetry } from '@/lib/telemetryClient';

export type CompletionMap = Record<string, Record<string, boolean>>;

interface WeekCompletionResponse {
  success: boolean;
  completionMap: CompletionMap;
  weekKey: string;
  planId: string;
}

// Exponential backoff retry utility
const retryWithBackoff = async <T,>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> => {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
        logRetry('retry_with_backoff', attempt + 1, delay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
};

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
  const { toast } = useToast();
  const { isOnline, addToQueue } = useOfflineQueue();

  const query = useQuery<WeekCompletionResponse>({
    queryKey: ['week-completion', planId, weekKey],
    queryFn: async () => {
      if (!user || !planId) {
        throw new Error('User or planId not available');
      }

      logEvent('fetch_week_completion_start', { planId, weekKey });

      try {
        const data = await retryWithBackoff(async () => {
          const { data, error } = await supabase.functions.invoke('get-week-completion', {
            body: {
              planId,
              weekKey,
            },
          });

          if (error) {
            console.error('Error fetching week completion:', error);
            throw new Error(error.message || 'Failed to fetch week completion');
          }

          if (!data?.success) {
            throw new Error('Invalid response from server');
          }

          return data;
        }, 3, 1000);

        logEvent('fetch_week_completion_success', { planId, weekKey });
        return data;
      } catch (error: any) {
        console.error('Failed to fetch week completion after retries:', error);
        logError(error, `fetch_week_completion_failed: ${planId} ${weekKey}`);
        
        toast({
          variant: 'destructive',
          title: 'Fehler beim Laden',
          description: 'Trainingsplan konnte nicht geladen werden. Bitte versuche es erneut.',
          duration: 3000,
          role: 'alert',
        });
        
        throw error;
      }
    },
    enabled: enabled && !!user && !!planId && isOnline,
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // We handle retries manually with exponential backoff
  });

  const toggleMutation = useMutation({
    mutationFn: async (params: ToggleExerciseParams) => {
      logEvent('toggle_exercise_start', { ...params, isOnline });

      // Check if offline
      if (!isOnline) {
        logEvent('toggle_exercise_queued', params);
        // Queue for later
        addToQueue(
          async () => {
            const { data, error } = await supabase.functions.invoke('toggle-exercise', {
              body: params,
            });
            
            if (error || !data?.success) {
              throw error || new Error('Failed to toggle exercise');
            }
            
            return data;
          },
          params
        );
        
        // Return success for optimistic update
        return { success: true };
      }

      // Online: retry with exponential backoff
      try {
        const data = await retryWithBackoff(async () => {
          const { data, error } = await supabase.functions.invoke('toggle-exercise', {
            body: {
              planId: params.planId,
              weekKey: params.weekKey,
              dayIndex: params.dayIndex,
              exerciseIndex: params.exerciseIndex,
              completed: params.completed,
            },
          });

          if (error) {
            console.error('Error toggling exercise:', error);
            throw new Error(error.message || 'Failed to toggle exercise');
          }

          if (!data?.success) {
            throw new Error('Invalid response from server');
          }

          return data;
        }, 3, 1000);

        logEvent('toggle_exercise_success', params);
        return data;
      } catch (error: any) {
        console.error('Failed to toggle exercise after retries:', error);
        logError(error, `toggle_exercise_failed: ${JSON.stringify(params)}`);
        
        toast({
          variant: 'destructive',
          title: 'Fehler',
          description: 'Änderung konnte nicht gespeichert werden. Bitte versuche es erneut.',
          duration: 3000,
          role: 'alert',
        });
        
        throw error;
      }
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
      // Only rollback if not offline (offline operations are queued)
      if (isOnline && context?.previousData) {
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
    isOnline,
    refetch: query.refetch,
  };
};
