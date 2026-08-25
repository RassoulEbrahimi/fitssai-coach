import { useState, useEffect, useCallback, useRef } from 'react';

interface RestTimerState {
  exerciseIndex: number | null;
  /**
   * The set that started this timer. A rest timer belongs to one specific set,
   * so un-completing that set cancels it — and a change to any other set does
   * not.
   */
  setNumber: number | null;
  remainingSeconds: number;
  totalRestSeconds: number;
  isComplete: boolean;
}

interface UseRestTimerReturn {
  timerState: RestTimerState;
  startTimer: (exerciseIndex: number, durationSeconds: number, setNumber?: number | null) => void;
  skipTimer: () => void;
  isTimerActiveFor: (exerciseIndex: number) => boolean;
  /** True when the running timer was started by exactly this set. */
  isTimerOwnedBy: (exerciseIndex: number, setNumber: number) => boolean;
  /** Cancel the timer only if this exact set owns it. */
  cancelTimerForSet: (exerciseIndex: number, setNumber: number) => void;
}

export function useRestTimer(): UseRestTimerReturn {
  const IDLE: RestTimerState = {
    exerciseIndex: null,
    setNumber: null,
    remainingSeconds: 0,
    totalRestSeconds: 0,
    isComplete: false,
  };

  const [timerState, setTimerState] = useState<RestTimerState>(IDLE);

  /**
   * Mirrors timerState for the ownership checks. Rapid toggles can fire several
   * handlers before React re-renders, so ownership is read from the ref rather
   * than from possibly-stale state.
   */
  const ownerRef = useRef<{ exerciseIndex: number; setNumber: number | null } | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const completeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current);
    };
  }, []);

  // Timer countdown effect
  useEffect(() => {
    if (timerState.exerciseIndex !== null && timerState.remainingSeconds > 0) {
      intervalRef.current = setInterval(() => {
        setTimerState((prev) => {
          if (prev.remainingSeconds <= 1) {
            // Timer complete - show completion message
            if (intervalRef.current) clearInterval(intervalRef.current);
            
            // Haptic feedback - double buzz pattern
            if ('vibrate' in navigator) {
              navigator.vibrate([200, 100, 200]);
            }
            
            // Auto-hide after 2.5 seconds
            completeTimeoutRef.current = setTimeout(() => {
              ownerRef.current = null;
              setTimerState({
                exerciseIndex: null,
                setNumber: null,
                remainingSeconds: 0,
                totalRestSeconds: 0,
                isComplete: false,
              });
            }, 2500);

            return {
              ...prev,
              remainingSeconds: 0,
              isComplete: true,
            };
          }
          return {
            ...prev,
            remainingSeconds: prev.remainingSeconds - 1,
          };
        });
      }, 1000);

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  }, [timerState.exerciseIndex, timerState.remainingSeconds > 0]);

  const startTimer = useCallback(
    (exerciseIndex: number, durationSeconds: number, setNumber: number | null = null) => {
      // Clear any existing timers
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current);

      ownerRef.current = { exerciseIndex, setNumber };
      setTimerState({
        exerciseIndex,
        setNumber,
        remainingSeconds: durationSeconds,
        totalRestSeconds: durationSeconds,
        isComplete: false,
      });
    },
    []
  );

  const skipTimer = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current);

    ownerRef.current = null;
    setTimerState({
      exerciseIndex: null,
      setNumber: null,
      remainingSeconds: 0,
      totalRestSeconds: 0,
      isComplete: false,
    });
  }, []);

  const isTimerOwnedBy = useCallback((exerciseIndex: number, setNumber: number): boolean => {
    const owner = ownerRef.current;
    return owner !== null && owner.exerciseIndex === exerciseIndex && owner.setNumber === setNumber;
  }, []);

  const cancelTimerForSet = useCallback(
    (exerciseIndex: number, setNumber: number) => {
      if (!isTimerOwnedBy(exerciseIndex, setNumber)) return;
      skipTimer();
    },
    [isTimerOwnedBy, skipTimer]
  );

  const isTimerActiveFor = useCallback((exerciseIndex: number): boolean => {
    return timerState.exerciseIndex === exerciseIndex && 
           (timerState.remainingSeconds > 0 || timerState.isComplete);
  }, [timerState.exerciseIndex, timerState.remainingSeconds, timerState.isComplete]);

  return {
    timerState,
    startTimer,
    skipTimer,
    isTimerActiveFor,
    isTimerOwnedBy,
    cancelTimerForSet,
  };
}
