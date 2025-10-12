import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { logEvent, logError } from '@/lib/telemetryClient';

export interface Exercise {
  name: string;
  sets: number;
  reps: string;
  weight?: string;
  rest?: string;
  description?: string;
}

export interface UpdateExerciseParams {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
  exercise: Exercise;
}

interface UpdateExerciseResponse {
  success: boolean;
  message?: string;
  exercise?: Exercise;
  content?: any;
  error?: string;
}

export function useExerciseEditor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const updateExerciseMutation = useMutation({
    mutationFn: async (params: UpdateExerciseParams): Promise<UpdateExerciseResponse> => {
      logEvent('exercise_update_started', {
        planId: params.planId,
        weekKey: params.weekKey,
        dayIndex: params.dayIndex,
        exerciseIndex: params.exerciseIndex,
      });

      const { data, error } = await supabase.functions.invoke('update-exercise', {
        body: params,
      });

      if (error) {
        throw new Error(error.message || 'Failed to update exercise');
      }

      if (!data.success) {
        throw new Error(data.error || 'Update failed');
      }

      return data;
    },

    onMutate: async (params) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ 
        queryKey: ['workout-plan', params.planId] 
      });

      // Snapshot previous value for rollback
      const previousPlan = queryClient.getQueryData(['workout-plan', params.planId]);

      // Optimistically update plan in cache
      queryClient.setQueryData(['workout-plan', params.planId], (old: any) => {
        if (!old?.content) return old;

        const newContent = { ...old.content };
        const week = [...(newContent[params.weekKey] || [])];
        
        if (!week[params.dayIndex]) return old;
        
        const day = { ...week[params.dayIndex] };
        const exercises = [...(day.exercises || [])];
        
        if (!exercises[params.exerciseIndex]) return old;

        // Apply optimistic update
        exercises[params.exerciseIndex] = {
          ...exercises[params.exerciseIndex],
          ...params.exercise,
        };

        day.exercises = exercises;
        week[params.dayIndex] = day;
        newContent[params.weekKey] = week;

        return {
          ...old,
          content: newContent,
        };
      });

      logEvent('exercise_optimistic_update', {
        planId: params.planId,
        exerciseName: params.exercise.name,
      });

      return { previousPlan };
    },

    onError: (error: any, params, context) => {
      // Rollback on error
      if (context?.previousPlan) {
        queryClient.setQueryData(['workout-plan', params.planId], context.previousPlan);
      }

      logError(error, 'exercise_update_failed');

      // Parse detailed error from backend
      let description = error.message || 'Could not save exercise changes';
      try {
        const parsed = JSON.parse(error.message);
        if (parsed.error === 'Database error' && parsed.details) {
          // Database error with details
          description = `${parsed.error}: ${parsed.details}`;
        } else if (parsed.error === 'Validation error' && parsed.details) {
          // Validation error with field details
          const fieldErrors = Object.entries(parsed.details)
            .map(([field, msgs]: [string, any]) => `${field}: ${msgs.join(', ')}`)
            .join('; ');
          description = `${parsed.error}: ${fieldErrors}`;
        } else if (parsed.error) {
          description = parsed.error;
        }
      } catch {
        // Not JSON, use as-is
      }

      toast({
        title: t('workout.updateFailed') || 'Update failed',
        description,
        variant: 'destructive',
      });
    },

    onSuccess: (data, params) => {
      // Invalidate queries to ensure fresh data
      queryClient.invalidateQueries({ 
        queryKey: ['workout-plan', params.planId] 
      });

      logEvent('exercise_update_success', {
        planId: params.planId,
        exerciseName: params.exercise.name,
      });

      toast({
        title: t('workout.updateSuccess') || 'Exercise updated',
        description: `${params.exercise.name} has been saved`,
      });
    },
  });

  return {
    updateExercise: updateExerciseMutation.mutate,
    isUpdating: updateExerciseMutation.isPending,
    error: updateExerciseMutation.error,
  };
}
