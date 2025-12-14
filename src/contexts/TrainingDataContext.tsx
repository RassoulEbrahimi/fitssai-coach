import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Exercise } from '@/hooks/useExerciseEditor';

export const WORKOUT_STORAGE_KEY = 'fitssai.training.cache';

export interface WorkoutItem extends Exercise {
    id: string;
    weekKey?: string;
    dayIndex?: number;
    exerciseIndex?: number;
    completed?: boolean;
}

interface TrainingDataContextValue {
    todayWorkouts: WorkoutItem[];
    setTodayWorkouts: React.Dispatch<React.SetStateAction<WorkoutItem[]>>;
    addWorkout: (item: WorkoutItem) => void;
    removeWorkout: (id: string) => void;
    updateWorkout: (id: string, updates: Partial<WorkoutItem>) => void;
    clearToday: () => void;
    syncFromPlan: (exercises: (Exercise & { completed?: boolean })[], weekKey: string, dayIndex: number) => void;
}

const TrainingDataContext = createContext<TrainingDataContextValue | undefined>(undefined);

export function TrainingDataProvider({ children }: { children: ReactNode }) {
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

    useEffect(() => {
        try {
            localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(todayWorkouts));
        } catch (error) {
            console.error('Failed to save training cache:', error);
        }
    }, [todayWorkouts]);

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
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

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

    const syncFromPlan = useCallback((exercises: (Exercise & { completed?: boolean })[], weekKey: string, dayIndex: number) => {
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
        <TrainingDataContext.Provider
            value={{
                todayWorkouts,
                setTodayWorkouts,
                addWorkout,
                removeWorkout,
                updateWorkout,
                clearToday,
                syncFromPlan,
            }}
        >
            {children}
        </TrainingDataContext.Provider>
    );
}

export function useTrainingData() {
    const context = useContext(TrainingDataContext);
    if (context === undefined) {
        throw new Error('useTrainingData must be used within a TrainingDataProvider');
    }
    return context;
}
