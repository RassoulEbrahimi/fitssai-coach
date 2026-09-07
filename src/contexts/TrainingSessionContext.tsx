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
    withFinishAttempt,
    withoutFinishAttempt,
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
    startSession: (binding?: { planId: string; weekKey: string; dayIndex: number; workoutDay?: string }) => void;
    endSession: () => void;
    /**
     * Freeze the instant the user stopped training and return it, or null when
     * nothing bound is running. Idempotent: every later call during the same
     * session returns the first stamp, so a retry after a failed save measures
     * the workout rather than the wait.
     */
    markFinishAttempt: (endedAt?: number) => number | null;
    /** Drop a stamped finish instant when the user goes back to training. */
    clearFinishAttempt: () => void;
    /**
     * Validate any stored session against the loaded plan. Called once the plan
     * is known; a session that does not match is ended rather than rebound.
     */
    validateSessionAgainstPlan: (plan: SessionPlanContext) => void;
}

const TrainingSessionContext = createContext<TrainingSessionContextValue | undefined>(undefined);

export function TrainingSessionProvider({ children }: { children: ReactNode }) {
    /**
     * The live session, mirrored into a ref.
     *
     * `markFinishAttempt` has to read and stamp the session synchronously
     * inside a click handler and hand the value straight to the write, which a
     * `useState` value alone cannot do — it would still be the pre-click
     * render's copy. Every write goes through `setSession` so the two never
     * drift apart.
     */
    const sessionRef = useRef<TrainingSessionPayload | null>(null);
    const [session, setSessionState] = useState<TrainingSessionPayload | null>(() => {
        // The legacy keys carried no plan binding, so there is nothing safe to
        // resume from them; migrateLegacySession clears them.
        migrateLegacySession();
        const stored = readStoredSession();
        sessionRef.current = stored;
        return stored;
    });

    const setSession = useCallback((next: TrainingSessionPayload | null) => {
        sessionRef.current = next;
        setSessionState(next);
    }, []);

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
    }, [setSession]);

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
        (binding?: { planId: string; weekKey: string; dayIndex: number; workoutDay?: string }) => {
            if (!binding) {
                // Without a plan day there is nothing to resume into later, so
                // nothing is persisted — the session runs in memory only.
                setSession(null);
                clearStoredSession();
                setStartedAt(Date.now());
                return;
            }
            const payload = createSessionPayload(binding.planId, binding.weekKey, binding.dayIndex, Date.now(), binding.workoutDay);
            validatedForRef.current = `${payload.planId}|${payload.weekKey}|${payload.dayIndex}`;
            setSession(payload);
            setStartedAt(payload.startedAt);
            writeStoredSession(payload);
        },
        [setSession]
    );

    const endSession = useCallback(() => {
        validatedForRef.current = null;
        setSession(null);
        setStartedAt(null);
        setDuration(0);
        clearStoredSession();
    }, [setSession]);

    /*
      The frozen finish instant lives in the stored payload, so a reload or a
      remount between a failed save and its retry still measures the same
      workout. Nothing here writes a duration; it only records when the user
      said they were done.
    */
    const markFinishAttempt = useCallback((endedAt: number = Date.now()): number | null => {
        const current = sessionRef.current;
        if (!current) return null;
        const stamped = withFinishAttempt(current, endedAt);
        if (stamped !== current) {
            setSession(stamped);
            writeStoredSession(stamped);
        }
        return stamped.endedAt ?? null;
    }, [setSession]);

    const clearFinishAttempt = useCallback(() => {
        const current = sessionRef.current;
        if (!current) return;
        const resumed = withoutFinishAttempt(current);
        if (resumed === current) return;
        setSession(resumed);
        writeStoredSession(resumed);
    }, [setSession]);

    const validateSessionAgainstPlan = useCallback((plan: SessionPlanContext) => {
        const current = sessionRef.current;
        if (!current) return;

        const key = `${current.planId}|${current.weekKey}|${current.dayIndex}`;
        if (validatedForRef.current === key) return;

        const { session: resolved, reason } = resolveStoredSession(current, plan);
        if (resolved) {
            validatedForRef.current = key;
            setSession(resolved);
            return;
        }

        // Stale: end it. Never silently rebind to today's workout.
        clearStoredSession();
        validatedForRef.current = null;
        setStartedAt(null);
        setSession(null);
        setRejectionNotice(describeSessionRejection(reason as SessionRejectionReason));
    }, [setSession]);

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
                markFinishAttempt,
                clearFinishAttempt,
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
