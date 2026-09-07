import React from 'react';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export const OfflineBanner: React.FC<{ className?: string }> = ({ className }) => {
  const { isOnline, pendingCount, failedCount, storageError } = useOfflineQueue();

  if (isOnline && !pendingCount && !storageError) return null;

  return (
    <div
      className={cn(
        "w-full bg-yellow-500/10 text-yellow-500 px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium animate-in slide-in-from-top-2",
        className
      )}
      role="alert"
      aria-live="polite"
    >
      <WifiOff className="h-4 w-4" />
      <span>{storageError ? 'Offline-Speicher nicht verfügbar. Bitte erneut versuchen.'
        : failedCount ? `${pendingCount} Änderungen lokal gespeichert. Synchronisierung wird erneut versucht.`
        : pendingCount ? `${pendingCount} Änderungen lokal gespeichert. Synchronisierung ausstehend.`
        : 'Offline-Modus aktiv. Erfolgreiches lokales Speichern wird bestätigt.'}</span>
    </div>
  );
};
