import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

export const SESSION_STARTED_KEY = 'fitssai.training.session.started';
export const SESSION_START_TIME_KEY = 'fitssai.training.session.start_time';

interface TrainingSessionContextValue {
    isStarted: boolean;
    duration: number; // in seconds
    startSession: () => void;
    endSession: () => void;
}

const TrainingSessionContext = createContext<TrainingSessionContextValue | undefined>(undefined);

export function TrainingSessionProvider({ children }: { children: ReactNode }) {
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

    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
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

    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;

        if (isStarted && startTime) {
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
        <TrainingSessionContext.Provider
            value={{
                isStarted,
                duration,
                startSession,
                endSession
            }}
        >
            {children}
        </TrainingSessionContext.Provider>
    );
}

export function useTrainingSession() {
    const context = useContext(TrainingSessionContext);
    if (context === undefined) {
        throw new Error('useTrainingSession must be used within a TrainingSessionProvider');
    }
    return context;
}
