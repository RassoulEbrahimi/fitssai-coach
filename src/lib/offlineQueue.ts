
export type OfflineMutationType = 'TOGGLE_DAY_COMPLETION' | 'TOGGLE_SET';

export interface ToggleDayCompletionPayload {
    planId: string;
    weekKey: string;
    dayIndex: number;
    exerciseIndex: number;
    completed: boolean;
    durationMinutes?: number;
    caloriesBurned?: number;
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
    queue: OfflineMutationEntry[],
    type: T,
    payload: OfflineMutationPayloads[T]
): { queue: OfflineMutationEntry[]; entry: OfflineMutationEntry<T> } => {
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
    return { queue: newQueue, entry };
};

export const updateEntry = (
    queue: OfflineMutationEntry[],
    id: string,
    patch: Partial<OfflineMutationEntry>
): OfflineMutationEntry[] => {
    const newQueue = queue.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
    );
    saveQueue(newQueue);
    return newQueue;
};

export const removeEntry = (
    queue: OfflineMutationEntry[],
    id: string
): OfflineMutationEntry[] => {
    const newQueue = queue.filter((entry) => entry.id !== id);
    saveQueue(newQueue);
    return newQueue;
};

export const clearAll = (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
};
