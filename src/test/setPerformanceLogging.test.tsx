import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';

/*
  TRAINING-EXEC-02A: what a user records as performed, through the production
  set hook, shared writer, offline queue and replay, against the in-memory
  Firestore boundary. Completion, prescription and performance must stay
  three separate things at every step.
*/

const identity = vi.hoisted(() => ({ currentUser: { uid: 'A' } as { uid: string } | null }));
vi.mock('@/lib/firebase', () => ({ auth: identity, db: {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: identity.currentUser }) }));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({ toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn() }));

import { useSetTracking } from '@/hooks/useSetTracking';
import { enqueue, loadQueue, type UpdateSetPerformancePayload } from '@/lib/offlineQueue';
import { flushOfflineQueue } from '@/lib/offlineReplay';
import { queryKeys } from '@/lib/queryKeys';
import { resetSetWriteIntentsForTests } from '@/lib/setWriteIntents';
import { control, firestore, rows, resetWorkoutFirestore, writes } from '@/test/mocks/workoutFirestore';

const POSITION = { planId: 'p', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 0, workoutDay: '2026-09-07' };
const SET1 = { ...POSITION, setNumber: 1 };
const SET2 = { ...POSITION, setNumber: 2 };
const KEY = queryKeys.sets.byDay('p', 'Week 1', 0);
const LOGS = 'users/A/workout_logs';
const recorded = (reps: number | null, weightKg: number | null) => ({ source: 'user-recorded', reps, weightKg });

let client: QueryClient;
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const wrapper = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const online = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  onlineManager.setOnline(value);
};

const setDocs = () => [...rows.entries()].filter(([path]) => path.includes('/workout_set_logs/'));
const setDoc = (setNumber = 1) => setDocs().find(([, data]) => data.setNumber === setNumber)?.[1];
const parents = () => [...rows.keys()].filter((path) => path.startsWith(`${LOGS}/`) && path.split('/').length === 4);

const mount = () => renderHook(() => useSetTracking('p', 'Week 1', 0), { wrapper });
type Hook = ReturnType<typeof mount>;
const loaded = async (hook: Hook) => waitFor(() => expect(hook.result.current.isLoadingSets).toBe(false));
const flush = () => flushOfflineQueue('A', vi.fn());

/** Seeds one exercise parent with set documents exactly as stored. */
const seed = (sets: Record<string, Record<string, unknown>>) => {
  rows.set(`${LOGS}/log`, { ...POSITION, completed: false });
  Object.entries(sets).forEach(([id, data]) => rows.set(`${LOGS}/log/workout_set_logs/${id}`, data));
};

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  localStorage.clear();
  resetSetWriteIntentsForTests();
  identity.currentUser = { uid: 'A' };
  online(true);
  client = freshClient();
});
afterEach(() => { vi.restoreAllMocks(); online(true); client.clear(); });

describe('recording actual performance', () => {
  it('persists reps without completing the set, and a reload restores them on an open set', async () => {
    const hook = mount();
    await loaded(hook);

    await act(async () => { await hook.result.current.updateSetPerformanceAsync({ ...SET1, reps: 12 }); });

    expect(setDocs()).toHaveLength(1);
    expect(setDoc()).toEqual({ setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 12 });
    expect(hook.result.current.isSetCompleted(0, 1)).toBe(false);
    expect(hook.result.current.getCompletedSetsCount(0)).toBe(0);
    expect(hook.result.current.getActualPerformance(0, 1)).toEqual(recorded(12, null));

    hook.unmount();
    resetSetWriteIntentsForTests();
    client = freshClient();
    const reloaded = mount();

    await waitFor(() => expect(reloaded.result.current.getActualPerformance(0, 1)).toEqual(recorded(12, null)));
    expect(reloaded.result.current.isSetCompleted(0, 1)).toBe(false);
    expect(reloaded.result.current.getCompletedSetsCount(0)).toBe(0);
  });

  it('persists a decimal weight as a number of kilograms, and a weight alone is valid', async () => {
    const hook = mount();
    await loaded(hook);

    await act(async () => { await hook.result.current.updateSetPerformanceAsync({ ...SET1, weightKg: 52.5 }); });

    expect(setDoc()).toEqual({ setNumber: 1, completed: false, performanceSource: 'user-recorded', weightUsed: 52.5 });
    expect(typeof setDoc()?.weightUsed).toBe('number');
    expect(hook.result.current.getActualPerformance(0, 1)).toEqual(recorded(null, 52.5));
  });

  it('refuses malformed values before anything is written or shown', async () => {
    const hook = mount();
    await loaded(hook);

    for (const values of [{ reps: -1 }, { weightKg: 0 }, { weightKg: Number.NaN }, {}]) {
      await act(async () => {
        await expect(hook.result.current.updateSetPerformanceAsync({ ...SET1, ...values })).rejects.toThrow();
      });
    }

    expect(writes).toEqual([]);
    expect(loadQueue()).toEqual([]);
    expect(hook.result.current.getActualPerformance(0, 1)).toBeUndefined();
  });

  it('completing copies nothing and keeps recorded values; un-ticking keeps them too', async () => {
    const hook = mount();
    await loaded(hook);

    await act(async () => { await hook.result.current.updateSetPerformanceAsync({ ...SET1, reps: 10, weightKg: 52.5 }); });
    await act(async () => { await hook.result.current.toggleSetAsync({ ...SET1, completed: true }); });

    expect(setDoc()).toEqual({
      setNumber: 1, completed: true, completedAt: expect.anything(),
      performanceSource: 'user-recorded', repsCompleted: 10, weightUsed: 52.5,
    });
    expect(hook.result.current.isSetCompleted(0, 1)).toBe(true);
    expect(hook.result.current.getActualPerformance(0, 1)).toEqual(recorded(10, 52.5));

    await act(async () => { await hook.result.current.toggleSetAsync({ ...SET1, completed: false }); });

    expect(setDoc()).toEqual({ setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 10, weightUsed: 52.5 });
    expect(hook.result.current.isSetCompleted(0, 1)).toBe(false);
    expect(hook.result.current.getActualPerformance(0, 1)).toEqual(recorded(10, 52.5));

    // A set ticked with nothing recorded gains no numbers from anywhere.
    await act(async () => { await hook.result.current.toggleSetAsync({ ...SET2, completed: true }); });
    expect(setDoc(2)).toEqual({ setNumber: 2, completed: true, completedAt: expect.anything(), performanceSource: 'completion-only' });
    expect(hook.result.current.getActualPerformance(0, 2)).toEqual({ source: 'completion-only', reps: null, weightKg: null });
  });

  it('clearing values keeps a completed set completed, and removes an open set with nothing left', async () => {
    const hook = mount();
    await loaded(hook);

    await act(async () => {
      await hook.result.current.updateSetPerformanceAsync({ ...SET1, reps: 10 });
      await hook.result.current.toggleSetAsync({ ...SET1, completed: true });
      await hook.result.current.updateSetPerformanceAsync({ ...SET1, reps: null, weightKg: null });
    });

    expect(setDoc()).toEqual({ setNumber: 1, completed: true, completedAt: expect.anything(), performanceSource: 'completion-only' });
    expect(hook.result.current.isSetCompleted(0, 1)).toBe(true);
    expect(hook.result.current.getActualPerformance(0, 1)).toEqual({ source: 'completion-only', reps: null, weightKg: null });

    await act(async () => {
      await hook.result.current.updateSetPerformanceAsync({ ...SET2, weightKg: 40 });
      await hook.result.current.updateSetPerformanceAsync({ ...SET2, weightKg: null });
    });

    expect(setDoc(2)).toBeUndefined();
    expect(hook.result.current.getActualPerformance(0, 2)).toBeUndefined();
    expect(hook.result.current.isSetCompleted(0, 2)).toBe(false);
  });

  it('reads older documents as completed and trusts reps and weight only behind an explicit marker', async () => {
    seed({
      legacy: { setNumber: 1, repsCompleted: 10, weightUsed: 60, completedAt: new firestore.Timestamp(1) },
      ticked: { setNumber: 2, performanceSource: 'completion-only' },
      recorded: { setNumber: 3, completed: true, performanceSource: 'user-recorded', repsCompleted: 9, weightUsed: 62.5 },
      open: { setNumber: 4, completed: false, performanceSource: 'user-recorded', repsCompleted: 6 },
    });
    const before = structuredClone([...rows.entries()]);
    const hook = mount();

    await waitFor(() => expect(hook.result.current.getCompletedSetsCount(0)).toBe(3));
    const current = hook.result.current;
    expect([1, 2, 3, 4].map((setNumber) => current.isSetCompleted(0, setNumber))).toEqual([true, true, true, false]);
    expect(current.getActualPerformance(0, 1)).toEqual({ source: 'unverified', reps: null, weightKg: null });
    expect(current.getActualPerformance(0, 2)).toEqual({ source: 'completion-only', reps: null, weightKg: null });
    expect(current.getActualPerformance(0, 3)).toEqual(recorded(9, 62.5));
    expect(current.getActualPerformance(0, 4)).toEqual(recorded(6, null));
    // Read only: nothing is migrated.
    expect([...rows.entries()]).toEqual(before);
    expect(writes).toEqual([]);
  });
});

describe('rapid edits', () => {
  it('a newer value requested while an older write is still running wins, on screen and on the server', async () => {
    const hook = mount();
    await loaded(hook);
    let release: (() => void) | undefined;
    control.beforeCommit = () => new Promise<void>((resolve) => { release = resolve; });

    let pending: Promise<unknown>[] = [];
    act(() => {
      pending = [
        hook.result.current.updateSetPerformanceAsync({ ...SET1, reps: 10 }),
        hook.result.current.updateSetPerformanceAsync({ ...SET1, reps: 12 }),
      ];
    });
    await waitFor(() => expect(release).toBeDefined());

    expect(hook.result.current.getActualPerformance(0, 1)?.reps).toBe(12);

    control.beforeCommit = undefined;
    await act(async () => { release!(); await Promise.all(pending); });

    expect(setDoc()?.repsCompleted).toBe(12);
    await waitFor(() => expect(hook.result.current.getActualPerformance(0, 1)?.reps).toBe(12));
    expect(parents()).toHaveLength(1);
    expect(setDocs()).toHaveLength(1);
  });

  it.each(['performance first', 'completion first'])('recorded values and a tick made together both land (%s)', async (order) => {
    const hook = mount();
    await loaded(hook);

    let pending: Promise<unknown>[] = [];
    act(() => {
      const record = () => hook.result.current.updateSetPerformanceAsync({ ...SET1, weightKg: 52.5 });
      const tick = () => hook.result.current.toggleSetAsync({ ...SET1, completed: true });
      pending = order === 'performance first' ? [record(), tick()] : [tick(), record()];
    });

    // Both show before either write has finished.
    expect(hook.result.current.isSetCompleted(0, 1)).toBe(true);
    expect(hook.result.current.getActualPerformance(0, 1)).toEqual(recorded(null, 52.5));

    await act(async () => { await Promise.all(pending); });

    expect(setDoc()).toEqual({
      setNumber: 1, completed: true, completedAt: expect.anything(), performanceSource: 'user-recorded', weightUsed: 52.5,
    });
    expect(parents()).toHaveLength(1);
    expect(setDocs()).toHaveLength(1);
    await waitFor(() => expect(hook.result.current.getActualPerformance(0, 1)).toEqual(recorded(null, 52.5)));
    expect(hook.result.current.isSetCompleted(0, 1)).toBe(true);
  });

  it('concurrent writes to one exercise create one parent and one document per set', async () => {
    const hook = mount();
    await loaded(hook);

    let pending: Promise<unknown>[] = [];
    act(() => {
      const current = hook.result.current;
      pending = [
        current.updateSetPerformanceAsync({ ...SET1, reps: 8 }),
        current.toggleSetAsync({ ...SET2, completed: true }),
        current.updateSetPerformanceAsync({ ...SET1, weightKg: 40 }),
        current.toggleSetAsync({ ...SET1, completed: true }),
        current.updateSetPerformanceAsync({ ...SET2, reps: 6 }),
      ];
    });
    await act(async () => { await Promise.all(pending); });

    expect(parents()).toHaveLength(1);
    expect(setDocs()).toHaveLength(2);
    expect(setDoc(1)).toMatchObject({ completed: true, repsCompleted: 8, weightUsed: 40 });
    expect(setDoc(2)).toMatchObject({ completed: true, repsCompleted: 6 });
  });
});

describe('offline performance', () => {
  it('queues recorded values durably, shows them across a reload, and replays them as recorded', async () => {
    online(false);
    client.setQueryData(KEY, {});
    const hook = mount();

    await act(async () => { await hook.result.current.updateSetPerformanceAsync({ ...SET1, reps: 10, weightKg: 52.5 }); });

    const [entry] = loadQueue();
    expect(entry).toMatchObject({ type: 'UPDATE_SET_PERFORMANCE', ownerUid: 'A', status: 'pending' });
    expect(entry.payload).toEqual({ ...SET1, reps: 10, weightKg: 52.5 });
    expect(entry.payload).not.toHaveProperty('completed');
    expect(writes).toEqual([]);
    expect(hook.result.current.getActualPerformance(0, 1)).toEqual(recorded(10, 52.5));
    expect(hook.result.current.isSetCompleted(0, 1)).toBe(false);

    // A reload before reconnecting: the queue alone still shows the values.
    hook.unmount();
    resetSetWriteIntentsForTests();
    client = freshClient();
    client.setQueryData(KEY, {});
    const reloaded = mount();
    expect(reloaded.result.current.getActualPerformance(0, 1)).toEqual(recorded(10, 52.5));

    online(true);
    await act(async () => { expect((await flush()).completed).toBe(1); });

    expect(setDoc()).toEqual({ setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 10, weightUsed: 52.5 });
    expect(loadQueue()).toEqual([]);
    // Still shown between replay and the refetch it triggers.
    expect(reloaded.result.current.getActualPerformance(0, 1)).toEqual(recorded(10, 52.5));
  });

  it('replays a cleared value by removing it, keeping completion where there is one', async () => {
    seed({
      open: { setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 8 },
      done: { setNumber: 2, completed: true, completedAt: 'ts', performanceSource: 'user-recorded', repsCompleted: 8, weightUsed: 50 },
    });
    enqueue('UPDATE_SET_PERFORMANCE', { ...SET1, reps: null }, 'A');
    enqueue('UPDATE_SET_PERFORMANCE', { ...SET2, reps: null, weightKg: null }, 'A');

    expect((await flush()).completed).toBe(2);

    expect(rows.has(`${LOGS}/log/workout_set_logs/open`)).toBe(false);
    expect(rows.get(`${LOGS}/log/workout_set_logs/done`)).toEqual({
      setNumber: 2, completed: true, completedAt: 'ts', performanceSource: 'completion-only',
    });
  });

  it('replays older TOGGLE_SET entries as completion only, and their un-tick keeps recorded values', async () => {
    seed({ s1: { setNumber: 1, completed: true, completedAt: 'ts', performanceSource: 'user-recorded', repsCompleted: 10 } });

    enqueue('TOGGLE_SET', { ...SET1, completed: false, repsCompleted: 12, weightUsed: 60 } as never, 'A');
    expect((await flush()).completed).toBe(1);
    expect(rows.get(`${LOGS}/log/workout_set_logs/s1`)).toEqual({
      setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 10,
    });

    enqueue('TOGGLE_SET', { ...SET1, completed: true, repsCompleted: 12, weightUsed: 60 } as never, 'A');
    expect((await flush()).completed).toBe(1);
    expect(rows.get(`${LOGS}/log/workout_set_logs/s1`)).toEqual({
      setNumber: 1, completed: true, completedAt: expect.anything(), performanceSource: 'user-recorded', repsCompleted: 10,
    });
  });

  it('queues an online edit behind older entries for the same exercise, so replay applies them in order', async () => {
    enqueue('UPDATE_SET_PERFORMANCE', { ...SET1, reps: 8 }, 'A');
    const hook = mount();
    await loaded(hook);

    let result: { queued?: boolean } | undefined;
    await act(async () => { result = await hook.result.current.updateSetPerformanceAsync({ ...SET1, reps: 12 }); });

    expect(result?.queued).toBe(true);
    expect(loadQueue().map((entry) => (entry.payload as UpdateSetPerformancePayload).reps)).toEqual([8, 12]);
    expect(hook.result.current.getActualPerformance(0, 1)?.reps).toBe(12);

    await act(async () => { await flush(); });

    await waitFor(() => expect(setDoc()?.repsCompleted).toBe(12));
    expect(hook.result.current.getActualPerformance(0, 1)?.reps).toBe(12);
  });
});

describe('account ownership', () => {
  it("never replays or shows another account's recorded values", async () => {
    enqueue('UPDATE_SET_PERFORMANCE', { ...SET1, reps: 10 }, 'A');
    identity.currentUser = { uid: 'B' };

    expect((await flushOfflineQueue('B', vi.fn())).completed).toBe(0);
    expect(writes).toEqual([]);
    expect(loadQueue()).toHaveLength(1);

    const hook = mount();
    await loaded(hook);
    expect(hook.result.current.getActualPerformance(0, 1)).toBeUndefined();
  });

  it('abandons a recorded-value write when the account changes during its lookup', async () => {
    const hook = mount();
    await loaded(hook);
    firestore.getDocs.mockImplementationOnce(async () => {
      identity.currentUser = { uid: 'B' };
      return { docs: [], empty: true };
    });

    await act(async () => {
      await hook.result.current.updateSetPerformanceAsync({ ...SET1, reps: 10 }).catch((error: Error) => error);
    });

    expect(writes).toEqual([]);
    expect(loadQueue()).toEqual([]);
    expect(hook.result.current.getActualPerformance(0, 1)).toBeUndefined();
  });
});
