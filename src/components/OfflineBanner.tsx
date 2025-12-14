import React from 'react';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export const OfflineBanner: React.FC<{ className?: string }> = ({ className }) => {
  const { isOnline } = useOfflineQueue();

  if (isOnline) return null;

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
      <span>Offline-Modus aktiv - Änderungen werden lokal gespeichert.</span>
    </div>
  );
};