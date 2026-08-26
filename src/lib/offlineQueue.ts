
export type OfflineMutationType = 'TOGGLE_DAY_COMPLETION' | 'TOGGLE_SET' | 'TOGGLE_DAY';

/**
 * Marking one *exercise* complete.
 *
 * The name is historical: despite "DAY_COMPLETION" this identifies a single
 * exercise position, and it is what `useWeekCompletion.toggleExercise`
 * enqueues. It is left alone so queue entries already in localStorage under
 * this type keep replaying correctly.
 */
export interface ToggleDayCompletionPayload {
    planId: string;
    weekKey: string;
    dayIndex: number;
    exerciseIndex: number;
    completed: boolean;
    durationMinutes?: number;
    caloriesBurned?: number;
}

/**
 * Marking a whole plan *day* complete.
 *
 * `useWorkoutLogs.toggleDay` used to enqueue under TOGGLE_DAY_COMPLETION with
 * only `{workoutDateStr, completed}`, which that handler reads as
 * planId/weekKey/dayIndex/exerciseIndex — all undefined. Every offline day
 * completion therefore replayed as a junk document. A day completion is a
 * different thing from an exercise completion, so it gets its own type rather
 * than overloading one payload with two meanings.
 *
 * There is deliberately no `exerciseIndex`: a day is not an exercise.
 */
export interface ToggleDayPayload {
    planId: string;
    weekKey: string;
    dayIndex: number;
    /** `YYYY-MM-DD`, Europe/Berlin — the day the user actually selected. */
    workoutDay: string;
    completed: boolean;
}

export interface ToggleSetPayload {
    planId: string;
    weekKey: string;
    dayIndex: number;
    exerciseIndex: number;
    setNumber: number;
    repsCompleted: number;
    weightUsed?: number | null;
    completed: boolean;
}

export type OfflineMutationPayloads = {
    TOGGLE_DAY_COMPLETION: ToggleDayCompletionPayload;
    TOGGLE_SET: ToggleSetPayload;
    TOGGLE_DAY: ToggleDayPayload;
};

/**
 * The shape `useWorkoutLogs.toggleDay` used to enqueue under
 * TOGGLE_DAY_COMPLETION. Entries in this shape may still be sitting in a
 * user's localStorage queue, so the handler has to recognise them.
 */
export interface LegacyToggleDayPayload {
    workoutDateStr?: string;
    completed?: boolean;
}

/** True for a pre-PR48 day-completion entry: a date, and no plan position. */
export const isLegacyDayCompletionPayload = (
    payload: unknown
): payload is LegacyToggleDayPayload => {
    if (!payload || typeof payload !== 'object') return false;
    const candidate = payload as Record<string, unknown>;
    return (
        typeof candidate.workoutDateStr === 'string' &&
        candidate.planId === undefined &&
        candidate.exerciseIndex === undefined
    );
};

export interface OfflineMutationEntry<T extends OfflineMutationType = OfflineMutationType> {
    id: string;
    type: T;
    payload: OfflineMutationPayloads[T];
    createdAt: number;
    status: 'pending' | 'syncing' | 'synced' | 'failed';
    attempts: number;
    lastError?: string;
}

const STORAGE_KEY = 'FITSSAI_OFFLINE_QUEUE';

export const loadQueue = (): OfflineMutationEntry[] => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (error) {
        console.error('Failed to load offline queue:', error);
        return [];
    }
};

export const saveQueue = (queue: OfflineMutationEntry[]): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch (error) {
        console.error('Failed to save offline queue:', error);
    }
};

export const enqueue = <T extends OfflineMutationType>(
    type: T,
    payload: OfflineMutationPayloads[T]
): { queue: OfflineMutationEntry[]; entry: OfflineMutationEntry<T> } => {
    const queue = loadQueue();
    const entry: OfflineMutationEntry<T> = {
        id: crypto.randomUUID(),
        type,
        payload,
        createdAt: Date.now(),
        status: 'pending',
        attempts: 0,
    };

    const newQueue = [...queue, entry];
    saveQueue(newQueue);

    if (import.meta.env.DEV) {
        console.log(`[OfflineQueue] Enqueued: ${type}`, payload);
    }

    return { queue: newQueue, entry };
};

export const updateEntry = (
    id: string,
    patch: Partial<OfflineMutationEntry>
): OfflineMutationEntry[] => {
    const queue = loadQueue();
    const newQueue = queue.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
    );
    saveQueue(newQueue);
    return newQueue;
};

export const removeEntry = (
    id: string
): OfflineMutationEntry[] => {
    const queue = loadQueue();
    const newQueue = queue.filter((entry) => entry.id !== id);
    saveQueue(newQueue);
    return newQueue;
};

export const clearAll = (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
};
