import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Exercise } from '@/hooks/useExerciseEditor';

const WORKOUT_STORAGE_KEY = 'fitssai.training.cache';
const SESSION_STARTED_KEY = 'fitssai.training.session.started';
const SESSION_START_TIME_KEY = 'fitssai.training.session.start_time';

export interface WorkoutItem extends Exercise {
  id: string;
  weekKey?: string;
  dayIndex?: number;
  exerciseIndex?: number;
  completed?: boolean;
}

interface TrainingContextValue {
  // Workout Data
  todayWorkouts: WorkoutItem[];
  setTodayWorkouts: React.Dispatch<React.SetStateAction<WorkoutItem[]>>;
  addWorkout: (item: WorkoutItem) => void;
  removeWorkout: (id: string) => void;
  updateWorkout: (id: string, updates: Partial<WorkoutItem>) => void;
  clearToday: () => void;
  syncFromPlan: (exercises: any[], weekKey: string, dayIndex: number) => void;

  // Session State
  isStarted: boolean;
  duration: number; // in seconds
  startSession: () => void;
  endSession: () => void;
}

const TrainingContext = createContext<TrainingContextValue | undefined>(undefined);

export function TrainingProvider({ children }: { children: ReactNode }) {
  // --- Workout Data State ---
  const [todayWorkouts, setTodayWorkouts] = useState<WorkoutItem[]>(() => {
    try {
      const stored = localStorage.getItem(WORKOUT_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      console.error('Failed to parse training cache:', error);
    }
    return [];
  });

  // --- Session State ---
  const [isStarted, setIsStarted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SESSION_STARTED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [startTime, setStartTime] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem(SESSION_START_TIME_KEY);
      return stored ? parseInt(stored, 10) : null;
    } catch {
      return null;
    }
  });

  const [duration, setDuration] = useState(0);

  // Persist workout data
  useEffect(() => {
    try {
      localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(todayWorkouts));
    } catch (error) {
      console.error('Failed to save training cache:', error);
    }
  }, [todayWorkouts]);

  // Sync workout data across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === WORKOUT_STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setTodayWorkouts(Array.isArray(parsed) ? parsed : []);
        } catch (error) {
          console.error('Failed to sync training data from storage event:', error);
        }
      }
      // Also sync session state if changed in another tab
      if (e.key === SESSION_STARTED_KEY) {
        setIsStarted(e.newValue === 'true');
      }
      if (e.key === SESSION_START_TIME_KEY) {
        setStartTime(e.newValue ? parseInt(e.newValue, 10) : null);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Timer Logic
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    if (isStarted && startTime) {
      // Immediate update
      setDuration(Math.floor((Date.now() - startTime) / 1000));

      interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } else {
      setDuration(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isStarted, startTime]);

  // --- Actions ---

  const addWorkout = useCallback((item: WorkoutItem) => {
    setTodayWorkouts(prev => {
      if (prev.some(w => w.id === item.id)) return prev;
      return [...prev, item];
    });
  }, []);

  const removeWorkout = useCallback((id: string) => {
    setTodayWorkouts(prev => prev.filter(w => w.id !== id));
  }, []);

  const updateWorkout = useCallback((id: string, updates: Partial<WorkoutItem>) => {
    setTodayWorkouts(prev =>
      prev.map(w => w.id === id ? { ...w, ...updates } : w)
    );
  }, []);

  const clearToday = useCallback(() => {
    setTodayWorkouts([]);
  }, []);

  const syncFromPlan = useCallback((exercises: any[], weekKey: string, dayIndex: number) => {
    const workoutItems: WorkoutItem[] = exercises.map((ex, idx) => ({
      id: `${weekKey}_${dayIndex}_${idx}`,
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      weight: ex.weight,
      rest: ex.rest,
      description: ex.description,
      weekKey,
      dayIndex,
      exerciseIndex: idx,
      completed: ex.completed || false,
    }));

    setTodayWorkouts(workoutItems);
  }, []);

  // Session Actions
  const startSession = useCallback(() => {
    const now = Date.now();
    setIsStarted(true);
    setStartTime(now);
    localStorage.setItem(SESSION_STARTED_KEY, 'true');
    localStorage.setItem(SESSION_START_TIME_KEY, now.toString());
  }, []);

  const endSession = useCallback(() => {
    setIsStarted(false);
    setStartTime(null);
    setDuration(0);
    localStorage.removeItem(SESSION_STARTED_KEY);
    localStorage.removeItem(SESSION_START_TIME_KEY);
  }, []);

  return (
    <TrainingContext.Provider
      value={{
        todayWorkouts,
        setTodayWorkouts,
        addWorkout,
        removeWorkout,
        updateWorkout,
        clearToday,
        syncFromPlan,
        isStarted,
        duration,
        startSession,
        endSession
      }}
    >
      {children}
    </TrainingContext.Provider>
  );
}

export function useTraining() {
  const context = useContext(TrainingContext);
  if (context === undefined) {
    throw new Error('useTraining must be used within a TrainingProvider');
  }
  return context;
}
