import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOfflineQueue } from './useOfflineQueue';
import { logEvent, logError, logRetry } from '@/lib/telemetryClient';
import { toastError, toastOffline } from '@/lib/toastWithIcon';
import { useEffect, useMemo } from 'react';
import { CompletionState, setExerciseCompletion } from '@/lib/completionUtils';

// Server response format (flat completion map)
interface WeekCompletionResponse {
  success: boolean;
  completionMap: CompletionState;
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
  /** Duration in minutes (defaults to 10 if not provided) */
  durationMinutes?: number;
  /** Calories burned (defaults to 50 if not provided) */
  caloriesBurned?: number;
}

export const useWeekCompletion = ({ planId, weekKey, enabled = true }: UseWeekCompletionParams) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isOnline, enqueue } = useOfflineQueue();

  // Prefetch helper function
  const prefetchWeekCompletion = async (targetPlanId: string, targetWeekKey: string) => {
    logEvent('prefetch_week', { planId: targetPlanId, weekKey: targetWeekKey });

    await queryClient.prefetchQuery({
      queryKey: ['week-completion', targetPlanId, targetWeekKey],
      queryFn: async () => {
        if (!user) throw new Error('User not available');

        const { data, error } = await supabase.functions.invoke('get-week-completion', {
          body: { planId: targetPlanId, weekKey: targetWeekKey },
        });

        if (error || !data?.success) {
          throw new Error(error?.message || 'Prefetch failed');
        }

        // Edge function already returns flat structure
        return data.completionMap;
      },
      staleTime: 30000, // 30 seconds
    });
  };

  const query = useQuery<CompletionState>({
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

        // Edge function already returns flat structure, no normalization needed
        return data.completionMap;
      } catch (error: any) {
        console.error('Failed to fetch week completion after retries:', error);
        logError(error, `fetch_week_completion_failed: ${planId} ${weekKey}`);
        logEvent('aria_announcement_triggered', { context: 'fetch_error' });

        toastError(
          'Fehler beim Laden',
          'Trainingsplan konnte nicht geladen werden. Bitte versuche es erneut.',
          3000
        );

        throw error;
      }
    },
    enabled: enabled && !!user && !!planId, // Allow queries even when offline to use cache
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // We handle retries manually with exponential backoff
    networkMode: 'offlineFirst', // Use cache when offline, fetch when online
  });

  // Log offline fallback usage
  useEffect(() => {
    if (!isOnline && query.data && !query.isFetching) {
      logEvent('offline_fallback', {
        planId,
        weekKey,
        cacheAge: query.dataUpdatedAt ? Date.now() - query.dataUpdatedAt : 0
      });
    }
  }, [isOnline, query.data, query.isFetching, planId, weekKey, query.dataUpdatedAt]);

  const toggleMutation = useMutation({
    mutationFn: async (params: ToggleExerciseParams) => {
      logEvent('toggle_exercise_start', {
        ...params,
        isOnline,
        completionKey: `${params.weekKey}_${params.dayIndex}_${params.exerciseIndex}`
      });

      // Check if offline
      if (!isOnline) {
        logEvent('toggle_exercise_queued', params);
        // Queue for later
        enqueue('TOGGLE_DAY_COMPLETION', params);

        // Return success for optimistic update
        return { success: true, queued: true };
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
              durationMinutes: params.durationMinutes,
              caloriesBurned: params.caloriesBurned,
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

        logEvent('toggle_exercise_success', {
          ...params,
          completionKey: `${params.weekKey}_${params.dayIndex}_${params.exerciseIndex}`
        });
        return data;
      } catch (error: any) {
        console.error('Failed to toggle exercise after retries:', error);

        // If it's a network error, queue it even if we thought we were online
        const isNetworkError =
          error.message?.includes('Failed to fetch') ||
          error.message?.includes('Network request failed');

        if (isNetworkError) {
          logEvent('toggle_exercise_queued_error', params);
          enqueue('TOGGLE_DAY_COMPLETION', params);

          // Show offline toast manually since we are "online" but request failed
          toastOffline(
            'Offline gespeichert',
            'Verbindungsproblem. Wir synchronisieren das später.',
            3000
          );
          return { success: true, queued: true };
        }

        logError(error, `toggle_exercise_failed: ${JSON.stringify(params)}`);
        logEvent('aria_announcement_triggered', { context: 'toggle_error' });

        toastError(
          'Fehler',
          'Änderung konnte nicht gespeichert werden. Bitte versuche es erneut.',
          3000
        );

        throw error;
      }
    },
    onMutate: async (params) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['week-completion', params.planId, params.weekKey] });

      // Snapshot previous value
      const previousData = queryClient.getQueryData<CompletionState>([
        'week-completion',
        params.planId,
        params.weekKey,
      ]);

      // Optimistically update flat state
      queryClient.setQueryData<CompletionState>(
        ['week-completion', params.planId, params.weekKey],
        (old) => {
          if (!old) return old;

          // Use helper to set completion in flat structure
          return setExerciseCompletion(
            old,
            params.weekKey,
            params.dayIndex,
            params.exerciseIndex,
            params.completed
          );
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
    onSuccess: (data: any, params) => {
      // Only refetch if not queued (queued items will trigger invalidation on flush)
      if (!data?.queued) {
        queryClient.invalidateQueries({ queryKey: ['week-completion', params.planId, params.weekKey] });
      }
    },
  });

  const completionMap = useMemo(() => query.data || {}, [query.data]);

  return {
    completionMap,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    toggleExercise: toggleMutation.mutate,
    isToggling: toggleMutation.isPending,
    isOnline,
    refetch: query.refetch,
    prefetchWeekCompletion, // Expose prefetch function
    isCached: !!query.data && query.isStale, // True if data exists but is stale
    dataUpdatedAt: query.dataUpdatedAt, // Timestamp of last update
  };
};
