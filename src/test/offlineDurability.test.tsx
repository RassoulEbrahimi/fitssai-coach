import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';

const identity = vi.hoisted(() => ({ currentUser: { uid: 'A' } as { uid: string } | null }));
vi.mock('@/lib/firebase', () => ({ auth: identity, db: {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: identity.currentUser }) }));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({ toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn() }));

import { useSupabaseAction } from '@/hooks/useSupabaseAction';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { useSetTracking } from '@/hooks/useSetTracking';
import { useWeekCompletion } from '@/hooks/useWeekCompletion';
import { queryKeys } from '@/lib/queryKeys';
import { toastOffline, toastError, toastWithIcon } from '@/lib/toastWithIcon';
import { claimEntry, CLAIM_LEASE_MS, enqueue, loadQueue, QueueStorageError, updateEntry } from '@/lib/offlineQueue';
import { flushOfflineQueue } from '@/lib/offlineReplay';
import { rows, writes, firestore, resetWorkoutFirestore } from '@/test/mocks/workoutFirestore';

const DAY = { planId: 'p', weekKey: 'Week 1', dayIndex: 0, workoutDay: '2026-09-07', completed: true };
const SET = { ...DAY, exerciseIndex: 0, setNumber: 1 };
const STORAGE = 'FITSSAI_OFFLINE_QUEUE';
const createParentLog = firestore.runTransaction.getMockImplementation()!;
let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const flush = () => flushOfflineQueue('A', vi.fn());
const online = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  onlineManager.setOnline(value);
};
const breakWrites = () => vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  localStorage.clear();
  identity.currentUser = { uid: 'A' };
  online(false);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); online(true); client.clear(); });

describe('durable mutation entry through the production TanStack hook', () => {
  it('executes offline instead of pausing, persists before success, reloads and reconnects', async () => {
    const action = vi.fn();
    const success = vi.fn(() => expect(loadQueue()).toHaveLength(1));
    const view = renderHook(() => useSupabaseAction({ action, offlineActionType: 'TOGGLE_DAY', onSuccess: success }), { wrapper });
    await act(async () => { await view.result.current.mutateAsync(DAY as never); });
    // Discriminating: under TanStack's default networkMode the mutation never
    // enters application code offline, so it never reaches success and nothing
    // is ever enqueued. isPaused alone reads false in both worlds.
    expect(view.result.current.status).toBe('success');
    expect(view.result.current.isPaused).toBe(false);
    expect(success).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
    expect(toastOffline).toHaveBeenCalledOnce();
    view.unmount();
    client = new QueryClient();
    const restored = renderHook(() => useOfflineQueue(), { wrapper });
    expect(restored.result.current.pendingCount).toBe(1);
    await act(async () => { online(true); window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(loadQueue()).toEqual([]));
    expect(rows.size).toBe(1);
    expect(toastWithIcon).toHaveBeenCalledWith(expect.objectContaining({ title: 'Synchronisiert' }));
  });

  it('rejects enqueue storage failure without queued success or success toast', async () => {
    const success = vi.fn();
    const failed = vi.fn();
    const { result } = renderHook(() => useSupabaseAction({ action: vi.fn(), offlineActionType: 'TOGGLE_DAY', onSuccess: success, onError: failed }), { wrapper });
    const storage = breakWrites();
    await act(async () => { await expect(result.current.mutateAsync(DAY as never)).rejects.toBeInstanceOf(QueueStorageError); });
    storage.mockRestore();
    expect(loadQueue()).toEqual([]);
    expect(success).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    expect(toastOffline).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Nicht offline gespeichert', expect.any(String), 4000);
  });

  it('rolls back a nested set edit while offline without mutating its saved snapshot', async () => {
    const key = queryKeys.sets.byDay('p', 'Week 1', 0);
    const before = { 0: { 2: { id: 'existing' } } };
    client.setQueryData(key, before);
    const { result } = renderHook(() => useSetTracking('p', 'Week 1', 0), { wrapper });
    const storage = breakWrites();
    await act(async () => { await expect(result.current.toggleSetAsync(SET)).rejects.toBeInstanceOf(QueueStorageError); });
    storage.mockRestore();
    expect(client.getQueryData(key)).toEqual(before);
    expect(before).toEqual({ 0: { 2: { id: 'existing' } } });
  });

  it('rolls back exercise completion while offline', async () => {
    const key = queryKeys.completion.byWeek('p', 'Week 1');
    client.setQueryData(key, {});
    const { result } = renderHook(() => useWeekCompletion({ planId: 'p', weekKey: 'Week 1' }), { wrapper });
    const storage = breakWrites();
    act(() => result.current.toggleExercise(SET));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    storage.mockRestore();
    expect(client.getQueryData(key)).toEqual({});
  });

  it('contains read errors at the hook boundary and refuses to overwrite unreadable work', () => {
    localStorage.setItem(STORAGE, '{broken');
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    expect(result.current.storageError).toBeTruthy();
    expect(() => enqueue('TOGGLE_DAY', DAY)).toThrow(QueueStorageError);
    expect(localStorage.getItem(STORAGE)).toBe('{broken');
  });
});

describe('claims, interruptions, storage transitions and ordering', () => {
  it('recovers a persisted claim only at its bounded expiry after restart', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { entry } = enqueue('TOGGLE_DAY', DAY);
    claimEntry(entry.id, 'A');
    await flush();
    expect(writes).toEqual([]);
    now += CLAIM_LEASE_MS - 1;
    await flush();
    expect(writes).toEqual([]);
    now++;
    expect((await flush()).completed).toBe(1);
    expect(loadQueue()).toEqual([]);
  });

  it('recovers pre-lease syncing entries and caps recovery after a backwards clock jump', async () => {
    const { entry } = enqueue('TOGGLE_DAY', DAY);
    updateEntry(entry.id, { status: 'syncing' });
    expect((await flush()).completed).toBe(1);
    const second = enqueue('TOGGLE_DAY', DAY).entry;
    updateEntry(second.id, { status: 'syncing', leaseUntil: Date.now() + CLAIM_LEASE_MS * 2 });
    expect((await flush()).completed).toBe(1);
    expect(rows.size).toBe(1);
  });

  it('two hook instances and simultaneous flush triggers execute once', async () => {
    enqueue('TOGGLE_DAY', DAY);
    const a = renderHook(() => useOfflineQueue(), { wrapper });
    const b = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => { await Promise.all([a.result.current.flush(), b.result.current.flush(), a.result.current.flush()]); });
    expect(writes).toHaveLength(1);
    expect(a.result.current.pendingCount).toBe(0);
    expect(b.result.current.pendingCount).toBe(0);
  });

  it('an already-online restored worker automatically revisits a stale claim', async () => {
    vi.useFakeTimers();
    const { entry } = enqueue('TOGGLE_DAY', DAY);
    claimEntry(entry.id, 'A');
    online(true);
    renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(CLAIM_LEASE_MS - 1); });
    expect(writes).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
    expect(rows.size).toBe(1);
    expect(loadQueue()).toEqual([]);
  });

  it('a failed claim persistence performs no remote work and releases the mutex', async () => {
    enqueue('TOGGLE_DAY', DAY);
    const storage = breakWrites();
    expect((await flush()).storageError).toBeInstanceOf(QueueStorageError);
    expect(writes).toEqual([]);
    storage.mockRestore();
    expect(loadQueue()[0].status).toBe('pending');
    expect((await flush()).completed).toBe(1);
  });

  it('a retry-state write failure retains the durable claim for recovery', async () => {
    enqueue('TOGGLE_DAY', DAY);
    let storage: ReturnType<typeof breakWrites>;
    firestore.getDocs.mockImplementationOnce(async () => {
      storage = breakWrites();
      throw new Error('Failed to fetch');
    });
    expect((await flush()).storageError).toBeInstanceOf(QueueStorageError);
    storage!.mockRestore();
    expect(loadQueue()[0]).toMatchObject({ status: 'syncing', attempts: 0 });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + CLAIM_LEASE_MS);
    expect((await flush()).completed).toBe(1);
  });

  it('bounds attempt metadata and delay, retains work, and never overtakes a failed edit', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    enqueue('TOGGLE_DAY', DAY);
    enqueue('TOGGLE_DAY', { ...DAY, completed: false });
    for (let attempt = 1; attempt <= 12; attempt++) {
      firestore.getDocs.mockRejectedValueOnce(new Error('Failed to fetch'));
      expect((await flush()).failed).toBe(1);
      const entry = loadQueue()[0];
      expect(entry.attempts).toBe(Math.min(attempt, 10));
      expect(entry.nextAttemptAt! - now).toBeLessThanOrEqual(60_000);
      expect((await flush()).completed).toBe(0);
      now = entry.nextAttemptAt!;
    }
    expect(writes).toEqual([]);
    expect((await flush()).completed).toBe(2);
    expect([...rows.values()][0].completed).toBe(false);
  });

  it('stops after lease expiry during a read, before a subsequent remote write', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    enqueue('TOGGLE_SET', SET);
    firestore.getDocs.mockImplementationOnce(async () => {
      now += CLAIM_LEASE_MS;
      return { docs: [], empty: true };
    });
    await flush();
    expect(writes).toEqual([]);
    expect((await flush()).completed).toBe(1);
    expect(rows.size).toBe(2);
  });

  it.each([
    ['TOGGLE_SET', true], ['TOGGLE_SET', false],
    ['TOGGLE_DAY_COMPLETION', true], ['TOGGLE_DAY_COMPLETION', false],
    ['TOGGLE_DAY', true], ['TOGGLE_DAY', false],
  ] as const)(
    '%s completed=%s converges after remote success but failed local removal', async (type, completed) => {
      if (!completed) {
        enqueue(type, type === 'TOGGLE_DAY' ? DAY : SET);
        await flush();
      }
      enqueue(type, { ...(type === 'TOGGLE_DAY' ? DAY : SET), completed });
      const originalSet = Storage.prototype.setItem;
      const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (key === STORAGE && value === '[]') throw new Error('Crash before cleanup');
        return originalSet.call(this, key, value);
      });
      const first = await flush();
      expect(first.completed).toBe(0);
      expect(first.storageError).toBeInstanceOf(QueueStorageError);
      const paths = [...rows.keys()];
      expect(paths).toHaveLength(type === 'TOGGLE_SET' && completed ? 2 : 1);
      expect(loadQueue()[0].status).toBe('syncing');
      storage.mockRestore();
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + CLAIM_LEASE_MS);
      expect((await flush()).completed).toBe(1);
      expect([...rows.keys()]).toEqual(paths);
      expect(loadQueue()).toEqual([]);
      if (type === 'TOGGLE_SET') {
        expect([...rows.values()].some(row => row.setNumber === 1)).toBe(completed);
      } else {
        expect([...rows.values()][0].completed).toBe(completed);
      }
    });

  it('recovers a crash between parent-log and set writes without duplicating the parent', async () => {
    enqueue('TOGGLE_SET', SET);
    // Interrupted after the parent log is committed and before the set write.
    firestore.runTransaction.mockImplementationOnce(async (db, callback) => {
      await createParentLog(db, callback);
      identity.currentUser = { uid: 'B' };
    });
    const interrupted = await flush();
    expect(interrupted.storageError).toBeUndefined();
    expect(loadQueue()[0].lastError).toBeUndefined();
    expect(rows.size).toBe(1);
    expect(writes).toHaveLength(1);
    identity.currentUser = { uid: 'A' };
    expect((await flush()).completed).toBe(1);
    expect(rows.size).toBe(2);
  });

  it('quarantines ownerless entries, skips A under B, and resumes only when A returns', async () => {
    const { entry } = enqueue('TOGGLE_DAY', DAY);
    localStorage.setItem(STORAGE, JSON.stringify([{ ...entry, id: 'legacy', ownerUid: undefined }, entry]));
    identity.currentUser = { uid: 'B' };
    await flushOfflineQueue('B', vi.fn());
    expect(writes).toEqual([]);
    expect(loadQueue()[0].status).toBe('quarantined');
    identity.currentUser = { uid: 'A' };
    expect((await flush()).completed).toBe(1);
    expect(loadQueue()).toHaveLength(1);
    expect(loadQueue()[0].ownerUid).toBeUndefined();
  });

  it('reuses a pre-existing auto-ID parent log rather than adding a stable-ID duplicate', async () => {
    // Real users already hold auto-ID exercise logs. Replay must land on them.
    rows.set('users/A/workout_logs/auto-legacy',
      { planId: 'p', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 0, completed: false });
    enqueue('TOGGLE_SET', SET);
    expect((await flush()).completed).toBe(1);
    expect([...rows.keys()]).toEqual([
      'users/A/workout_logs/auto-legacy',
      'users/A/workout_logs/auto-legacy/workout_set_logs/set_1',
    ]);
  });

  it('updates a pre-existing auto-ID exercise log rather than adding a second one', async () => {
    rows.set('users/A/workout_logs/auto-legacy',
      { planId: 'p', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 0, completed: false });
    enqueue('TOGGLE_DAY_COMPLETION', { ...SET, completed: true });
    expect((await flush()).completed).toBe(1);
    expect([...rows.keys()]).toEqual(['users/A/workout_logs/auto-legacy']);
    expect(rows.get('users/A/workout_logs/auto-legacy')!.completed).toBe(true);
  });

  it('holds a later entry of a different type behind an unresolved older one', async () => {
    enqueue('TOGGLE_SET', SET);
    enqueue('TOGGLE_DAY', DAY);
    firestore.getDocs.mockRejectedValueOnce(new Error('Failed to fetch'));
    expect((await flush()).failed).toBe(1);
    expect(writes).toEqual([]);
    // Same instant, backoff still pending: the day toggle must not run ahead.
    expect((await flush()).completed).toBe(0);
    expect(writes).toEqual([]);
    expect(loadQueue()).toHaveLength(2);
  });

  it('writes the set document once when the same operation is delivered twice', async () => {
    enqueue('TOGGLE_SET', SET);
    await flush();
    const paths = [...rows.keys()];
    enqueue('TOGGLE_SET', SET);
    expect((await flush()).completed).toBe(1);
    expect([...rows.keys()]).toEqual(paths);
  });
  it('creates one parent log when the lookup misses a parent that already exists', async () => {
    // Two workers racing after a lease expiry, or a lookup that has not caught
    // up, both see "no parent". A generated ID would leave two parent logs and
    // split the sets across them; the position-derived ID cannot.
    enqueue('TOGGLE_SET', SET);
    await flush();
    const paths = [...rows.keys()];
    expect(paths).toHaveLength(2);
    enqueue('TOGGLE_SET', { ...SET, setNumber: 2 });
    firestore.getDocs.mockImplementationOnce(async () => ({ docs: [], empty: true }));
    expect((await flush()).completed).toBe(1);
    expect([...rows.keys()]).toEqual([...paths, `${paths[0]}/workout_set_logs/set_2`]);
  });
});

/*
  A deterministic ID means two replays address the same document. That is the
  point, and it is also the hazard: if the lookup that decides "create" or
  "update" reports empty while the document exists, a create must not become a
  silent replace. The lookup can report empty for real — the Firestore SDK
  serves `getDocs` from a cold in-memory cache when it considers itself
  offline, which is exactly the state a reconnecting replay runs in.

  Every parent address below comes from a real replay rather than a repeated
  copy of `replayLogId`, so these tests cannot agree with a wrong ID.
*/
describe('a lookup that misses an existing deterministic parent', () => {
  const EXISTING = {
    workoutDay: '2026-09-07', completed: true, completedAt: 'ts-completed',
    durationMinutes: 45, caloriesBurned: 320, createdAt: 'ts-created', notes: 'felt strong',
  };
  const EXERCISE = { planId: 'p', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 0 };

  /** The deterministic parent, at the address production actually derives. */
  const seedParent = async (fields: Record<string, unknown>) => {
    enqueue('TOGGLE_DAY_COMPLETION', { ...EXERCISE, completed: true });
    expect((await flush()).completed).toBe(1);
    const path = [...rows.keys()][0];
    rows.set(path, { ...rows.get(path), ...EXISTING, ...fields });
    writes.length = 0;
    return path;
  };
  const staleEmptyLookup = () => firestore.getDocs.mockImplementationOnce(async () => ({ docs: [], empty: true }));

  it('TOGGLE_SET leaves the existing parent exactly as it was and still writes its set', async () => {
    const parent = await seedParent({});
    const before = { ...rows.get(parent)! };
    // No workoutDay in the payload: an older queue entry must not be able to
    // strip the date the document already carries.
    enqueue('TOGGLE_SET', { ...SET, workoutDay: undefined });
    staleEmptyLookup();
    expect((await flush()).completed).toBe(1);
    expect([...rows.keys()]).toEqual([parent, `${parent}/workout_set_logs/set_1`]);
    expect(rows.get(parent)).toEqual(before);
    expect(rows.get(`${parent}/workout_set_logs/set_1`)).toMatchObject({ setNumber: 1, performanceSource: 'completion-only' });
    expect(rows.get(`${parent}/workout_set_logs/set_1`)).not.toHaveProperty('repsCompleted');
  });

  it('TOGGLE_DAY_COMPLETION completion changes only completion, keeping unrelated fields', async () => {
    const parent = await seedParent({ completed: false, completedAt: null });
    enqueue('TOGGLE_DAY_COMPLETION', { ...EXERCISE, completed: true });
    staleEmptyLookup();
    expect((await flush()).completed).toBe(1);
    expect([...rows.keys()]).toEqual([parent]);
    const row = rows.get(parent)!;
    expect(row.completed).toBe(true);
    expect(row.completedAt).toBeTruthy();
    // Absent optional payload values are absent, not an instruction to clear.
    expect(row).toMatchObject({
      durationMinutes: 45, caloriesBurned: 320, workoutDay: '2026-09-07',
      createdAt: 'ts-created', notes: 'felt strong',
    });
  });

  it('TOGGLE_DAY_COMPLETION uncompletion clears completion only', async () => {
    const parent = await seedParent({});
    enqueue('TOGGLE_DAY_COMPLETION', { ...EXERCISE, completed: false });
    staleEmptyLookup();
    expect((await flush()).completed).toBe(1);
    expect([...rows.keys()]).toEqual([parent]);
    expect(rows.get(parent)).toMatchObject({
      completed: false, completedAt: null,
      durationMinutes: 45, caloriesBurned: 320, workoutDay: '2026-09-07',
      createdAt: 'ts-created', notes: 'felt strong',
    });
  });

  it('TOGGLE_DAY_COMPLETION applies duration and calories the payload does carry', async () => {
    const parent = await seedParent({});
    enqueue('TOGGLE_DAY_COMPLETION', { ...EXERCISE, completed: true, durationMinutes: 12, caloriesBurned: 90 });
    staleEmptyLookup();
    expect((await flush()).completed).toBe(1);
    expect(rows.get(parent)).toMatchObject({ durationMinutes: 12, caloriesBurned: 90, notes: 'felt strong' });
  });

  it('survives a stale-empty lookup on the replay that recovers a failed cleanup', async () => {
    // The compound case: the remote write landed, the local cleanup failed,
    // and the recovery replay is itself the one reading from a cold cache.
    const parent = await seedParent({});
    const before = { ...rows.get(parent)! };
    enqueue('TOGGLE_SET', { ...SET, workoutDay: undefined });
    const originalSet = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === STORAGE && value === '[]') throw new Error('Crash before cleanup');
      return originalSet.call(this, key, value);
    });
    staleEmptyLookup();
    expect((await flush()).storageError).toBeInstanceOf(QueueStorageError);
    storage.mockRestore();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + CLAIM_LEASE_MS);
    staleEmptyLookup();
    expect((await flush()).completed).toBe(1);
    expect([...rows.keys()]).toEqual([parent, `${parent}/workout_set_logs/set_1`]);
    expect(rows.get(parent)).toEqual(before);
    expect(loadQueue()).toEqual([]);
  });

  it('still creates the exercise log when the parent genuinely does not exist', async () => {
    enqueue('TOGGLE_DAY_COMPLETION', { ...EXERCISE, completed: true, durationMinutes: 12 });
    expect((await flush()).completed).toBe(1);
    expect([...rows.keys()]).toHaveLength(1);
    expect([...rows.values()][0]).toMatchObject({
      ...EXERCISE, completed: true, durationMinutes: 12, caloriesBurned: null,
    });
  });
});
