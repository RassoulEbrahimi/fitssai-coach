import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { logEvent, logError } from '@/lib/telemetryClient';
import { useSupabaseAction } from './useSupabaseAction';

import { WorkoutPlanContent } from '@/lib/types';

export type { WorkoutPlanContent };

interface DeleteExerciseParams {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
}

interface DeleteExerciseResponse {
  success: boolean;
  message?: string;
  content?: WorkoutPlanContent;
  error?: string;
  queued?: boolean;
}

export function useDeleteExercise() {
  const queryClient = useQueryClient();

  const deleteExerciseMutation = useSupabaseAction<DeleteExerciseResponse, DeleteExerciseParams>({
    action: async (params: DeleteExerciseParams): Promise<DeleteExerciseResponse> => {
      // Get current plan
      const { data: plan, error: fetchError } = await supabase
        .from('workout_plans')
        .select('content')
        .eq('id', params.planId)
        .single();

      if (fetchError || !plan) {
        throw new Error(fetchError?.message || 'Failed to fetch plan');
      }

      // Remove exercise from content
      const content = plan.content as unknown as WorkoutPlanContent;
      const week = content[params.weekKey] || [];
      const day = week[params.dayIndex];

      if (!day || !day.exercises) {
        throw new Error('Day or exercises not found');
      }

      // Create updated exercises array without the deleted exercise
      const updatedExercises = day.exercises.filter(
        (_: any, idx: number) => idx !== params.exerciseIndex
      );

      // Update day with new exercises
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
        .update({ content: updatedContent as any })
        .eq('id', params.planId);

      if (updateError) {
        throw new Error(updateError.message || 'Failed to delete exercise');
      }

      return { success: true, content: updatedContent };
    },

    messages: {
      success: 'Übung gelöscht',
      error: 'Fehler beim Löschen der Übung'
    },

    onMutate: async (params) => {
      logEvent('exercise_delete_started', {
        planId: params.planId,
        weekKey: params.weekKey,
        dayIndex: params.dayIndex,
        exerciseIndex: params.exerciseIndex,
      });

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

        // Remove exercise at index
        exercises.splice(params.exerciseIndex, 1);

        day.exercises = exercises;
        week[params.dayIndex] = day;
        newContent[params.weekKey] = week;

        return {
          ...old,
          content: newContent,
        };
      });

      logEvent('exercise_optimistic_delete', {
        planId: params.planId,
      });

      return { previousPlan };
    },

    onError: (error: any, params, context: { previousPlan?: any } | undefined) => {
      // Rollback on error
      if (context?.previousPlan) {
        queryClient.setQueryData(['workout-plan', params.planId], context.previousPlan);
      }

      logError(error, 'exercise_delete_failed');
    },

    onSuccess: (data, params) => {
      // Set query data with fresh content
      if (data.content && !data.queued) {
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

      logEvent('exercise_delete_success', {
        planId: params.planId,
      });
    },
  });

  return {
    deleteExercise: deleteExerciseMutation.mutate,
    isDeleting: deleteExerciseMutation.isPending,
    error: deleteExerciseMutation.error,
  };
}
