import { useState, useEffect, useCallback } from 'react';
import { toastWithIcon, toastOffline } from '@/lib/toastWithIcon';
import { logEvent } from '@/lib/telemetryClient';
import {
  loadQueue,
  enqueue as enqueueToLib,
  updateEntry,
  removeEntry,
  OfflineMutationType,
  OfflineMutationPayloads,
  OfflineMutationEntry
} from '@/lib/offlineQueue';
import { handlers } from '@/lib/offlineHandlers';

export const useOfflineQueue = () => {
  const [queue, setQueue] = useState<OfflineMutationEntry[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isFlushing, setIsFlushing] = useState(false);

  // Initialize queue on mount
  useEffect(() => {
    setQueue(loadQueue());
  }, []);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      logEvent('connection_restored', { queueLength: queue.length });
      logEvent('aria_announcement_triggered', { context: 'connection_restored' });

      // Auto-flush when coming back online
      flush();
    };

    const handleOffline = () => {
      setIsOnline(false);
      logEvent('offline_mode_activated', { queueLength: queue.length });
      logEvent('aria_announcement_triggered', { context: 'offline_mode' });
      toastOffline(
        'Offline-Modus',
        'Änderungen werden synchronisiert, sobald du online bist.',
        3000
      );
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial flush if online on mount
    if (navigator.onLine) {
      // Small timeout to allow everything to settle
      setTimeout(() => flush(), 1000);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const flush = async () => {
    if (isFlushing) return;

    // Reload queue from storage to ensure we have latest state
    let currentQueue = loadQueue();
    if (currentQueue.length === 0) return;

    setIsFlushing(true);

    // In dev, log flush start
    if (import.meta.env.DEV) {
      console.log(`[OfflineQueue] Flushing ${currentQueue.length} items...`);
    }

    let successCount = 0;
    let failedCount = 0;

    for (const entry of currentQueue) {
      // Skip items that exhausted retries or already failed definitively
      if (entry.status === 'failed' && entry.attempts >= 3) continue;

      try {
        // Mark as syncing
        currentQueue = updateEntry(currentQueue, entry.id, { status: 'syncing' });
        setQueue(currentQueue);

        // Find handler
        const handler = handlers[entry.type];
        if (!handler) {
          throw new Error(`No handler for type ${entry.type}`);
        }

        // Execute handler
        // @ts-ignore - TS has trouble mapping the specific payload type here but it's safe by design
        await handler(entry.payload);

        // On success: remove from queue
        currentQueue = removeEntry(currentQueue, entry.id);
        setQueue(currentQueue);
        successCount++;

        logEvent('queue_operation_success', {
          operationId: entry.id,
          type: entry.type
        });
      } catch (error: any) {
        console.error(`[OfflineQueue] Failed to sync ${entry.id}:`, error);

        const isNetworkError =
          error.message?.includes('Failed to fetch') ||
          error.message?.includes('Network request failed') ||
          !navigator.onLine;

        if (isNetworkError) {
          // Network error: Increment attempts and keep
          currentQueue = updateEntry(currentQueue, entry.id, {
            status: 'pending',
            attempts: entry.attempts + 1,
            lastError: error.message
          });
        } else {
          // Non-network error (4xx/5xx handling logic): 
          // For now, we also retry up to maxAttempts unless it's clearly a validation error?
          // The prompt says: "on non-network / 4xx error -> mark as failed and stop retrying"

          // Ideally we'd distinguish 4xx, but error objects can be vague. 
          // Assuming typical fetch/supabase errors.

          currentQueue = updateEntry(currentQueue, entry.id, {
            status: 'failed',
            lastError: error.message
          });
          failedCount++;
        }

        setQueue(currentQueue);
        logEvent('queue_operation_failed', {
          operationId: entry.id,
          error: error.message
        });
      }
    }

    setIsFlushing(false);

    // Feedback
    if (successCount > 0) {
      toastWithIcon({
        title: 'Synchronisiert',
        description: 'Offline-Änderungen wurden gespeichert.',
        variant: 'success',
        duration: 3000
      });
    }

    if (failedCount > 0) {
      console.error(`[OfflineQueue] ${failedCount} items failed to sync.`);
      // Optional: Inform user about failures? 
      // User prompt: "If some entries are marked failed -> 'Some changes could not be synced.'"
      toastWithIcon({
        title: 'Sync-Fehler',
        description: 'Einige Änderungen konnten nicht gespeichert werden.',
        variant: 'destructive', // Close enough to error
        duration: 4000
      });
    }

    if (import.meta.env.DEV) {
      console.log(`[OfflineQueue] Flush complete. Success: ${successCount}, Failed: ${failedCount}, Remaining: ${currentQueue.length}`);
    }
  };

  const enqueue = useCallback(<T extends OfflineMutationType>(
    type: T,
    payload: OfflineMutationPayloads[T]
  ) => {
    // Reload queue to ensure consistency
    const currentQueue = loadQueue();
    const { queue: newQueue, entry } = enqueueToLib(currentQueue, type, payload);
    setQueue(newQueue);

    // User feedback
    if (!navigator.onLine) {
      toastOffline(
        'Offline gespeichert',
        'Wir synchronisieren das, sobald du wieder online bist.',
        3000
      );
    } // If online, we might be queueing due to network error, so maybe show same toast?
    // Prompt says: "On enqueue while offline -> ..."

    logEvent('queue_operation_added', { operationId: entry.id, type });
    return entry.id;
  }, []);

  return {
    isOnline,
    enqueue,
    flush,
    pendingCount: queue.filter(q => q.status === 'pending' || q.status === 'syncing').length,
    hasPending: queue.length > 0,
    queue
  };
};
