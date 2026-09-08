import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toastWithIcon, toastOffline } from '@/lib/toastWithIcon';
import { logEvent } from '@/lib/telemetryClient';
import {
  loadQueue, enqueue as enqueueToLib, QUEUE_CHANGED_EVENT,
  OfflineMutationType, OfflineMutationPayloads, OfflineMutationEntry,
} from '@/lib/offlineQueue';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { assertAccountOwner } from '@/lib/accountIdentity';
import { flushOfflineQueue } from '@/lib/offlineReplay';

export const useOfflineQueue = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const ownerUid = user?.uid;
  const [queue, setQueue] = useState<OfflineMutationEntry[]>([]);
  const [storageError, setStorageError] = useState<string>();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const refresh = useCallback(() => {
    try {
      setQueue(loadQueue());
      setStorageError(undefined);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const flush = useCallback(async () => {
    if (!ownerUid || auth.currentUser?.uid !== ownerUid) return;
    const result = await flushOfflineQueue(ownerUid, keys => {
      if (auth.currentUser?.uid === ownerUid) {
        for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
      }
    });
    refresh();
    if (auth.currentUser?.uid !== ownerUid) return;
    if (result.storageError) {
      setStorageError(result.storageError.message);
      toastWithIcon({ title: 'Offline-Speicher fehlgeschlagen',
        description: 'Synchronisierung nicht bestätigt. Die gespeicherte Warteschlange bleibt für einen erneuten Versuch erhalten.',
        variant: 'destructive', duration: 4000 });
    } else if (result.failed) {
      toastWithIcon({ title: 'Synchronisierung ausstehend',
        description: 'Änderungen bleiben lokal gespeichert. Wir versuchen es erneut.',
        variant: 'destructive', duration: 4000 });
    } else if (result.completed) {
      toastWithIcon({ title: 'Synchronisiert', description: 'Offline-Änderungen wurden gespeichert.',
        variant: 'success', duration: 3000 });
    }
  }, [ownerUid, queryClient, refresh]);

  useEffect(() => {
    refresh();
    const online = () => { setIsOnline(true); void flush(); };
    const offline = () => { setIsOnline(false); };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('storage', refresh);
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);
    const timer = setTimeout(() => { if (navigator.onLine) void flush(); }, 1000);
    // An active lease restored while online must eventually be revisited.
    const retryTimer = setInterval(() => { if (navigator.onLine) void flush(); }, 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(retryTimer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('storage', refresh);
      window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
    };
  }, [flush, refresh]);

  const enqueue = useCallback(<T extends OfflineMutationType>(type: T, payload: OfflineMutationPayloads[T]) => {
    assertAccountOwner(ownerUid);
    // Throws before state/toasts on any read or write failure.
    const { entry } = enqueueToLib(type, payload, ownerUid);
    refresh();
    // Durable either way, but only the offline case is waiting for the network
    // to come back; a write queued after a failed online attempt is not.
    toastOffline('Offline gespeichert', navigator.onLine
      ? 'Verbindungsproblem. Wir versuchen die Synchronisierung erneut.'
      : 'Wir synchronisieren das, sobald du wieder online bist.', 3000);
    logEvent('queue_operation_added', { operationId: entry.id, type });
    return entry.id;
  }, [ownerUid, refresh]);

  const ownedQueue = queue.filter(entry => !!ownerUid && entry.ownerUid === ownerUid && entry.status !== 'quarantined');
  return {
    isOnline, enqueue, flush, storageError,
    pendingCount: ownedQueue.length,
    failedCount: ownedQueue.filter(entry => entry.status === 'failed').length,
    hasPending: ownedQueue.length > 0,
    queue: ownedQueue,
  };
};
