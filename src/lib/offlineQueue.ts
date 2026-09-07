
import { auth } from '@/lib/firebase';
import { assertAccountOwner } from '@/lib/accountIdentity';

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
    workoutDay?: string;
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
    /** Absent only on quarantined legacy entries. Never reassigned. */
    readonly ownerUid?: string;
    type: T;
    payload: OfflineMutationPayloads[T];
    createdAt: number;
    status: 'pending' | 'syncing' | 'synced' | 'failed' | 'quarantined';
    attempts: number;
    lastError?: string;
    claimId?: string;
    claimedAt?: number;
    leaseUntil?: number;
    nextAttemptAt?: number;
}

const STORAGE_KEY = 'FITSSAI_OFFLINE_QUEUE';
export const QUEUE_CHANGED_EVENT = 'fitssai:offline-queue-changed';
export const CLAIM_LEASE_MS = 60_000;
export const MAX_RETRY_DELAY_MS = 60_000;

export class QueueStorageError extends Error {
    constructor(public readonly operation: 'read' | 'write' | 'clear', public readonly originalError: unknown) {
        super(`Offline-Speicher nicht verfügbar (${operation}). Bitte erneut versuchen.`);
        this.name = 'QueueStorageError';
    }
}

export const loadQueue = (): OfflineMutationEntry[] => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed: OfflineMutationEntry[] = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) throw new Error('Invalid offline queue');
        let changed = false;
        const queue = parsed.filter(entry => entry && typeof entry === 'object').map(entry => {
            if (typeof entry.ownerUid === 'string' && entry.ownerUid.trim()) return entry;
            if (entry.status === 'quarantined') return entry;
            changed = true;
            return { ...entry, status: 'quarantined' as const,
                lastError: 'Missing original account ownership; this entry cannot be replayed.' };
        });
        if (changed) {
            console.warn('[OfflineQueue] Ownerless entries quarantined; no ownership was inferred.');
            saveQueue(queue);
        }
        return queue;
    } catch (error) {
        console.error('Failed to load offline queue:', error);
        throw error instanceof QueueStorageError ? error : new QueueStorageError('read', error);
    }
};

export const saveQueue = (queue: OfflineMutationEntry[]): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch (error) {
        console.error('Failed to save offline queue:', error);
        throw new QueueStorageError('write', error);
    }
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
};

export const enqueue = <T extends OfflineMutationType>(
    type: T,
    payload: OfflineMutationPayloads[T],
    expectedOwnerUid: string | null | undefined = auth.currentUser?.uid,
): { queue: OfflineMutationEntry[]; entry: OfflineMutationEntry<T> } => {
    const ownerUid = assertAccountOwner(expectedOwnerUid);
    const queue = loadQueue();
    const entry: OfflineMutationEntry<T> = {
        id: crypto.randomUUID(),
        ownerUid,
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
    patch: Partial<Pick<OfflineMutationEntry, 'status' | 'attempts' | 'lastError' | 'claimId' | 'claimedAt' | 'leaseUntil' | 'nextAttemptAt'>>
): OfflineMutationEntry[] => {
    const queue = loadQueue();
    const newQueue = queue.map((entry) =>
        entry.id === id ? { ...entry, ...patch, ownerUid: entry.ownerUid } : entry
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
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
        throw new QueueStorageError('clear', error);
    }
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
};

/** Missing timestamps on pre-lease syncing entries mean interrupted legacy work. */
export const isReplayEligible = (entry: OfflineMutationEntry, now = Date.now()): boolean => {
    if (!entry.ownerUid || entry.status === 'quarantined' || entry.status === 'synced') return false;
    if (entry.status === 'syncing') {
        return !entry.leaseUntil || entry.leaseUntil <= now || entry.leaseUntil > now + CLAIM_LEASE_MS;
    }
    return !entry.nextAttemptAt || entry.nextAttemptAt <= now || entry.nextAttemptAt > now + MAX_RETRY_DELAY_MS;
};

export const claimEntry = (id: string, ownerUid: string, now = Date.now()): OfflineMutationEntry | undefined => {
    assertAccountOwner(ownerUid);
    const entry = loadQueue().find(item => item.id === id);
    if (!entry || entry.ownerUid !== ownerUid || !isReplayEligible(entry, now)) return;
    const claimId = crypto.randomUUID();
    return updateEntry(id, {
        status: 'syncing', claimId, claimedAt: now, leaseUntil: now + CLAIM_LEASE_MS,
    }).find(item => item.id === id);
};

export class QueueClaimLostError extends Error {
    constructor() { super('Offline replay claim expired or was replaced.'); }
}

export const assertQueueClaim = (entry: OfflineMutationEntry): void => {
    assertAccountOwner(entry.ownerUid);
    const current = loadQueue().find(item => item.id === entry.id);
    if (!current || current.claimId !== entry.claimId || current.status !== 'syncing' ||
        !current.leaseUntil || current.leaseUntil <= Date.now()) throw new QueueClaimLostError();
};
