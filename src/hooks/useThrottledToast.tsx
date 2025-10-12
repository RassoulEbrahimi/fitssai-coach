import { useState, useCallback } from 'react';
import { toast } from 'sonner';

export const useThrottledToast = (throttleMs = 2000) => {
  const [lastToastTime, setLastToastTime] = useState(0);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const now = Date.now();
    if (now - lastToastTime >= throttleMs) {
      setLastToastTime(now);
      toast[type](message);
    }
  }, [lastToastTime, throttleMs]);

  return { showToast };
};
