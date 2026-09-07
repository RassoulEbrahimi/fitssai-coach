import { useState, useEffect, useCallback, useRef } from 'react';
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
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { AccountChangedError, assertAccountOwner } from '@/lib/accountIdentity';
import { handlers } from '@/lib/offlineHandlers';

import { useQueryClient } from '@tanstack/react-query';

export const useOfflineQueue = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const ownerUid = user?.uid;
  const [queue, setQueue] = useState<OfflineMutationEntry[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const isFlushing = useRef(false);

  // Initialize queue on mount
  useEffect(() => {
    setQueue(loadQueue());
  }, []);

  const flush = useCallback(async () => {
    if (isFlushing.current || !ownerUid || auth.currentUser?.uid !== ownerUid) return;

    // Reload queue from storage to ensure we have latest state
    const currentQueue = loadQueue();
    if (currentQueue.length === 0) return;

    isFlushing.current = true;

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

      if (auth.currentUser?.uid !== ownerUid) break;
      if (!entry || entry.ownerUid !== ownerUid) continue; // Already removed by another tab/process
      if (entry.status !== 'pending' && entry.status !== 'failed') continue; // Being processed or done
      if (entry.status === 'failed' && entry.attempts >= 3) continue; // Max attempts

      try {
        // Mark this entry as syncing; storage durability is unchanged.
        const syncingQueue = updateEntry(entry.id, { status: 'syncing' });
        setQueue(syncingQueue);

        // Find handler
        const handler = handlers[entry.type] as (payload: typeof entry.payload, ownerUid: string) => Promise<readonly (readonly unknown[])[]>;
        if (!handler) {
          throw new Error(`No handler for type ${entry.type}`);
        }

        // Execute handler
        const invalidationKeys = await handler(entry.payload, entry.ownerUid);

        // On success: remove from queue
        const reducedQueue = removeEntry(entry.id);
        setQueue(reducedQueue);
        successCount++;

        // Invalidate queries if handler returned keys
        if (auth.currentUser?.uid === ownerUid && invalidationKeys && Array.isArray(invalidationKeys)) {
          for (const key of invalidationKeys) {
            queryClient.invalidateQueries({ queryKey: key });
          }
        }

        logEvent('queue_operation_success', {
          operationId: entry.id,
          type: entry.type
        });
      } catch (caught: unknown) {
        const error = caught instanceof Error ? caught : new Error(String(caught));
        if (error instanceof AccountChangedError) {
          setQueue(updateEntry(entry.id, { status: 'pending' }));
          break;
        }
        console.error(`[OfflineQueue] Failed to sync ${entry.id}:`, error);

        const isNetworkError =
          error.message?.includes('Failed to fetch') ||
          error.message?.includes('Network request failed') ||
          !navigator.onLine;

        if (isNetworkError) {
          if (import.meta.env.DEV) {
            console.log(`[OfflineQueue] Network error for ${entry.id}, scheduling retry.`);
          }
          // Network error: Increment attempts and keep
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
          // Non-network error
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

    isFlushing.current = false;

    // Feedback
    if (auth.currentUser?.uid === ownerUid && successCount > 0) {
      toastWithIcon({
        title: 'Synchronisiert',
        description: 'Offline-Änderungen wurden gespeichert.',
        variant: 'success',
        duration: 3000
      });
    }

    if (auth.currentUser?.uid === ownerUid && failedCount > 0) {
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
  }, [ownerUid, queryClient]);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      logEvent('connection_restored', { queueLength: loadQueue().filter(entry => entry.ownerUid === ownerUid).length });
      logEvent('aria_announcement_triggered', { context: 'connection_restored' });

      // Auto-flush when coming back online
      flush();
    };

    const handleOffline = () => {
      setIsOnline(false);
      logEvent('offline_mode_activated', { queueLength: loadQueue().filter(entry => entry.ownerUid === ownerUid).length });
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (navigator.onLine) {
      // Small timeout to allow everything to settle
      timer = setTimeout(() => flush(), 1000);
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flush, ownerUid]);

  const enqueue = useCallback(<T extends OfflineMutationType>(
    type: T,
    payload: OfflineMutationPayloads[T]
  ) => {
    assertAccountOwner(ownerUid);
    const { queue: newQueue, entry } = enqueueToLib(type, payload, ownerUid);
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
  }, [ownerUid]);

  const ownedQueue = queue.filter(entry => !!ownerUid && entry.ownerUid === ownerUid && entry.status !== 'quarantined');

  return {
    isOnline,
    enqueue,
    flush,
    pendingCount: ownedQueue.filter(q => q.status === 'pending' || q.status === 'syncing').length,
    hasPending: ownedQueue.length > 0,
    queue: ownedQueue
  };
};
