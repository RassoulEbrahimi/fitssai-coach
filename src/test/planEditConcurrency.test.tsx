import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/*
  TRAINING-PLAN-V2-02: chained positional plan edits.

  Edits run one after another in the plan's lane, but each one's optimistic
  update is applied the moment it is issued, on top of the edits before it.
  When an earlier edit then fails, a later edit addressed to the list the user
  saw must never land on a different exercise, and the cache must end on the
  plan as stored. Real hooks against the in-memory Firestore boundary.
*/

const identity = vi.hoisted(() => ({ currentUser: { uid: 'u1' } as { uid: string } | null }));
vi.mock('@/lib/firebase', () => ({ auth: identity, db: {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: identity.currentUser }) }));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({
  toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn(),
  toastSuccess: vi.fn(), toastWarning: vi.fn(), toastInfo: vi.fn(),
}));

import { useReorderExercise, type ReorderExerciseParams } from '@/hooks/useReorderExercise';
import { useDeleteExercise } from '@/hooks/useDeleteExercise';
import { useExerciseEditor } from '@/hooks/useExerciseEditor';
import { PlanEditBlockedError } from '@/lib/exerciseHistoryGuard';
import { firestore, resetWorkoutFirestore, rows, writes } from '@/test/mocks/workoutFirestore';

const PLAN = 'p1';
const WEEK = 'Week 1';
const PLAN_PATH = `users/u1/workout_plans/${PLAN}`;
const KEY = ['workout-plan', PLAN];
const ex = (name: string) => ({ name, sets: 3, reps: '10', rest: '90s' });

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;

type Content = Record<string, { day: string; exercises: { name: string }[] }[]>;
const storedNames = () => ((rows.get(PLAN_PATH) as { content: Content }).content[WEEK][0].exercises).map((e) => e.name);
const cachedNames = () => ((client.getQueryData(KEY) as { content: Content }).content[WEEK][0].exercises).map((e) => e.name);
const planWrites = () => writes.filter((w) => w.path === PLAN_PATH).length;

/** The next history check waits for `release`, then cannot reach the server: the edit fails. */
const failNextEditAfter = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(firestore.getDocsFromServer).mockImplementationOnce(async () => {
    await gate;
    throw Object.assign(new Error('Failed to get documents from server.'), { code: 'unavailable' });
  });
  return release;
};

/** Every edit's outcome, and a promise per edit that resolves once it settled. */
const track = () => {
  const outcomes: { error: unknown; settled: boolean }[] = [];
  const next = () => {
    const outcome = { error: null as unknown, settled: false };
    outcomes.push(outcome);
    return {
      onError: (error: unknown) => { outcome.error = error; },
      onSettled: () => { outcome.settled = true; },
    };
  };
  const allSettled = () => waitFor(() => expect(outcomes.every((o) => o.settled)).toBe(true));
  return { outcomes, next, allSettled };
};

type Callbacks = { onError: (error: unknown) => void; onSettled: () => void };

const editors = () => renderHook(() => {
  const { reorderExerciseAsync } = useReorderExercise();
  const { deleteExercise } = useDeleteExercise();
  const { updateExercise } = useExerciseEditor();
  return {
    // Per call, as Edit Mode does: `mutate`'s own callbacks fire only for a hook's latest call.
    reorder: (params: ReorderExerciseParams, callbacks: Callbacks) => {
      void reorderExerciseAsync(params).catch(callbacks.onError).finally(callbacks.onSettled);
    },
    remove: deleteExercise,
    update: updateExercise,
  };
}, { wrapper });

const expectStale = (error: unknown) => {
  expect(error).toBeInstanceOf(PlanEditBlockedError);
  expect((error as PlanEditBlockedError).reason).toBe('stale-target');
};

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  identity.currentUser = { uid: 'u1' };
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const content = { [WEEK]: [{ day: 'Montag', exercises: [ex('A'), ex('B'), ex('C')] }] };
  rows.set(PLAN_PATH, { content });
  client.setQueryData(KEY, { id: PLAN, content });
});
afterEach(() => {
  vi.restoreAllMocks();
  client.clear();
});

describe('a later edit after an earlier one fails', () => {
  it('A - removing the visually moved exercise removes nothing else', async () => {
    const view = editors();
    const t = track();
    const release = failNextEditAfter();

    await act(async () => { view.result.current.reorder({ planId: PLAN, weekKey: WEEK, dayIndex: 0, fromIndex: 2, toIndex: 0, exerciseName: 'C' }, t.next()); });
    expect(cachedNames()).toEqual(['C', 'A', 'B']);
    // The user removes C where they see it: index 0.
    await act(async () => { view.result.current.remove({ planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 0, expectedName: 'C' }, t.next()); });
    expect(cachedNames()).toEqual(['A', 'B']);

    await act(async () => { release(); });
    await t.allSettled();

    expect((t.outcomes[0].error as PlanEditBlockedError).reason).toBe('history-unverifiable');
    expectStale(t.outcomes[1].error);
    // A, at index 0 on the server, was never removed. Nothing was written.
    expect(storedNames()).toEqual(['A', 'B', 'C']);
    expect(planWrites()).toBe(0);
    await waitFor(() => expect(cachedNames()).toEqual(['A', 'B', 'C']));
  });

  it('B - replacing the visually moved exercise replaces nothing else', async () => {
    const view = editors();
    const t = track();
    const release = failNextEditAfter();

    await act(async () => { view.result.current.reorder({ planId: PLAN, weekKey: WEEK, dayIndex: 0, fromIndex: 2, toIndex: 0, exerciseName: 'C' }, t.next()); });
    await act(async () => {
      view.result.current.update({ planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 0, exercise: ex('X'), expectedName: 'C' }, t.next());
    });
    expect(cachedNames()).toEqual(['X', 'A', 'B']);

    await act(async () => { release(); });
    await t.allSettled();

    expectStale(t.outcomes[1].error);
    expect(storedNames()).toEqual(['A', 'B', 'C']);
    expect(planWrites()).toBe(0);
    await waitFor(() => expect(cachedNames()).toEqual(['A', 'B', 'C']));
  });

  it('C - two rapid reorders where the first fails end with server and cache in the same true order', async () => {
    const view = editors();
    const t = track();
    const release = failNextEditAfter();

    await act(async () => { view.result.current.reorder({ planId: PLAN, weekKey: WEEK, dayIndex: 0, fromIndex: 2, toIndex: 0, exerciseName: 'C' }, t.next()); });
    // On screen C, A, B: A moves to the end.
    await act(async () => { view.result.current.reorder({ planId: PLAN, weekKey: WEEK, dayIndex: 0, fromIndex: 1, toIndex: 2, exerciseName: 'A' }, t.next()); });
    expect(cachedNames()).toEqual(['C', 'B', 'A']);

    await act(async () => { release(); });
    await t.allSettled();

    // The second move was addressed to a list that never existed: refused, not redirected to B.
    expectStale(t.outcomes[1].error);
    expect(storedNames()).toEqual(['A', 'B', 'C']);
    expect(planWrites()).toBe(0);
    await waitFor(() => expect(cachedNames()).toEqual(storedNames()));
  });
});

describe('a later edit after an earlier one succeeds', () => {
  it('D - an immediate remove still targets the moved exercise', async () => {
    const view = editors();
    const t = track();
    await act(async () => { view.result.current.reorder({ planId: PLAN, weekKey: WEEK, dayIndex: 0, fromIndex: 2, toIndex: 0, exerciseName: 'C' }, t.next()); });
    await act(async () => { view.result.current.remove({ planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 0, expectedName: 'C' }, t.next()); });
    await t.allSettled();

    expect(t.outcomes.map((o) => o.error)).toEqual([null, null]);
    expect(storedNames()).toEqual(['A', 'B']);
    await waitFor(() => expect(cachedNames()).toEqual(['A', 'B']));
  });

  it('D - an immediate replace still targets the moved exercise', async () => {
    const view = editors();
    const t = track();
    await act(async () => { view.result.current.reorder({ planId: PLAN, weekKey: WEEK, dayIndex: 0, fromIndex: 2, toIndex: 0, exerciseName: 'C' }, t.next()); });
    await act(async () => {
      view.result.current.update({ planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 0, exercise: ex('X'), expectedName: 'C' }, t.next());
    });
    await t.allSettled();

    expect(t.outcomes.map((o) => o.error)).toEqual([null, null]);
    expect(storedNames()).toEqual(['X', 'A', 'B']);
    await waitFor(() => expect(cachedNames()).toEqual(['X', 'A', 'B']));
  });

  it('rapid successful moves all land, in order', async () => {
    const view = editors();
    const t = track();
    await act(async () => { view.result.current.reorder({ planId: PLAN, weekKey: WEEK, dayIndex: 0, fromIndex: 2, toIndex: 1, exerciseName: 'C' }, t.next()); });
    await act(async () => { view.result.current.reorder({ planId: PLAN, weekKey: WEEK, dayIndex: 0, fromIndex: 1, toIndex: 0, exerciseName: 'C' }, t.next()); });
    await act(async () => { view.result.current.reorder({ planId: PLAN, weekKey: WEEK, dayIndex: 0, fromIndex: 1, toIndex: 2, exerciseName: 'A' }, t.next()); });
    await t.allSettled();

    expect(t.outcomes.map((o) => o.error)).toEqual([null, null, null]);
    expect(storedNames()).toEqual(['C', 'B', 'A']);
    await waitFor(() => expect(cachedNames()).toEqual(['C', 'B', 'A']));
  });
});
