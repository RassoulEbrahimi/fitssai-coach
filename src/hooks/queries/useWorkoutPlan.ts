import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/queryKeys';

import { WorkoutPlan } from '@/lib/types';

export const useWorkoutPlan = () => {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const query = useQuery({
        // ✅ NEW: Centralized Key
        queryKey: queryKeys.plans.byUser(user?.id),
        queryFn: async () => {
            if (!user) return null;

            const { data, error } = await supabase
                .from('workout_plans')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;
            return data as unknown as WorkoutPlan;
        },
        enabled: !!user,
        staleTime: 1000 * 60 * 60, // 1 hour
    });

    const generateMutation = useMutation({
        mutationFn: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('No session');

            const { data, error } = await supabase.functions.invoke('generate-plans', {
                body: { trigger: 'manual' },
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data;
        },
        onSuccess: (data) => {
            if (data?.warning === 'mocked') {
                toast.info('Demo-Pläne erstellt', {
                    description: 'Die KI-Generierung ist derzeit nicht verfügbar.',
                });
            } else {
                toast.success('Pläne erfolgreich erstellt!');
            }

            // ✅ NEW: Invalidate using factory (Refresh all plans)
            queryClient.invalidateQueries({ queryKey: queryKeys.plans.all });
        },
        onError: (error: any) => {
            toast.error(error.message || 'Fehler beim Erstellen der Pläne');
        },
    });

    return {
        ...query,
        generatePlan: generateMutation.mutateAsync,
        isGenerating: generateMutation.isPending,
    };
};