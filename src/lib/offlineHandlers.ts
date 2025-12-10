import { supabase } from '@/integrations/supabase/client';
import { OfflineMutationPayloads, OfflineMutationType } from './offlineQueue';

type MutationHandler<T extends OfflineMutationType> = (
    payload: OfflineMutationPayloads[T]
) => Promise<void>;

export const handlers: {
    [K in OfflineMutationType]: MutationHandler<K>;
} = {
    TOGGLE_DAY_COMPLETION: async (payload) => {
        const { data, error } = await supabase.functions.invoke('toggle-exercise', {
            body: payload,
        });

        if (error) throw new Error(error.message || 'Failed to toggle exercise');
        if (!data?.success) throw new Error('Invalid response from server');
    },

    TOGGLE_SET: async (payload) => {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        // We keep using fetch here to match existing implementation in useSetTracking
        // Ideally this should also be supabase.functions.invoke
        const response = await fetch(
            `https://zkamhncwbgieifloosqn.supabase.co/functions/v1/toggle-set`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            }
        );

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to toggle set');
        }
    },
};
