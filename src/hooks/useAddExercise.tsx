import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAction } from './useSupabaseAction';
import { Exercise, WorkoutPlan } from '@/lib/types';

interface AddExerciseParams {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exercise: Exercise;
}

interface AddExerciseResponse {
  success: boolean;
  updatedPlan?: WorkoutPlan;
  error?: string;
  queued?: boolean;
}

/**
 * Hook for adding new exercises to a workout day
 * Uses useSupabaseAction for standardized error handling and optimistic updates
 */
export const useAddExercise = () => {
  const queryClient = useQueryClient();

  const addExerciseMutation = useSupabaseAction<AddExerciseResponse, AddExerciseParams>({
    action: async ({ planId, weekKey, dayIndex, exercise }) => {
      console.log('[useAddExercise] Adding exercise:', { planId, weekKey, dayIndex, exercise });

      // Fetch current plan
      const { data: currentPlan, error: fetchError } = await supabase
        .from('workout_plans')
        .select('content')
        .eq('id', planId)
        .single();

      if (fetchError) throw new Error(`Failed to fetch plan: ${fetchError.message} `);
      if (!currentPlan) throw new Error('Plan not found');

      // Clone content to avoid mutations
      const updatedContent = JSON.parse(JSON.stringify(currentPlan.content));

      // Ensure week exists
      if (!updatedContent[weekKey]) {
        updatedContent[weekKey] = [];
      }

      // Ensure day exists and is properly initialized (handle rest days)
      if (!updatedContent[weekKey][dayIndex] ||
        typeof updatedContent[weekKey][dayIndex] !== 'object') {
        updatedContent[weekKey][dayIndex] = {
          day: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][dayIndex],
          exercises: []
        };
      }

      // Ensure exercises array exists
      if (!updatedContent[weekKey][dayIndex].exercises ||
        !Array.isArray(updatedContent[weekKey][dayIndex].exercises)) {
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

      if (updateError) throw new Error(`Failed to update plan: ${updateError.message} `);

      return {
        success: true,
        updatedPlan: updatedPlan as unknown as WorkoutPlan,
      };
    },

    messages: {
      success: 'Die Übung wurde erfolgreich hinzugefügt',
      error: 'Übung konnte nicht hinzugefügt werden'
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
        if (!updatedContent[weekKey][dayIndex] ||
          typeof updatedContent[weekKey][dayIndex] !== 'object') {
          updatedContent[weekKey][dayIndex] = {
            day: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][dayIndex],
            exercises: []
          };
        }
        if (!updatedContent[weekKey][dayIndex].exercises ||
          !Array.isArray(updatedContent[weekKey][dayIndex].exercises)) {
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
      // Note: useSupabaseAction handles logging and displaying the toast error message
    },

    onSuccess: (data, variables) => {
      // Update cache with server response
      if (data.updatedPlan && !data.queued) {
        queryClient.setQueryData(['workout-plan', variables.planId], data.updatedPlan);
      }

      // Invalidate related queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ['workout-plan', variables.planId] });

      // Note: useSupabaseAction handles the success toast
    },
  });

  return {
    addExercise: addExerciseMutation.mutate,
    isAdding: addExerciseMutation.isPending,
    error: addExerciseMutation.error,
  };
};
