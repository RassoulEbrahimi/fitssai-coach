import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Exercise } from '@/hooks/useExerciseEditor';

const STORAGE_KEY = 'fitssai.training.cache';

export interface WorkoutItem extends Exercise {
  id: string;
  weekKey?: string;
  dayIndex?: number;
  exerciseIndex?: number;
  completed?: boolean;
}

interface TrainingContextValue {
  todayWorkouts: WorkoutItem[];
  setTodayWorkouts: React.Dispatch<React.SetStateAction<WorkoutItem[]>>;
  addWorkout: (item: WorkoutItem) => void;
  removeWorkout: (id: string) => void;
  updateWorkout: (id: string, updates: Partial<WorkoutItem>) => void;
  clearToday: () => void;
  syncFromPlan: (exercises: any[], weekKey: string, dayIndex: number) => void;
}

const TrainingContext = createContext<TrainingContextValue | undefined>(undefined);

export function TrainingProvider({ children }: { children: ReactNode }) {
  const [todayWorkouts, setTodayWorkouts] = useState<WorkoutItem[]>(() => {
    // Initialize from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      console.error('Failed to parse training cache:', error);
    }
    return [];
  });

  // Persist to localStorage whenever todayWorkouts changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todayWorkouts));
    } catch (error) {
      console.error('Failed to save training cache:', error);
    }
  }, [todayWorkouts]);

  // Sync across tabs using storage event
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setTodayWorkouts(Array.isArray(parsed) ? parsed : []);
        } catch (error) {
          console.error('Failed to sync training data from storage event:', error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Add a workout to today's list
  const addWorkout = useCallback((item: WorkoutItem) => {
    setTodayWorkouts(prev => {
      // Prevent duplicates based on ID
      if (prev.some(w => w.id === item.id)) {
        return prev;
      }
      return [...prev, item];
    });
  }, []);

  // Remove a workout from today's list
  const removeWorkout = useCallback((id: string) => {
    setTodayWorkouts(prev => prev.filter(w => w.id !== id));
  }, []);

  // Update a specific workout
  const updateWorkout = useCallback((id: string, updates: Partial<WorkoutItem>) => {
    setTodayWorkouts(prev => 
      prev.map(w => w.id === id ? { ...w, ...updates } : w)
    );
  }, []);

  // Clear all workouts for today
  const clearToday = useCallback(() => {
    setTodayWorkouts([]);
  }, []);

  // Sync workout list from plan data (exercises array from backend)
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

  return (
    <TrainingContext.Provider 
      value={{ 
        todayWorkouts, 
        setTodayWorkouts,
        addWorkout, 
        removeWorkout,
        updateWorkout,
        clearToday,
        syncFromPlan
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
