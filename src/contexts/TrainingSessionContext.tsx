import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    ReactNode,
    useCallback,
    useRef,
} from 'react';
import {
    SESSION_STORAGE_KEY,
    createSessionPayload,
    clearStoredSession,
    describeSessionRejection,
    migrateLegacySession,
    parseSessionPayload,
    readStoredSession,
    resolveStoredSession,
    writeStoredSession,
    type SessionPlanContext,
    type SessionRejectionReason,
    type TrainingSessionPayload,
} from '@/lib/trainingSession';

interface TrainingSessionContextValue {
    isStarted: boolean;
    duration: number; // in seconds
    /** The plan day this session is bound to, or null when nothing is running. */
    session: TrainingSessionPayload | null;
    /** Set when a stored session had to be discarded; cleared once shown. */
    rejectionNotice: string | null;
    clearRejectionNotice: () => void;
    startSession: (binding?: { planId: string; weekKey: string; dayIndex: number }) => void;
    endSession: () => void;
    /**
     * Validate any stored session against the loaded plan. Called once the plan
     * is known; a session that does not match is ended rather than rebound.
     */
    validateSessionAgainstPlan: (plan: SessionPlanContext) => void;
}

const TrainingSessionContext = createContext<TrainingSessionContextValue | undefined>(undefined);

export function TrainingSessionProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<TrainingSessionPayload | null>(() => {
        // The legacy keys carried no plan binding, so there is nothing safe to
        // resume from them; migrateLegacySession clears them.
        migrateLegacySession();
        return readStoredSession();
    });

    const [rejectionNotice, setRejectionNotice] = useState<string | null>(null);
    const [duration, setDuration] = useState(0);
    /** Validate against the plan only once per loaded session. */
    const validatedForRef = useRef<string | null>(null);

    /**
     * When the session starts, this is when. A *bound* session also persists
     * its plan day; an unbound one (no plan loaded yet) runs in memory only, so
     * it simply does not survive a reload — which is correct, because there is
     * no day to resume into.
     */
    const [startedAt, setStartedAt] = useState<number | null>(() =>
        session ? session.startedAt : null
    );

    const isStarted = startedAt !== null;

    // Keep other tabs in sync.
    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key !== SESSION_STORAGE_KEY) return;
            const next = parseSessionPayload(e.newValue);
            setSession(next);
            setStartedAt(next ? next.startedAt : null);
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;

        if (startedAt !== null) {
            const tick = () => setDuration(Math.floor((Date.now() - startedAt) / 1000));
            tick();
            interval = setInterval(tick, 1000);
        } else {
            setDuration(0);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [startedAt]);

    const startSession = useCallback(
        (binding?: { planId: string; weekKey: string; dayIndex: number }) => {
            if (!binding) {
                // Without a plan day there is nothing to resume into later, so
                // nothing is persisted — the session runs in memory only.
                setSession(null);
                clearStoredSession();
                setStartedAt(Date.now());
                return;
            }
            const payload = createSessionPayload(binding.planId, binding.weekKey, binding.dayIndex);
            validatedForRef.current = `${payload.planId}|${payload.weekKey}|${payload.dayIndex}`;
            setSession(payload);
            setStartedAt(payload.startedAt);
            writeStoredSession(payload);
        },
        []
    );

    const endSession = useCallback(() => {
        validatedForRef.current = null;
        setSession(null);
        setStartedAt(null);
        setDuration(0);
        clearStoredSession();
    }, []);

    const validateSessionAgainstPlan = useCallback((plan: SessionPlanContext) => {
        setSession((current) => {
            if (!current) return current;

            const key = `${current.planId}|${current.weekKey}|${current.dayIndex}`;
            if (validatedForRef.current === key) return current;

            const { session: resolved, reason } = resolveStoredSession(current, plan);
            if (resolved) {
                validatedForRef.current = key;
                return resolved;
            }

            // Stale: end it. Never silently rebind to today's workout.
            clearStoredSession();
            validatedForRef.current = null;
            setStartedAt(null);
            setRejectionNotice(describeSessionRejection(reason as SessionRejectionReason));
            return null;
        });
    }, []);

    const clearRejectionNotice = useCallback(() => setRejectionNotice(null), []);

    return (
        <TrainingSessionContext.Provider
            value={{
                isStarted,
                duration,
                session,
                rejectionNotice,
                clearRejectionNotice,
                startSession,
                endSession,
                validateSessionAgainstPlan,
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
