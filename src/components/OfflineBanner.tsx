import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';

export const OfflineBanner = () => {
  const { isOnline } = useOfflineQueue();
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only show if offline, hide immediately when online
    setShow(!isOnline);
  }, [isOnline]);

  if (!show) return null;

  return (
    <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2">
      <div className="flex items-center justify-center gap-2 text-sm text-yellow-500">
        <WifiOff className="h-4 w-4" />
        <span className="font-medium">Offline-Modus aktiv</span>
        <span className="hidden sm:inline opacity-75">- Änderungen werden lokal gespeichert.</span>
      </div>
    </div>
  );
};