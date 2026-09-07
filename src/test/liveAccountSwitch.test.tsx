import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const identity = vi.hoisted(() => ({ currentUser: { uid: 'A' } as { uid: string } | null }));
vi.mock('@/lib/firebase', () => ({ auth: identity, db: {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'A', id: 'A' } }) }));
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({ toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn() }));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);

import { useSetTracking } from '@/hooks/useSetTracking';
import { useWeekCompletion } from '@/hooks/useWeekCompletion';
import { useWorkoutLogs } from '@/hooks/queries/useWorkoutLogs';
import { recordSuccessfulWorkoutFinish } from '@/lib/sessionRecord';
import { handlers } from '@/lib/offlineHandlers';
import { loadQueue } from '@/lib/offlineQueue';
import { queryKeys } from '@/lib/queryKeys';
import { control, firestore, resetWorkoutFirestore, rows, writes } from '@/test/mocks/workoutFirestore';

const PLAN = 'plan-A';
const WEEK = 'Week 1';
const DAY = '2026-03-10';
const STARTED = Date.parse('2026-03-10T18:00:00Z');
const SET = {
  planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 0,
  setNumber: 1, repsCompleted: 10, completed: true, workoutDay: DAY,
};
const EXERCISE = { planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 0, completed: true };

let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

/** Switch the live Firebase account the next time anything looks. */
const switchToB = () => { identity.currentUser = { uid: 'B' }; };

/** Let the account change land during the operation's own awaited read. */
const switchDuringRead = () => {
  firestore.getDocs.mockImplementationOnce(async () => {
    switchToB();
    return { docs: [], empty: true };
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  localStorage.clear();
  identity.currentUser = { uid: 'A' };
  queryClient = new QueryClient({ defaultOptions: {
    queries: { retry: false }, mutations: { retry: false },
  } });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('a live write started by A stops when the account becomes B', () => {
  it('abandons a set write when the account changes during the parent-log lookup', async () => {
    const { result } = renderHook(() => useSetTracking(PLAN, WEEK, 0), { wrapper });
    switchDuringRead();

    await act(async () => {
      await result.current.toggleSetAsync(SET).catch((error: Error) => error);
    });

    expect(writes).toEqual([]);
    expect(rows.size).toBe(0);
    // Nothing was queued for B to replay either.
    expect(loadQueue()).toEqual([]);
  });

  it('abandons a set write when the account changes during the second, set-level read', async () => {
    const { result } = renderHook(() => useSetTracking(PLAN, WEEK, 0), { wrapper });
    firestore.getDocs.mockResolvedValueOnce(
      { docs: [{ id: 'log-1', exists: () => true, data: () => ({}) }], empty: false });
    switchDuringRead();

    await act(async () => {
      await result.current.toggleSetAsync(SET).catch((error: Error) => error);
    });

    expect(writes).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it('leaves no optimistic set behind once the aborted write settles', async () => {
    const key = queryKeys.sets.byDay(PLAN, WEEK, 0);
    queryClient.setQueryData(key, {});
    const { result } = renderHook(() => useSetTracking(PLAN, WEEK, 0), { wrapper });
    switchDuringRead();

    await act(async () => {
      await result.current.toggleSetAsync(SET).catch((error: Error) => error);
    });

    await waitFor(() => expect(queryClient.getQueryData(key)).toEqual({}));
  });

  it('abandons an exercise completion when the account changes during the lookup', async () => {
    const { result } = renderHook(
      () => useWeekCompletion({ planId: PLAN, weekKey: WEEK, enabled: false }), { wrapper });
    switchDuringRead();

    await act(async () => { result.current.toggleExercise(EXERCISE); });

    await waitFor(() => expect(firestore.getDocs).toHaveBeenCalled());
    expect(writes).toEqual([]);
    expect(rows.size).toBe(0);
    expect(loadQueue()).toEqual([]);
  });

  it('abandons the online day toggle inside the transaction', async () => {
    const { result } = renderHook(() => useWorkoutLogs(PLAN), { wrapper });
    // Fires once runTransaction has been entered, so only the guard inside the
    // transaction callback can still stop this write.
    control.beforeCommit = async () => { switchToB(); };

    await act(async () => {
      result.current.toggleDay({ workoutDateStr: DAY, completed: true, weekKey: WEEK, dayIndex: 0 });
    });

    await waitFor(() => expect(firestore.runTransaction).toHaveBeenCalled());
    expect(writes).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it('writes no completion or duration when the account changes before the finish commits', async () => {
    control.beforeCommit = async () => { switchToB(); };

    await expect(recordSuccessfulWorkoutFinish({
      uid: 'A', planId: PLAN, weekKey: WEEK, dayIndex: 1, workoutDay: DAY,
      startedAt: STARTED, endedAt: STARTED + 2_700_000,
    })).rejects.toThrow(/account/);

    expect(writes).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it('rejects a finish rather than reporting a terminal outcome, so the session stays recoverable', async () => {
    switchToB();
    const outcome = await recordSuccessfulWorkoutFinish({
      uid: 'A', planId: PLAN, weekKey: WEEK, dayIndex: 1, workoutDay: DAY,
      startedAt: STARTED, endedAt: STARTED + 2_700_000,
    }).catch((error: Error) => error);

    // A returned outcome — written or skipped — is terminal to TodayWorkoutCard
    // and would end the session and drop the frozen finish instant.
    expect(outcome).toBeInstanceOf(Error);
    expect(writes).toEqual([]);
  });

  it('still reports unusable metadata as skipped rather than as an account change', async () => {
    await expect(recordSuccessfulWorkoutFinish({
      uid: 'A', planId: '', weekKey: WEEK, dayIndex: 1, workoutDay: DAY,
      startedAt: STARTED, endedAt: STARTED + 2_700_000,
    })).resolves.toEqual({ status: 'skipped', reason: 'incomplete-metadata' });
  });

  it('never redirects an A-addressed write to B, whichever guard trips', async () => {
    switchToB();
    await expect(handlers.TOGGLE_DAY(
      { planId: PLAN, weekKey: WEEK, dayIndex: 0, workoutDay: DAY, completed: true }, 'A',
    )).rejects.toThrow(/account/);

    expect(writes).toEqual([]);
    expect([...rows.keys()].some(path => path.startsWith('users/B/'))).toBe(false);
  });
});

describe('the same owner throughout', () => {
  it('completes a set write normally', async () => {
    const { result } = renderHook(() => useSetTracking(PLAN, WEEK, 0), { wrapper });

    await act(async () => { await result.current.toggleSetAsync(SET); });

    expect(firestore.addDoc).toHaveBeenCalled();
  });

  it('completes an exercise completion normally', async () => {
    const { result } = renderHook(
      () => useWeekCompletion({ planId: PLAN, weekKey: WEEK, enabled: false }), { wrapper });

    await act(async () => { result.current.toggleExercise(EXERCISE); });

    await waitFor(() => expect(firestore.addDoc).toHaveBeenCalled());
  });

  it('completes the day toggle and the successful finish normally', async () => {
    const { result } = renderHook(() => useWorkoutLogs(PLAN), { wrapper });
    await act(async () => {
      result.current.toggleDay({ workoutDateStr: DAY, completed: true, weekKey: WEEK, dayIndex: 0 });
    });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].path).toMatch(/^users\/A\/workout_logs\//);

    await expect(recordSuccessfulWorkoutFinish({
      uid: 'A', planId: PLAN, weekKey: WEEK, dayIndex: 0, workoutDay: DAY,
      startedAt: STARTED, endedAt: STARTED + 2_700_000,
    })).resolves.toEqual({ status: 'written', durationSec: 2700 });
    expect(writes.every(write => write.path.startsWith('users/A/'))).toBe(true);
  });
});
