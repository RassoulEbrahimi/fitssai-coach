import { useState, useEffect, useCallback, useRef } from 'react';

interface RestTimerState {
  exerciseIndex: number | null;
  remainingSeconds: number;
  totalRestSeconds: number;
  isComplete: boolean;
}

interface UseRestTimerReturn {
  timerState: RestTimerState;
  startTimer: (exerciseIndex: number, durationSeconds: number) => void;
  skipTimer: () => void;
  isTimerActiveFor: (exerciseIndex: number) => boolean;
}

export function useRestTimer(): UseRestTimerReturn {
  const [timerState, setTimerState] = useState<RestTimerState>({
    exerciseIndex: null,
    remainingSeconds: 0,
    totalRestSeconds: 0,
    isComplete: false,
  });

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
              setTimerState({
                exerciseIndex: null,
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

  const startTimer = useCallback((exerciseIndex: number, durationSeconds: number) => {
    // Clear any existing timers
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current);

    setTimerState({
      exerciseIndex,
      remainingSeconds: durationSeconds,
      totalRestSeconds: durationSeconds,
      isComplete: false,
    });
  }, []);

  const skipTimer = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current);

    setTimerState({
      exerciseIndex: null,
      remainingSeconds: 0,
      totalRestSeconds: 0,
      isComplete: false,
    });
  }, []);

  const isTimerActiveFor = useCallback((exerciseIndex: number): boolean => {
    return timerState.exerciseIndex === exerciseIndex && 
           (timerState.remainingSeconds > 0 || timerState.isComplete);
  }, [timerState.exerciseIndex, timerState.remainingSeconds, timerState.isComplete]);

  return {
    timerState,
    startTimer,
    skipTimer,
    isTimerActiveFor,
  };
}
