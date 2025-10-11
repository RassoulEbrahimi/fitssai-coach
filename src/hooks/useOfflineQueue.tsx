import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { logEvent } from '@/lib/telemetryClient';

interface QueuedOperation {
  id: string;
  fn: () => Promise<any>;
  params: any;
  timestamp: number;
}

export const useOfflineQueue = () => {
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { toast } = useToast();

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      logEvent('connection_restored', { queueLength: queue.length });
      toast({
        title: 'Verbindung wiederhergestellt',
        description: 'Änderungen werden synchronisiert...',
        duration: 2500,
      });
    };

    const handleOffline = () => {
      setIsOnline(false);
      logEvent('offline_mode_activated', { queueLength: queue.length });
      toast({
        title: 'Offline-Modus',
        description: 'Änderungen werden synchronisiert, sobald du online bist.',
        duration: 3000,
        role: 'alert',
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [toast]);

  // Process queue when coming back online
  useEffect(() => {
    if (isOnline && queue.length > 0) {
      processQueue();
    }
  }, [isOnline, queue.length]);

  const processQueue = async () => {
    const operations = [...queue];
    setQueue([]);

    logEvent('queue_processing_start', { operationCount: operations.length });

    for (const operation of operations) {
      try {
        await operation.fn();
        logEvent('queue_operation_success', { operationId: operation.id });
      } catch (error) {
        console.error('Failed to process queued operation:', error);
        logEvent('queue_operation_failed', { operationId: operation.id });
        // Re-queue on failure
        setQueue((prev) => [...prev, operation]);
      }
    }
  };

  const addToQueue = useCallback((fn: () => Promise<any>, params: any) => {
    const operation: QueuedOperation = {
      id: `${Date.now()}-${Math.random()}`,
      fn,
      params,
      timestamp: Date.now(),
    };

    logEvent('queue_operation_added', { operationId: operation.id, params });
    setQueue((prev) => [...prev, operation]);
  }, []);

  return {
    isOnline,
    addToQueue,
    queueLength: queue.length,
  };
};
