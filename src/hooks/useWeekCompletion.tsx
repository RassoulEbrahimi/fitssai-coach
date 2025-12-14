import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOfflineQueue } from './useOfflineQueue';
import { logEvent, logError, logRetry } from '@/lib/telemetryClient';
import { toastError, toastOffline } from '@/lib/toastWithIcon';
import { useEffect, useMemo } from 'react';
import { CompletionState, setExerciseCompletion } from '@/lib/completionUtils';
import { useSupabaseAction, retryWithBackoff } from './useSupabaseAction';

// Server response format (flat completion map)
interface WeekCompletionResponse {
  success: boolean;
  completionMap: CompletionState;
  weekKey: string;
  planId: string;
}

// retryWithBackoff removed (using useSupabaseAction internal logic)

interface UseWeekCompletionParams {
  planId: string | undefined;
  weekKey: string;
  enabled?: boolean;
  availableWeeks?: string[]; // New: List of valid weeks in the plan
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

interface ToggleExerciseResponse {
  success: boolean;
  data: unknown;
}

interface ToggleExerciseContext {
  previousData: CompletionState | undefined;
}

export const useWeekCompletion = ({ planId, weekKey, enabled = true, availableWeeks }: UseWeekCompletionParams) => {
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

  // Determine if the requested week is invalid (not in the plan)
  // We only check this if availableWeeks is provided and populated
  const isInvalidWeek = useMemo(() => {
    if (!availableWeeks || availableWeeks.length === 0) return false;

    // Normalize for case-insensitivity
    const normalizedWeekKey = weekKey.replace(/\s+/g, '').toLowerCase();
    const hasWeek = availableWeeks.some(w => w.replace(/\s+/g, '').toLowerCase() === normalizedWeekKey);

    return !hasWeek;
  }, [availableWeeks, weekKey]);

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
        }, { retries: 3, initialDelay: 1000 });

        logEvent('fetch_week_completion_success', { planId, weekKey });

        // Edge function already returns flat structure, no normalization needed
        return data.completionMap;
      } catch (error: any) {
        console.error('Failed to fetch week completion after retries:', error);
        logError(error, `fetch_week_completion_failed: ${planId} ${weekKey}`);
        logEvent('aria_announcement_triggered', { context: 'fetch_error' });

        toastError(
          'Fehler beim Laden',
          'Trainingsplan konnte nicht geladen werden. Bitte versuche es erneut.'
        );

        throw error;
      }
    },
    // IMPORTANT: Disable query if week is invalid to prevent errors
    // Also keep standard checks (user, planId)
    enabled: enabled && !!user && !!planId && !isInvalidWeek,
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

  // Use the new standardized hook for toggling
  const { mutate: toggleExercise, isPending: isToggling } = useSupabaseAction<ToggleExerciseResponse, ToggleExerciseParams, ToggleExerciseContext>({
    action: async (params) => {
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

      if (error) throw new Error(error.message || 'Failed to toggle exercise');
      if (!data?.success) throw new Error('Invalid response from server');
      return data;
    },
    queryKey: ['week-completion', planId, weekKey],
    offlineActionType: 'TOGGLE_DAY_COMPLETION',
    messages: {
      error: 'Änderung konnte nicht gespeichert werden.',
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
      // Rollback if needed (handled by wrapper mostly, but we can do custom rollback if context exists)
      if (isOnline && context?.previousData) {
        queryClient.setQueryData(
          ['week-completion', params.planId, params.weekKey],
          context.previousData
        );
      }
    }
  });

  // If week is invalid, return empty mock state immediately
  // This bypasses the loading/error state of the query
  if (isInvalidWeek) {
    return {
      completionMap: {},
      isLoading: false,
      isError: false,
      error: null,
      toggleExercise: () => { }, // No-op for invalid weeks
      isToggling: false,
      isOnline,
      refetch: async () => ({ data: {}, isError: false }),
      prefetchWeekCompletion,
      isCached: false,
      dataUpdatedAt: Date.now(),
    };
  }

  const completionMap = useMemo(() => query.data || {}, [query.data]);

  return {
    completionMap,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    toggleExercise,
    isToggling,
    isOnline,
    refetch: query.refetch,
    prefetchWeekCompletion, // Expose prefetch function
    isCached: !!query.data && query.isStale, // True if data exists but is stale
    dataUpdatedAt: query.dataUpdatedAt, // Timestamp of last update
  };
};
