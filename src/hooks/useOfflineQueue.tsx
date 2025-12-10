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

import { useQueryClient } from '@tanstack/react-query';

export const useOfflineQueue = () => {
  const queryClient = useQueryClient();
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

    // Iterate over a snapshot, but verify freshness
    const snapshot = [...currentQueue]; // copy to safely iterate

    for (const snapshotEntry of snapshot) {
      // 1. Verify entry still exists and is pending (fresh read)
      const freshQueue = loadQueue();
      const entry = freshQueue.find(e => e.id === snapshotEntry.id);

      if (!entry) continue; // Already removed by another tab/process
      if (entry.status !== 'pending' && entry.status !== 'failed') continue; // Being processed or done
      if (entry.status === 'failed' && entry.attempts >= 3) continue; // Max attempts

      try {
        // Mark as syncing (atomic), returns new queue
        const syncingQueue = updateEntry(entry.id, { status: 'syncing' });
        setQueue(syncingQueue);

        // Find handler
        const handler = handlers[entry.type];
        if (!handler) {
          throw new Error(`No handler for type ${entry.type}`);
        }

        // Execute handler
        // @ts-ignore - TS has trouble mapping the specific payload type here but it's safe by design
        const invalidationKeys = await handler(entry.payload);

        // On success: remove from queue (atomic)
        const reducedQueue = removeEntry(entry.id);
        setQueue(reducedQueue);
        successCount++;

        // Invalidate queries if handler returned keys
        if (invalidationKeys && Array.isArray(invalidationKeys)) {
          for (const key of invalidationKeys) {
            queryClient.invalidateQueries({ queryKey: key });
          }
        }

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
          if (import.meta.env.DEV) {
            console.log(`[OfflineQueue] Network error for ${entry.id}, scheduling retry.`);
          }
          // Network error: Increment attempts and keep (atomic)
          const retriedQueue = updateEntry(entry.id, {
            status: 'pending',
            attempts: entry.attempts + 1,
            lastError: error.message
          });
          setQueue(retriedQueue);
        } else {
          if (import.meta.env.DEV) {
            console.error(`[OfflineQueue] Permanent error for ${entry.id}:`, error);
          }
          // Non-network error (atomic)
          const failedQueue = updateEntry(entry.id, {
            status: 'failed',
            lastError: error.message
          });
          setQueue(failedQueue);
          failedCount++;
        }

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
    // const currentQueue = loadQueue(); // No longer needed for enqueue
    const { queue: newQueue, entry } = enqueueToLib(type, payload);
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
