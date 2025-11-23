import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Exercise } from '@/hooks/useExerciseEditor';
import { logEvent, logError } from '@/lib/telemetryClient';

export interface RestoreExerciseParams {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
  exercise: Exercise;
}

interface RestoreExerciseResponse {
  success: boolean;
  message?: string;
  content?: any;
  error?: string;
}

export function useRestoreExercise() {
  const queryClient = useQueryClient();

  const restoreExerciseMutation = useMutation({
    mutationFn: async (params: RestoreExerciseParams): Promise<RestoreExerciseResponse> => {
      logEvent('exercise_restore_started', {
        planId: params.planId,
        weekKey: params.weekKey,
        dayIndex: params.dayIndex,
        exerciseIndex: params.exerciseIndex,
      });

      // Get current plan
      const { data: plan, error: fetchError } = await supabase
        .from('workout_plans')
        .select('content')
        .eq('id', params.planId)
        .single();

      if (fetchError || !plan) {
        throw new Error(fetchError?.message || 'Failed to fetch plan');
      }

      // Insert exercise back at original position
      const content = plan.content as any;
      const week = content[params.weekKey] || [];
      const day = week[params.dayIndex];

      if (!day) {
        throw new Error('Day not found');
      }

      // Create updated exercises array with restored exercise at original index
      const exercises = day.exercises || [];
      const updatedExercises = [...exercises];
      updatedExercises.splice(params.exerciseIndex, 0, params.exercise);

      // Update day with restored exercises
      const updatedDay = { ...day, exercises: updatedExercises };
      const updatedWeek = [...week];
      updatedWeek[params.dayIndex] = updatedDay;

      const updatedContent = {
        ...content,
        [params.weekKey]: updatedWeek,
      };

      // Save to database
      const { error: updateError } = await supabase
        .from('workout_plans')
        .update({ content: updatedContent })
        .eq('id', params.planId);

      if (updateError) {
        throw new Error(updateError.message || 'Failed to restore exercise');
      }

      return { success: true, content: updatedContent };
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
        
        // Insert exercise at original index
        exercises.splice(params.exerciseIndex, 0, params.exercise);

        day.exercises = exercises;
        week[params.dayIndex] = day;
        newContent[params.weekKey] = week;

        return {
          ...old,
          content: newContent,
        };
      });

      logEvent('exercise_optimistic_restore', {
        planId: params.planId,
      });

      return { previousPlan };
    },

    onError: (error: any, params, context) => {
      // Rollback on error
      if (context?.previousPlan) {
        queryClient.setQueryData(['workout-plan', params.planId], context.previousPlan);
      }

      logError(error, 'exercise_restore_failed');
    },

    onSuccess: (data, params) => {
      // Set query data with fresh content
      if (data.content) {
        queryClient.setQueryData(['workout-plan', params.planId], (old: any) => {
          if (!old) return { content: data.content };
          return { ...old, content: data.content };
        });
      }

      // Invalidate queries to ensure fresh data
      queryClient.invalidateQueries({ 
        queryKey: ['workout-plan', params.planId] 
      });

      // Invalidate all week completions
      ['Week 1', 'Week 2', 'Week 3', 'Week 4'].forEach(weekKey => {
        queryClient.invalidateQueries({ 
          queryKey: ['week-completion', params.planId, weekKey] 
        });
      });

      logEvent('exercise_restore_success', {
        planId: params.planId,
        exerciseName: params.exercise.name,
      });
    },
  });

  return {
    restoreExercise: restoreExerciseMutation.mutate,
    isRestoring: restoreExerciseMutation.isPending,
    error: restoreExerciseMutation.error,
  };
}
