import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseAction } from '@/hooks/useSupabaseAction';
import { queryKeys } from '@/lib/queryKeys';
import { WorkoutLog } from '@/lib/types';

export const useWorkoutLogs = (planId?: string) => {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    // ✅ NEW: Centralized Key Generation
    const queryKey = queryKeys.logs.byPlan(planId, user?.id);

    const query = useQuery({
        // ✅ NEW: Use centralized key
        queryKey,
        queryFn: async () => {
            if (!user || !planId) return [];

            const { data, error } = await supabase
                .from('workout_logs')
                .select('*')
                .eq('user_id', user.id)
                .eq('plan_id', planId);

            if (error) throw error;
            return (data || []) as unknown as WorkoutLog[];
        },
        enabled: !!user && !!planId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    const toggleDayMutation = useSupabaseAction({
        action: async ({ workoutDateStr, completed }: { workoutDateStr: string; completed: boolean }) => {
            if (!user || !planId) throw new Error('Missing user or plan');

            // Check for existing log to update ID if exists (though upsert handles this, explicit update is safer for pure toggle if needed)
            // Simpler approach: upsert based on constraint
            const payload = {
                user_id: user.id,
                plan_id: planId,
                workout_day: workoutDateStr,
                completed,
                completed_at: completed ? new Date().toISOString() : null
            };

            const { data, error } = await supabase
                .from('workout_logs')
                .upsert(payload, { onConflict: 'user_id,plan_id,workout_day' })
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        // ✅ NEW: Automatic invalidation uses centralized key
        queryKey: [...queryKey],

        messages: {
            error: 'Fehler beim Speichern'
        },

        onMutate: async ({ workoutDateStr, completed }: { workoutDateStr: string; completed: boolean }) => {
            // ✅ NEW: Cancel using centralized key
            await queryClient.cancelQueries({ queryKey });

            const previousLogs = queryClient.getQueryData<WorkoutLog[]>(queryKey);

            // Optimistic update
            queryClient.setQueryData(queryKey, (old: WorkoutLog[] = []) => {
                const existingIndex = old.findIndex(
                    (log: WorkoutLog) => log.workout_day === workoutDateStr
                );

                if (existingIndex > -1) {
                    const newLogs = [...old];
                    newLogs[existingIndex] = { ...newLogs[existingIndex], completed };
                    return newLogs;
                } else {
                    return [...old, {
                        workout_day: workoutDateStr,
                        completed,
                        plan_id: planId,
                        user_id: user!.id
                    }];
                }
            });

            return { previousLogs };
        },

        onError: (err: unknown, newTodo: { workoutDateStr: string; completed: boolean }, context: { previousLogs?: WorkoutLog[] } | undefined) => {
            // ✅ NEW: Rollback using centralized key
            if (context?.previousLogs) {
                queryClient.setQueryData(queryKey, context.previousLogs);
            }
        },
    });

    return {
        ...query,
        toggleDay: toggleDayMutation.mutate,
        isToggling: toggleDayMutation.isPending,
    };
};