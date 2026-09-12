import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';

/*
  A ticked set is a completed set, not a measurement. These drive the
  production writer, the offline queue and replay against the in-memory
  Firestore boundary and check that no step turns the tick into reps or weight.
*/

const identity = vi.hoisted(() => ({ currentUser: { uid: 'A' } as { uid: string } | null }));
vi.mock('@/lib/firebase', () => ({ auth: identity, db: {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: identity.currentUser }) }));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({ toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn() }));

import { useSetTracking } from '@/hooks/useSetTracking';
import { queryKeys } from '@/lib/queryKeys';
import { enqueue, loadQueue } from '@/lib/offlineQueue';
import { flushOfflineQueue } from '@/lib/offlineReplay';
import { rows, resetWorkoutFirestore } from '@/test/mocks/workoutFirestore';

const POSITION = { planId: 'p', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 0, workoutDay: '2026-09-07' };
const KEY = queryKeys.sets.byDay('p', 'Week 1', 0);
const COMPLETION_ONLY_ACTUAL = { source: 'completion-only', reps: null, weightKg: null };

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const online = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  onlineManager.setOnline(value);
};
const setDocs = () => [...rows.entries()].filter(([path]) => path.includes('/workout_set_logs/'));

const expectCompletionOnly = (data: Record<string, unknown>, setNumber: number) => {
  expect(data).toMatchObject({ setNumber, performanceSource: 'completion-only' });
  expect(data).not.toHaveProperty('repsCompleted');
  expect(data).not.toHaveProperty('weightUsed');
};

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  localStorage.clear();
  identity.currentUser = { uid: 'A' };
  online(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { vi.restoreAllMocks(); online(true); client.clear(); });

describe('online set completion', () => {
  it('writes completion only, reads it back as unmeasured, and removes it on un-tick', async () => {
    const { result } = renderHook(() => useSetTracking('p', 'Week 1', 0), { wrapper });

    await act(async () => { await result.current.toggleSetAsync({ ...POSITION, setNumber: 1, completed: true }); });

    expect(setDocs()).toHaveLength(1);
    expectCompletionOnly(setDocs()[0][1], 1);
    await waitFor(() => expect(result.current.isSetCompleted(0, 1)).toBe(true));
    expect(result.current.getCompletedSetsCount(0)).toBe(1);
    expect(result.current.getSetDetails(0, 1)?.actual).toEqual(COMPLETION_ONLY_ACTUAL);

    await act(async () => { await result.current.toggleSetAsync({ ...POSITION, setNumber: 1, completed: false }); });

    expect(setDocs()).toHaveLength(0);
    await waitFor(() => expect(result.current.isSetCompleted(0, 1)).toBe(false));
  });

  it('reads a legacy set with prescription-copied numbers as completed but unverified', async () => {
    rows.set('users/A/workout_logs/legacy', { planId: 'p', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 0, completed: false });
    rows.set('users/A/workout_logs/legacy/workout_set_logs/old', { setNumber: 1, repsCompleted: 10, weightUsed: 60 });

    const { result } = renderHook(() => useSetTracking('p', 'Week 1', 0), { wrapper });

    await waitFor(() => expect(result.current.isSetCompleted(0, 1)).toBe(true));
    expect(result.current.getSetDetails(0, 1)?.actual).toEqual({ source: 'unverified', reps: null, weightKg: null });
    // Read only: the stored legacy document is left exactly as it was.
    expect(rows.get('users/A/workout_logs/legacy/workout_set_logs/old')).toEqual({ setNumber: 1, repsCompleted: 10, weightUsed: 60 });
  });
});

describe('offline set completion', () => {
  it('queues completion only, keeps the optimistic tick unmeasured, and replays without reps or weight', async () => {
    online(false);
    client.setQueryData(KEY, {});
    const { result } = renderHook(() => useSetTracking('p', 'Week 1', 0), { wrapper });

    // Even a caller that still hands over prescription numbers cannot queue them.
    const legacyShaped = { ...POSITION, setNumber: 2, completed: true, repsCompleted: 10, weightUsed: 60 };
    await act(async () => { await result.current.toggleSetAsync(legacyShaped as never); });

    const [entry] = loadQueue();
    expect(entry.type).toBe('TOGGLE_SET');
    expect(entry.payload).toEqual({ ...POSITION, setNumber: 2, completed: true });
    expect(JSON.parse(localStorage.getItem('FITSSAI_OFFLINE_QUEUE')!)[0].payload).not.toHaveProperty('repsCompleted');
    expect(result.current.isSetCompleted(0, 2)).toBe(true);
    expect(result.current.getSetDetails(0, 2)?.actual).toEqual(COMPLETION_ONLY_ACTUAL);

    online(true);
    expect((await flushOfflineQueue('A', vi.fn())).completed).toBe(1);

    expect(setDocs()).toHaveLength(1);
    expectCompletionOnly(setDocs()[0][1], 2);
  });

  it('replays an entry queued by an older build without writing its copied reps or weight', async () => {
    enqueue('TOGGLE_SET', { ...POSITION, setNumber: 1, completed: true, repsCompleted: 10, weightUsed: 40 } as never, 'A');

    expect((await flushOfflineQueue('A', vi.fn())).completed).toBe(1);

    expect(setDocs()).toHaveLength(1);
    expectCompletionOnly(setDocs()[0][1], 1);
  });

  it('replays an un-tick by removing the completion', async () => {
    enqueue('TOGGLE_SET', { ...POSITION, setNumber: 1, completed: true }, 'A');
    enqueue('TOGGLE_SET', { ...POSITION, setNumber: 1, completed: false }, 'A');

    expect((await flushOfflineQueue('A', vi.fn())).completed).toBe(2);

    expect(setDocs()).toHaveLength(0);
  });
});
