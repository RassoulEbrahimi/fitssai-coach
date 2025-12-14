import React, { ReactNode } from 'react';
import { TrainingDataProvider, useTrainingData, WorkoutItem } from './TrainingDataContext';
import { TrainingSessionProvider, useTrainingSession } from './TrainingSessionContext';

// Re-export specific contexts for optimized usage
export { useTrainingData } from './TrainingDataContext';
export { useTrainingSession } from './TrainingSessionContext';
export type { WorkoutItem } from './TrainingDataContext';

export function TrainingProvider({ children }: { children: ReactNode }) {
    return (
        <TrainingDataProvider>
            <TrainingSessionProvider>
                {children}
            </TrainingSessionProvider>
        </TrainingDataProvider>
    );
}

// Legacy hook for backward compatibility (will trigger re-renders on timer tick)
export function useTraining() {
    const data = useTrainingData();
    const session = useTrainingSession();

    return {
        ...data,
        ...session
    };
}
