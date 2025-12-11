import { supabase } from '@/integrations/supabase/client';
import { OfflineMutationPayloads, OfflineMutationType } from './offlineQueue';
import { QueryKey } from '@tanstack/react-query';

type MutationHandler<T extends OfflineMutationType> = (
    payload: OfflineMutationPayloads[T]
) => Promise<QueryKey[] | void>;

export const handlers: {
    [K in OfflineMutationType]: MutationHandler<K>;
} = {
    TOGGLE_DAY_COMPLETION: async (payload) => {
        const { data, error } = await supabase.functions.invoke('toggle-exercise', {
            body: payload,
        });

        if (error) throw new Error(error.message || 'Failed to toggle exercise');
        if (!data?.success) throw new Error('Invalid response from server');

        // Invalidate week completion query
        return [['week-completion', payload.planId, payload.weekKey]];
    },

    TOGGLE_SET: async (payload) => {
        const { data, error } = await supabase.functions.invoke('toggle-set', {
            body: payload,
        });

        if (error) throw new Error(error.message || 'Failed to toggle set');
        if (!data?.success) throw new Error('Invalid response from server');

        // Invalidate workout sets query
        return [['workout-sets', payload.planId, payload.weekKey, payload.dayIndex]];
    },
};
