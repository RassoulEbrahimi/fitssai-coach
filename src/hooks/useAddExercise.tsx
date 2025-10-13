import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from 'react-i18next';
import { toastSuccess, toastError } from '@/lib/toastWithIcon';
import type { Exercise } from './useExerciseEditor';

interface AddExerciseParams {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exercise: Exercise;
}

interface AddExerciseResponse {
  success: boolean;
  updatedPlan?: any;
  error?: string;
}

/**
 * Hook for adding new exercises to a workout day
 * Uses React Query mutation for optimistic updates and error handling
 */
export const useAddExercise = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const addExerciseMutation = useMutation<AddExerciseResponse, Error, AddExerciseParams>({
    mutationFn: async ({ planId, weekKey, dayIndex, exercise }) => {
      console.log('[useAddExercise] Adding exercise:', { planId, weekKey, dayIndex, exercise });

      // Fetch current plan
      const { data: currentPlan, error: fetchError } = await supabase
        .from('workout_plans')
        .select('content')
        .eq('id', planId)
        .single();

      if (fetchError) throw new Error(`Failed to fetch plan: ${fetchError.message}`);
      if (!currentPlan) throw new Error('Plan not found');

      // Clone content to avoid mutations
      const updatedContent = JSON.parse(JSON.stringify(currentPlan.content));

      // Ensure week exists
      if (!updatedContent[weekKey]) {
        updatedContent[weekKey] = [];
      }

      // Ensure day exists
      if (!updatedContent[weekKey][dayIndex]) {
        updatedContent[weekKey][dayIndex] = {
          day: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][dayIndex],
          exercises: []
        };
      }

      // Ensure exercises array exists
      if (!updatedContent[weekKey][dayIndex].exercises) {
        updatedContent[weekKey][dayIndex].exercises = [];
      }

      // Add the new exercise
      updatedContent[weekKey][dayIndex].exercises.push(exercise);

      // Update the plan in database
      const { data: updatedPlan, error: updateError } = await supabase
        .from('workout_plans')
        .update({ content: updatedContent })
        .eq('id', planId)
        .select()
        .single();

      if (updateError) throw new Error(`Failed to update plan: ${updateError.message}`);

      return {
        success: true,
        updatedPlan,
      };
    },

    onMutate: async ({ planId, weekKey, dayIndex, exercise }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['workout-plan', planId] });

      // Snapshot previous value
      const previousPlan = queryClient.getQueryData(['workout-plan', planId]);

      // Optimistically update cache
      queryClient.setQueryData(['workout-plan', planId], (old: any) => {
        if (!old) return old;

        const updatedContent = JSON.parse(JSON.stringify(old.content));

        // Ensure structures exist
        if (!updatedContent[weekKey]) updatedContent[weekKey] = [];
        if (!updatedContent[weekKey][dayIndex]) {
          updatedContent[weekKey][dayIndex] = {
            day: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][dayIndex],
            exercises: []
          };
        }
        if (!updatedContent[weekKey][dayIndex].exercises) {
          updatedContent[weekKey][dayIndex].exercises = [];
        }

        // Add exercise optimistically
        updatedContent[weekKey][dayIndex].exercises.push(exercise);

        return {
          ...old,
          content: updatedContent,
        };
      });

      return { previousPlan };
    },

    onError: (error, variables, context: { previousPlan?: any } | undefined) => {
      // Rollback on error
      if (context?.previousPlan) {
        queryClient.setQueryData(['workout-plan', variables.planId], context.previousPlan);
      }

      console.error('[useAddExercise] Error:', error);
      toastError('Fehler', 'Übung konnte nicht hinzugefügt werden');
    },

    onSuccess: (data, variables) => {
      // Update cache with server response
      if (data.updatedPlan) {
        queryClient.setQueryData(['workout-plan', variables.planId], data.updatedPlan);
      }

      // Invalidate related queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ['workout-plan', variables.planId] });

      toastSuccess('Übung hinzugefügt', 'Die Übung wurde erfolgreich hinzugefügt');
    },
  });

  return {
    addExercise: addExerciseMutation.mutate,
    isAdding: addExerciseMutation.isPending,
    error: addExerciseMutation.error,
  };
};
