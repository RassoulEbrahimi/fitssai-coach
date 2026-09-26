
import { auth } from '@/lib/firebase';
import { assertAccountOwner } from '@/lib/accountIdentity';
import type { NutritionDate, NutritionEntryIntent } from '@shared/nutrition';

export type OfflineMutationType =
    | 'TOGGLE_DAY_COMPLETION' | 'TOGGLE_SET' | 'TOGGLE_DAY' | 'UPDATE_SET_PERFORMANCE' | 'NUTRITION_ENTRY_WRITE';

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

/**
 * Ticking one set complete or open. Completion only: no reps, no weight.
 *
 * Entries queued by an older build may still carry `repsCompleted`/`weightUsed`
 * copied from the plan's prescription. The handler ignores them, so a replay
 * never turns them into recorded performance.
 */
export interface ToggleSetPayload {
    workoutDay?: string;
    planId: string;
    weekKey: string;
    dayIndex: number;
    exerciseIndex: number;
    setNumber: number;
    completed: boolean;
}

/**
 * Recording what was actually performed in one set: reps and/or load in kg.
 *
 * Its own type rather than more fields on TOGGLE_SET. Completion and
 * performance are independent, and an entry of this type says nothing about
 * whether the set was ticked. Each value is optional: absent leaves the stored
 * value as it is, `null` clears it. The handler validates both and drops a
 * malformed entry rather than writing it.
 */
export interface UpdateSetPerformancePayload {
    workoutDay?: string;
    planId: string;
    weekKey: string;
    dayIndex: number;
    exerciseIndex: number;
    setNumber: number;
    reps?: number | null;
    weightKg?: number | null;
}

/**
 * One Nutrition V2 recorded-entry write (NUT-07).
 *
 * `intent` is the exact canonical intent the explicit action created — the
 * one the online transaction runs — never a copy of its fields. Its
 * `intentId` is the action's idempotency identity; the queue entry's own `id`
 * is only transport identity. `date` is the Berlin date the entry belongs to.
 * The replay handler validates the whole payload against the shared schemas
 * and quarantines a malformed one rather than writing or retrying it.
 */
export interface NutritionEntryWritePayload {
    intent: NutritionEntryIntent;
    date: NutritionDate;
}

export type OfflineMutationPayloads = {
    TOGGLE_DAY_COMPLETION: ToggleDayCompletionPayload;
    TOGGLE_SET: ToggleSetPayload;
    TOGGLE_DAY: ToggleDayPayload;
    UPDATE_SET_PERFORMANCE: UpdateSetPerformancePayload;
    NUTRITION_ENTRY_WRITE: NutritionEntryWritePayload;
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

/**
 * Why replay set an entry aside for good. Stored on the quarantined entry so
 * the owner can be shown what happened; the entry itself is kept.
 */
export interface OfflineEntryRejection {
    /** Stable, machine-readable reason, e.g. `staleRevision` or `invalidPayload`. */
    code: string;
    /** Safe to show; never a raw server error. */
    message: string;
    /** JSON-serializable facts about the rejection, for the owning feature's UI. */
    details?: Record<string, string | number | boolean | null>;
}

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
    /**
     * The earlier entry this one was derived from: its payload assumes that
     * entry applies first. If that entry is rejected, this one is rejected with
     * it instead of being written against a state it never saw. Set only at
     * enqueue, never reassigned. Training entries never carry it.
     */
    readonly dependsOn?: string;
    /** Set only on an entry quarantined by a terminal replay rejection. */
    rejection?: OfflineEntryRejection;
}

const STORAGE_KEY = 'FITSSAI_OFFLINE_QUEUE';
export const QUEUE_CHANGED_EVENT = 'fitssai:offline-queue-changed';
/** Fired once a replayed entry's write was accepted and the entry removed. `detail` is the entry. */
export const OFFLINE_ENTRY_REPLAYED_EVENT = 'fitssai:offline-entry-replayed';

export const notifyEntryReplayed = (entry: OfflineMutationEntry): void => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(OFFLINE_ENTRY_REPLAYED_EVENT, { detail: entry }));
};

/**
 * The persisted queue exactly as stored - no parsing, repair or quarantine -
 * so it can be read during render without writing anything.
 */
export const peekQueueStorage = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
};
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
    options: { dependsOn?: string | null } = {},
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
        ...(options.dependsOn ? { dependsOn: options.dependsOn } : {}),
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
    patch: Partial<Pick<OfflineMutationEntry, 'status' | 'attempts' | 'lastError' | 'claimId' | 'claimedAt' | 'leaseUntil' | 'nextAttemptAt' | 'rejection'>>
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

/**
 * A handler's verdict that its entry can never be applied as queued: a
 * semantic conflict, or a payload that cannot be trusted. Replay quarantines
 * the entry (kept, with `rejection`), refetches `invalidate`, and moves on to
 * the next entry. It is never retried with backoff.
 *
 * Only for outcomes that are the same on every attempt. A transient failure
 * must stay an ordinary error so the existing retry applies. The Training
 * handlers never throw this.
 */
export class ReplayRejectedError extends Error {
    readonly code: string;
    readonly invalidate: readonly (readonly unknown[])[];
    readonly details?: OfflineEntryRejection['details'];

    constructor({ code, message, invalidate = [], details }: {
        code: string;
        message: string;
        invalidate?: readonly (readonly unknown[])[];
        details?: OfflineEntryRejection['details'];
    }) {
        super(message);
        this.name = 'ReplayRejectedError';
        this.code = code;
        this.invalidate = invalidate;
        this.details = details;
    }

    get rejection(): OfflineEntryRejection {
        return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
    }
}

/** The rejection given to an entry whose `dependsOn` entry was rejected. */
export const DEPENDENCY_REJECTED_CODE = 'dependencyRejected';

const dependencyRejection = (dependsOn: string): OfflineEntryRejection => ({
    code: DEPENDENCY_REJECTED_CODE,
    message: 'Eine frühere Änderung, auf der diese aufbaut, wurde nicht übernommen.',
    details: { dependsOn },
});

const quarantined = (entry: OfflineMutationEntry, rejection: OfflineEntryRejection): OfflineMutationEntry => ({
    ...entry,
    ownerUid: entry.ownerUid,
    status: 'quarantined',
    rejection,
    lastError: rejection.message,
    // Not a failure: no retry schedule, and nobody holds it any more.
    claimId: undefined,
    claimedAt: undefined,
    leaseUntil: undefined,
    nextAttemptAt: undefined,
});

/**
 * Quarantine the claimed `entry` with `rejection`, and with it every later
 * entry of the same owner that depends on it, directly or through another
 * dependent. One write. Attempts are left as they were: a rejection is not a
 * failed attempt.
 *
 * Returns the ids quarantined as dependents.
 */
export const quarantineRejectedEntry = (entry: OfflineMutationEntry, rejection: OfflineEntryRejection): string[] => {
    assertAccountOwner(entry.ownerUid);
    const queue = loadQueue();
    const current = queue.find(item => item.id === entry.id);
    if (!current || current.claimId !== entry.claimId || current.status !== 'syncing') throw new QueueClaimLostError();
    const rejected = new Set([entry.id]);
    const dependents: string[] = [];
    const next = queue.map(item => {
        if (item.id === entry.id) return quarantined(item, rejection);
        if (item.ownerUid !== entry.ownerUid || !item.dependsOn || !rejected.has(item.dependsOn)) return item;
        if (item.status === 'quarantined' || item.status === 'synced') return item;
        rejected.add(item.id);
        dependents.push(item.id);
        return quarantined(item, dependencyRejection(item.dependsOn));
    });
    saveQueue(next);
    return dependents;
};

/**
 * Whether `entry` depends on an entry that is quarantined now. Such an entry
 * is never replayed: it assumes a change that did not happen.
 */
export const hasRejectedDependency = (entry: OfflineMutationEntry, queue: OfflineMutationEntry[]): boolean =>
    !!entry.dependsOn &&
    queue.some(item => item.id === entry.dependsOn && item.ownerUid === entry.ownerUid && item.status === 'quarantined');

/** Quarantine an unclaimed `entry` whose dependency was rejected. */
export const quarantineDependentEntry = (entry: OfflineMutationEntry): void => {
    assertAccountOwner(entry.ownerUid);
    if (!entry.dependsOn) return;
    const rejection = dependencyRejection(entry.dependsOn);
    saveQueue(loadQueue().map(item =>
        item.id === entry.id && item.status !== 'quarantined' ? quarantined(item, rejection) : item));
};

/**
 * Remove quarantined entries of `ownerUid`, locally only. Entries of another
 * account, entries that are not quarantined and unknown ids are left alone.
 * Returns how many were removed.
 */
export const removeQuarantinedEntries = (ids: readonly string[], ownerUid: string): number => {
    assertAccountOwner(ownerUid);
    const wanted = new Set(ids);
    const queue = loadQueue();
    const next = queue.filter(entry =>
        !(wanted.has(entry.id) && entry.ownerUid === ownerUid && entry.status === 'quarantined'));
    if (next.length !== queue.length) saveQueue(next);
    return queue.length - next.length;
};
