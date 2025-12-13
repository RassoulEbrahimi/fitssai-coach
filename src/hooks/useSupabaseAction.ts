import { useMutation, UseMutationOptions, useQueryClient } from '@tanstack/react-query';
import { useOfflineQueue } from './useOfflineQueue';
import { logEvent, logError, logRetry } from '@/lib/telemetryClient';
import { toastError, toastOffline } from '@/lib/toastWithIcon';

interface RetryConfig {
    retries: number;
    initialDelay: number;
}

interface ActionMessages {
    success?: string;
    error?: string;
    loading?: string;
    offlineQueued?: string;
}

export interface UseSupabaseActionOptions<TData, TVariables, TContext = unknown> {
    action: (variables: TVariables) => Promise<TData>;
    queryKey?: unknown[];
    onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) => void;
    onError?: (error: unknown, variables: TVariables, context: TContext | undefined) => void;
    onMutate?: (variables: TVariables) => Promise<TContext> | TContext;
    retryConfig?: RetryConfig;
    messages?: ActionMessages;
    /**
     * Helper to determine if a specific error or condition should trigger offline queueing.
     * If not provided, basic network error detection is used.
     */
    shouldQueueOffline?: (error: unknown, variables: TVariables) => boolean;
    /**
     * Action type for the offline queue (e.g. 'TOGGLE_DAY_COMPLETION')
     */
    offlineActionType?: string;
}

// Exponential backoff retry utility
export const retryWithBackoff = async <T,>(
    fn: () => Promise<T>,
    config: RetryConfig
): Promise<T> => {
    let lastError: any;

    for (let attempt = 0; attempt <= config.retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt < config.retries) {
                const delay = config.initialDelay * Math.pow(2, attempt);
                logRetry('action_retry', attempt + 1, delay);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
};

export const useSupabaseAction = <TData = unknown, TVariables = void, TContext = unknown>({
    action,
    queryKey,
    onSuccess,
    onError,
    onMutate,
    retryConfig = { retries: 3, initialDelay: 1000 },
    messages,
    shouldQueueOffline,
    offlineActionType
}: UseSupabaseActionOptions<TData, TVariables, TContext>) => {
    const queryClient = useQueryClient();
    const { isOnline, enqueue } = useOfflineQueue();

    return useMutation<TData, Error, TVariables, TContext>({
        mutationFn: async (variables: TVariables) => {
            // 1. Offline Check (Immediate)
            if (!isOnline && offlineActionType) {
                enqueue(offlineActionType, variables as any);
                if (messages?.offlineQueued) {
                    // Optional: toastOffline(messages.offlineQueued); 
                    // Strategy: Let the caller decide or use a default toast here?
                    // For consistency, we can return a mock success structure.
                }
                return { success: true, queued: true } as unknown as TData;
            }

            // 2. Online Execution with Retry
            try {
                return await retryWithBackoff(() => action(variables), retryConfig);
            } catch (error: any) {
                // 3. Network Error during Execution -> Queue if applicable
                const isNetworkError =
                    error.message?.includes('Failed to fetch') ||
                    error.message?.includes('Network request failed');

                if ((isNetworkError || (shouldQueueOffline && shouldQueueOffline(error, variables))) && offlineActionType) {
                    enqueue(offlineActionType, variables as any);

                    toastOffline(
                        'Offline gespeichert',
                        'Verbindungsproblem. Wir synchronisieren das später.',
                        3000
                    );

                    return { success: true, queued: true } as unknown as TData;
                }

                // Real Error
                throw error;
            }
        },
        onMutate: async (variables) => {
            // Standard logging
            logEvent('action_start', { offlineActionType, isOnline });
            if (onMutate) return onMutate(variables);
            return undefined as unknown as TContext;
        },
        onSuccess: (data: any, variables, context) => {
            // Invalidate queries if provided
            if (queryKey && !data?.queued) {
                queryClient.invalidateQueries({ queryKey });
            }

            // Standard logging
            logEvent('action_success', { offlineActionType });

            if (messages?.success && !data?.queued) {
                // toast.success(messages.success); // Use generic toast if needed
            }

            if (onSuccess) onSuccess(data, variables, context);
        },
        onError: (error: any, variables, context) => {
            console.error('Action failed:', error);
            logError(error, `action_failed: ${offlineActionType}`);

            if (messages?.error) {
                toastError('Fehler', messages.error, 3000);
            }

            if (onError) onError(error, variables, context);
        }
    });
};
