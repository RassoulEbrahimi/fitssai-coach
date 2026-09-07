import { useState, useCallback } from 'react';
import { toast } from 'sonner';

export const useThrottledToast = (throttleMs = 2000) => {
  const [lastToastTime, setLastToastTime] = useState(0);

  // 'info' is for a truthful partial outcome — something finished, but not
  // everything it normally would. A green success toast would overstate it.
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const now = Date.now();
    if (now - lastToastTime >= throttleMs) {
      setLastToastTime(now);
      toast[type](message);
    }
  }, [lastToastTime, throttleMs]);

  return { showToast };
};
