import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOfflineQueue } from './useOfflineQueue';
import { logEvent, logError } from '@/lib/telemetryClient';
import { toastError } from '@/lib/toastWithIcon';
import { useEffect, useMemo } from 'react';
import { CompletionState, setExerciseCompletion } from '@/lib/completionUtils';
import { useSupabaseAction, retryWithBackoff } from './useSupabaseAction';
import { queryKeys } from '@/lib/queryKeys';

// Server response format (flat completion map)
interface WeekCompletionResponse {
  success: boolean;
  completionMap: CompletionState;
  weekKey: string;
  planId: string;
}

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
  const { isOnline } = useOfflineQueue();

  // ✅ NEW: Centralized Key Generation
  const queryKey = queryKeys.completion.byWeek(planId, weekKey);

  // Prefetch helper function
  const prefetchWeekCompletion = async (targetPlanId: string, targetWeekKey: string) => {
    logEvent('prefetch_week', { planId: targetPlanId, weekKey: targetWeekKey });

    await queryClient.prefetchQuery({
      // ✅ NEW: Use factory for prefetch key
      queryKey: queryKeys.completion.byWeek(targetPlanId, targetWeekKey),
      queryFn: async () => {
        if (!user) throw new Error('User not available');

        const { data, error } = await supabase.functions.invoke('get-week-completion', {
          body: { planId: targetPlanId, weekKey: targetWeekKey },
        });

        if (error || !data?.success) {
          throw new Error(error?.message || 'Prefetch failed');
        }

        return data.completionMap;
      },
      staleTime: 30000,
    });
  };

  const isInvalidWeek = useMemo(() => {
    if (!availableWeeks || availableWeeks.length === 0) return false;
    const normalizedWeekKey = weekKey.replace(/\s+/g, '').toLowerCase();
    const hasWeek = availableWeeks.some(w => w.replace(/\s+/g, '').toLowerCase() === normalizedWeekKey);
    return !hasWeek;
  }, [availableWeeks, weekKey]);

  const query = useQuery<CompletionState>({
    // ✅ NEW: Use centralized key
    queryKey,
    queryFn: async () => {
      if (!user || !planId) {
        throw new Error('User or planId not available');
      }

      logEvent('fetch_week_completion_start', { planId, weekKey });

      try {
        const data = await retryWithBackoff(async () => {
          const { data, error } = await supabase.functions.invoke('get-week-completion', {
            body: { planId, weekKey },
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
    enabled: enabled && !!user && !!planId && !isInvalidWeek,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    retry: false,
    networkMode: 'offlineFirst',
  });

  useEffect(() => {
    if (!isOnline && query.data && !query.isFetching) {
      logEvent('offline_fallback', {
        planId,
        weekKey,
        cacheAge: query.dataUpdatedAt ? Date.now() - query.dataUpdatedAt : 0
      });
    }
  }, [isOnline, query.data, query.isFetching, planId, weekKey, query.dataUpdatedAt]);

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
    // ✅ NEW: Automatic invalidation uses centralized key
    queryKey,
    offlineActionType: 'TOGGLE_DAY_COMPLETION',
    messages: {
      error: 'Änderung konnte nicht gespeichert werden.',
    },
    onMutate: async (params) => {
      // ✅ NEW: Cancel using centralized key
      await queryClient.cancelQueries({ queryKey });

      const previousData = queryClient.getQueryData<CompletionState>(queryKey);

      // ✅ NEW: Update using centralized key
      queryClient.setQueryData<CompletionState>(
        queryKey,
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
      if (isOnline && context?.previousData) {
        // ✅ NEW: Rollback using centralized key
        queryClient.setQueryData(queryKey, context.previousData);
      }
    }
  });

  if (isInvalidWeek) {
    return {
      completionMap: {},
      isLoading: false,
      isError: false,
      error: null,
      toggleExercise: () => { },
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
    prefetchWeekCompletion,
    isCached: !!query.data && query.isStale,
    dataUpdatedAt: query.dataUpdatedAt,
  };
};