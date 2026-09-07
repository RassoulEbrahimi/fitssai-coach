import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOfflineQueue } from './useOfflineQueue';
import { useAuth } from '@/hooks/useAuth';
import { AccountChangedError, assertAccountOwner } from '@/lib/accountIdentity';
import type { OfflineMutationPayloads, OfflineMutationType } from '@/lib/offlineQueue';
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
    onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables, context: TContext | undefined) => void;
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
    offlineActionType?: OfflineMutationType;
    /**
     * Maps the mutation's variables to the queue payload the handler expects.
     *
     * Without this the raw variables were queued as the payload, which only
     * worked where the two happened to coincide. `useWorkoutLogs.toggleDay`
     * passed `{workoutDateStr, completed}` while its handler read
     * planId/weekKey/dayIndex — so every offline day completion replayed as a
     * document of undefined fields.
     *
     * Returning `null` means "this cannot be replayed truthfully": nothing is
     * queued and the caller sees the failure instead of a false success.
     */
    toOfflinePayload?: (variables: TVariables) => unknown | null;
}

// Exponential backoff retry utility
export const retryWithBackoff = async <T,>(
    fn: () => Promise<T>,
    config: RetryConfig
): Promise<T> => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= config.retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Retrying an account change is pointless and harmful: identity will
            // not revert, and each backoff holds the caller open — a finish that
            // waits seven seconds to report a failure it already knew about.
            if (error instanceof AccountChangedError) throw error;

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
    onSettled,
    retryConfig = { retries: 3, initialDelay: 1000 },
    messages,
    shouldQueueOffline,
    offlineActionType,
    toOfflinePayload
}: UseSupabaseActionOptions<TData, TVariables, TContext>) => {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const ownerUid = user?.uid;
    const { isOnline, enqueue } = useOfflineQueue();

    /**
     * The payload to store, or null when the action cannot be replayed. Falls
     * back to the raw variables for callers that have no mapper, which is what
     * every caller did before.
     */
    const buildOfflinePayload = (variables: TVariables): unknown | null =>
        toOfflinePayload ? toOfflinePayload(variables) : variables;

    return useMutation<TData, Error, TVariables, TContext>({
        mutationFn: async (variables: TVariables) => {
            // The mounted action belongs to this account, including delayed retries.
            assertAccountOwner(ownerUid);
            // 1. Offline Check (Immediate)
            if (!isOnline && offlineActionType) {
                const payload = buildOfflinePayload(variables);
                if (payload === null) {
                    throw new Error('Offline-Speichern ist für diese Aktion nicht möglich.');
                }
                enqueue(offlineActionType, payload as OfflineMutationPayloads[OfflineMutationType]);
                if (messages?.offlineQueued) {
                    // Optional: toastOffline(messages.offlineQueued); 
                    // Strategy: Let the caller decide or use a default toast here?
                    // For consistency, we can return a mock success structure.
                }
                return { success: true, queued: true } as unknown as TData;
            }

            // 2. Online Execution with Retry
            try {
                return await retryWithBackoff(() => {
                    assertAccountOwner(ownerUid);
                    return action(variables);
                }, retryConfig);
            } catch (caught: unknown) {
                assertAccountOwner(ownerUid);
                const error = caught instanceof Error ? caught : new Error(String(caught));
                // 3. Network Error during Execution -> Queue if applicable
                const isNetworkError =
                    error.message?.includes('Failed to fetch') ||
                    error.message?.includes('Network request failed');

                const queuedPayload =
                    (isNetworkError || (shouldQueueOffline && shouldQueueOffline(error, variables))) && offlineActionType
                        ? buildOfflinePayload(variables)
                        : null;

                if (queuedPayload !== null && offlineActionType) {
                    enqueue(offlineActionType, queuedPayload as OfflineMutationPayloads[OfflineMutationType]);

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
        onSuccess: (data, variables, context) => {
            const queued = !!data && typeof data === 'object' && 'queued' in data && data.queued;
            // Invalidate queries if provided
            if (queryKey && !queued) {
                queryClient.invalidateQueries({ queryKey });
            }

            // Standard logging
            logEvent('action_success', { offlineActionType });

            if (messages?.success && !queued) {
                // toast.success(messages.success); // Use generic toast if needed
            }

            if (onSuccess) onSuccess(data, variables, context);
        },
        onError: (error, variables, context) => {
            console.error('Action failed:', error);
            logError(error, `action_failed: ${offlineActionType}`);

            if (messages?.error) {
                toastError('Fehler', messages.error, 3000);
            }

            if (onError) onError(error, variables, context);
        },
        onSettled: (data, error, variables, context) => {
            if (onSettled) onSettled(data, error, variables, context);
        }
    });
};
