import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * P1-05 — historical exercise identity.
 *
 * Every case below drives the real production hooks against the in-memory
 * Firestore boundary: the writers, the guard, the readers and the toast
 * plumbing are all the shipped code. Nothing here re-implements the edit
 * semantics it is checking.
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

import { useSetTracking } from '@/hooks/useSetTracking';
import { useWeekCompletion } from '@/hooks/useWeekCompletion';
import { useDeleteExercise } from '@/hooks/useDeleteExercise';
import { useRestoreExercise } from '@/hooks/useRestoreExercise';
import { useAddExercise } from '@/hooks/useAddExercise';
import { useExerciseEditor } from '@/hooks/useExerciseEditor';
import {
  PlanEditBlockedError,
  affectedPositions,
  changesExerciseIdentity,
  weeksDisplaying,
} from '@/lib/exerciseHistoryGuard';
import { toastError } from '@/lib/toastWithIcon';
import { rows, writes, resetWorkoutFirestore } from '@/test/mocks/workoutFirestore';

const PLAN = 'p1';
const WEEK = 'Week 1';
const PLAN_PATH = `users/u1/workout_plans/${PLAN}`;
const exercise = (name: string) => ({ name, sets: 3, reps: '10' });

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;

const seedPlan = (names: string[], weekKey: string = WEEK) => {
  const existing = (rows.get(PLAN_PATH) as { content?: Record<string, unknown> } | undefined)?.content ?? {};
  rows.set(PLAN_PATH, {
    content: { ...existing, [weekKey]: [{ day: 'Montag', exercises: names.map(exercise) }] },
  });
};

/** The plan as stored, which is what a later reader would see. */
const storedNames = (weekKey: string = WEEK): string[] =>
  ((rows.get(PLAN_PATH) as { content: Record<string, { exercises: { name: string }[] }[]> })
    .content[weekKey][0].exercises).map(e => e.name);

const planWrites = () => writes.filter(w => w.path === PLAN_PATH).length;

/** A set logged through the production writer: the parent log stays completed:false. */
const logSetAt = async (exerciseIndex: number, weekKey: string = WEEK) => {
  const sets = renderHook(() => useSetTracking(PLAN, weekKey, 0), { wrapper });
  await act(async () => {
    await sets.result.current.toggleSetAsync({
      planId: PLAN, weekKey, dayIndex: 0, exerciseIndex,
      setNumber: 1, repsCompleted: 8, weightUsed: 100, completed: true,
      workoutDay: '2026-09-07',
    });
  });
  sets.unmount();
};

/** An exercise ticked complete through the production writer. */
const completeExerciseAt = async (exerciseIndex: number, weekKey: string = WEEK) => {
  const week = renderHook(() => useWeekCompletion({ planId: PLAN, weekKey }), { wrapper });
  await act(async () => {
    week.result.current.toggleExercise({
      planId: PLAN, weekKey, dayIndex: 0, exerciseIndex, completed: true,
    });
  });
  await waitFor(() => expect([...rows.keys()].some(k => k.startsWith('users/u1/workout_logs/'))).toBe(true));
  week.unmount();
};

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  identity.currentUser = { uid: 'u1' };
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => {
  vi.restoreAllMocks();
  client.clear();
});

/** Drive one plan edit and report the error it settled with, if any. */
const deleteAt = async (exerciseIndex: number, weekKey: string = WEEK) => {
  const view = renderHook(() => useDeleteExercise(), { wrapper });
  let error: unknown = null;
  await act(async () => {
    view.result.current.deleteExercise(
      { planId: PLAN, weekKey, dayIndex: 0, exerciseIndex },
      { onError: (e: unknown) => { error = e; } },
    );
  });
  await waitFor(() => expect(view.result.current.isDeleting).toBe(false));
  view.unmount();
  return error;
};

const restoreAt = async (exerciseIndex: number, name: string, weekKey: string = WEEK) => {
  const view = renderHook(() => useRestoreExercise(), { wrapper });
  let error: unknown = null;
  await act(async () => {
    view.result.current.restoreExercise(
      { planId: PLAN, weekKey, dayIndex: 0, exerciseIndex, exercise: exercise(name) },
      { onError: (e: unknown) => { error = e; } },
    );
  });
  await waitFor(() => expect(view.result.current.isRestoring).toBe(false));
  view.unmount();
  return error;
};

const addTo = async (name: string, weekKey: string = WEEK) => {
  const view = renderHook(() => useAddExercise(), { wrapper });
  let error: unknown = null;
  await act(async () => {
    view.result.current.addExercise(
      { planId: PLAN, weekKey, dayIndex: 0, exercise: exercise(name) },
      { onError: (e: unknown) => { error = e; } },
    );
  });
  await waitFor(() => expect(view.result.current.isAdding).toBe(false));
  view.unmount();
  return error;
};

const updateAt = async (exerciseIndex: number, patch: Record<string, unknown>, weekKey: string = WEEK) => {
  const view = renderHook(() => useExerciseEditor(), { wrapper });
  let error: unknown = null;
  await act(async () => {
    view.result.current.updateExercise(
      { planId: PLAN, weekKey, dayIndex: 0, exerciseIndex, exercise: patch as never },
      { onError: (e: unknown) => { error = e; } },
    );
  });
  await waitFor(() => expect(view.result.current.isUpdating).toBe(false));
  view.unmount();
  return error;
};

const expectBlocked = (error: unknown, reason = 'history-exists') => {
  expect(error).toBeInstanceOf(PlanEditBlockedError);
  expect((error as PlanEditBlockedError).reason).toBe(reason);
};

describe('identity-changing edits are refused while the affected positions carry history', () => {
  it('A — refuses a delete before a logged position and leaves the plan untouched', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(1);
    const before = planWrites();

    expectBlocked(await deleteAt(0));

    // K — the plan is byte-for-byte what it was: no write, no shifted array.
    expect(storedNames()).toEqual(['Bench Press', 'Row', 'Curl']);
    expect(planWrites()).toBe(before);
  });

  it('K — the optimistic removal is rolled back, so the view matches storage', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(1);
    const cacheKey = ['workout-plan', PLAN];
    const cached = { id: PLAN, content: (rows.get(PLAN_PATH) as { content: unknown }).content };
    client.setQueryData(cacheKey, cached);

    expectBlocked(await deleteAt(0));

    const after = client.getQueryData(cacheKey) as typeof cached;
    expect((after.content as Record<string, { exercises: { name: string }[] }[]>)[WEEK][0].exercises.map(e => e.name))
      .toEqual(['Bench Press', 'Row', 'Curl']);
  });

  it('A — refuses a delete of the logged position itself', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(1);

    expectBlocked(await deleteAt(1));
    expect(storedNames()).toEqual(['Bench Press', 'Row', 'Curl']);
  });

  it('B/E — refuses re-inserting an exercise ahead of a logged position', async () => {
    seedPlan(['Row', 'Curl']);
    await logSetAt(1);

    expectBlocked(await restoreAt(0, 'Bench Press'));
    expect(storedNames()).toEqual(['Row', 'Curl']);
  });

  it('C — refuses the first step of the delete-then-reinsert move that stands in for a reorder', async () => {
    // The app has no reorder or drag-to-sort path: the only drag gesture is
    // swipe-to-delete. Moving an exercise therefore means delete + restore,
    // and the delete is refused before anything can shift.
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(2);

    expectBlocked(await deleteAt(0));
    expect(storedNames()).toEqual(['Bench Press', 'Row', 'Curl']);
  });

  it('D — refuses swapping the exercise sitting at a logged position', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(1);

    expectBlocked(await updateAt(1, { name: 'Lat Pulldown', sets: 3, reps: '10' }));
    expect(storedNames()).toEqual(['Bench Press', 'Row', 'Curl']);
  });

  it('appending onto a slot an earlier delete left history in is refused', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(2);
    // History that predates this guard: the plan lost its third exercise while
    // the log for index 2 stayed behind.
    seedPlan(['Bench Press', 'Row']);

    expectBlocked(await addTo('Curl'));
    expect(storedNames()).toEqual(['Bench Press', 'Row']);
  });
});

describe('history that counts as evidence', () => {
  it('I/J — a set log alone blocks, with the parent still completed:false', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(1);

    const parent = [...rows.entries()].find(([path]) => /workout_logs\/[^/]+$/.test(path))![1];
    expect(parent.completed).toBe(false);
    expect([...rows.keys()].some(k => k.includes('/workout_set_logs/'))).toBe(true);

    expectBlocked(await deleteAt(0));
  });

  it('a completed exercise with no set logs blocks', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await completeExerciseAt(1);
    expect([...rows.keys()].some(k => k.includes('/workout_set_logs/'))).toBe(false);

    expectBlocked(await deleteAt(0));
  });

  it('a ticked-then-unticked position with nothing recorded does not block', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    const week = renderHook(() => useWeekCompletion({ planId: PLAN, weekKey: WEEK }), { wrapper });
    await act(async () => {
      week.result.current.toggleExercise({ planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 1, completed: true });
    });
    await waitFor(() => expect([...rows.keys()].some(k => /workout_logs\/[^/]+$/.test(k))).toBe(true));
    await act(async () => {
      week.result.current.toggleExercise({ planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 1, completed: false });
    });
    await waitFor(() => {
      const log = [...rows.entries()].find(([path]) => /workout_logs\/[^/]+$/.test(path))![1];
      expect(log.completed).toBe(false);
      expect(log.completedAt).toBeNull();
    });
    week.unmount();

    // Nothing survives that a later reader could misattribute, so the plan is
    // not frozen by a completion the user took back.
    expect(await deleteAt(0)).toBeNull();
    expect(storedNames()).toEqual(['Row', 'Curl']);
  });

  it('history on a week that only mirrors the edited week still blocks', async () => {
    // Week 3 has no content of its own, so it displays Week 2's exercises
    // while logging under its own weekKey.
    seedPlan(['Bench Press', 'Row', 'Curl'], 'Week 2');
    expect(weeksDisplaying((rows.get(PLAN_PATH) as never as { content: never }).content, 'Week 2'))
      .toEqual(['Week 2', 'Week 3', 'Week 4']);
    await logSetAt(1, 'Week 3');

    expectBlocked(await deleteAt(0, 'Week 2'));
    expect(storedNames('Week 2')).toEqual(['Bench Press', 'Row', 'Curl']);
  });
});

describe('edits that preserve identity stay available', () => {
  it('F — programming metadata on a logged exercise is still editable', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(1);

    expect(await updateAt(1, { sets: 5, reps: '5', weight: '105kg', rest: '120s' })).toBeNull();

    const stored = (rows.get(PLAN_PATH) as never as { content: Record<string, { exercises: Record<string, unknown>[] }[]> })
      .content[WEEK][0].exercises[1];
    expect(stored).toMatchObject({ name: 'Row', sets: 5, reps: '5', weight: '105kg', rest: '120s' });
  });

  it('F — a whitespace-only name change is not an identity change', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(1);

    // The editor stores what it was given; the guard's point is that padding
    // does not make this a different movement, so the write is allowed.
    expect(await updateAt(1, { name: '  Row  ' })).toBeNull();
    expect(storedNames().map(n => n.trim())).toEqual(['Bench Press', 'Row', 'Curl']);
  });

  it('G — identity-changing edits are allowed when nothing was ever logged', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);

    expect(await deleteAt(0)).toBeNull();
    expect(storedNames()).toEqual(['Row', 'Curl']);
    expect(await updateAt(0, { name: 'Lat Pulldown' })).toBeNull();
    expect(storedNames()).toEqual(['Lat Pulldown', 'Curl']);
    expect(await restoreAt(0, 'Bench Press')).toBeNull();
    expect(storedNames()).toEqual(['Bench Press', 'Lat Pulldown', 'Curl']);
  });

  it('H — history on an unaffected position leaves later positions editable', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(0);

    // Removing index 2 shifts nothing at or before index 0.
    expect(await deleteAt(2)).toBeNull();
    expect(storedNames()).toEqual(['Bench Press', 'Row']);
    expect(await updateAt(1, { name: 'Lat Pulldown' })).toBeNull();
    expect(storedNames()).toEqual(['Bench Press', 'Lat Pulldown']);
  });

  it('appending after a logged position stays available', async () => {
    seedPlan(['Bench Press', 'Row']);
    await logSetAt(0);

    expect(await addTo('Curl')).toBeNull();
    expect(storedNames()).toEqual(['Bench Press', 'Row', 'Curl']);
  });
});

describe('refusal reporting, isolation and fail-closed behaviour', () => {
  it('reports the refusal in the user\'s own terms without exposing an index', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(1);
    vi.mocked(toastError).mockClear();

    await deleteAt(0);

    expect(toastError).toHaveBeenCalledTimes(1);
    const [title, description] = vi.mocked(toastError).mock.calls[0];
    expect(title).toBe('Änderung nicht möglich');
    expect(description).toContain('Trainingsverlauf');
    expect(description).not.toMatch(/exerciseIndex|index|\bWeek 1\b/i);
  });

  it('L — another account\'s history at the same position does not block, and never leaks', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    rows.set('users/u2/workout_logs/foreign', {
      planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 1, completed: true,
    });

    expect(await deleteAt(0)).toBeNull();
    expect(storedNames()).toEqual(['Row', 'Curl']);
    expect(rows.get('users/u2/workout_logs/foreign')).toMatchObject({ completed: true });
  });

  it('L — the guard reads the acting account\'s history, not the previous one\'s', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(1);

    // A different account signing in must not inherit u1's protection or data.
    identity.currentUser = { uid: 'u2' };
    rows.set(`users/u2/workout_plans/${PLAN}`, rows.get(PLAN_PATH)!);
    const view = renderHook(() => useDeleteExercise(), { wrapper });
    let error: unknown = null;
    await act(async () => {
      view.result.current.deleteExercise(
        { planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 0 },
        { onError: (e: unknown) => { error = e; } },
      );
    });
    await waitFor(() => expect(view.result.current.isDeleting).toBe(false));
    view.unmount();

    expect(error).toBeNull();
    // u1's plan and history are untouched by u2's edit.
    expect(storedNames()).toEqual(['Bench Press', 'Row', 'Curl']);
  });

  it('fails closed when history cannot be checked, rather than assuming there is none', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    expectBlocked(await deleteAt(0), 'history-unverifiable');
    expect(storedNames()).toEqual(['Bench Press', 'Row', 'Curl']);
    expect(planWrites()).toBe(0);
  });

  it('refuses once instead of retrying a decision four times', async () => {
    seedPlan(['Bench Press', 'Row', 'Curl']);
    await logSetAt(1);

    const started = Date.now();
    expectBlocked(await deleteAt(0));
    // Four attempts with the shared backoff would take seven seconds.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('affected-position semantics', () => {
  it('treats removal and insertion as open-ended, replacement and append as one slot', () => {
    expect(affectedPositions({ kind: 'delete', exerciseIndex: 1 })).toEqual({ from: 1, to: null });
    expect(affectedPositions({ kind: 'insert', exerciseIndex: 1 })).toEqual({ from: 1, to: null });
    expect(affectedPositions({ kind: 'replace', exerciseIndex: 1 })).toEqual({ from: 1, to: 1 });
    expect(affectedPositions({ kind: 'append', exerciseIndex: 3 })).toEqual({ from: 3, to: 3 });
  });

  it('counts only the exercise name as identity', () => {
    const row = { name: 'Row', sets: 3, reps: '10' };
    expect(changesExerciseIdentity(row, { ...row, sets: 5, reps: '5', weight: '100kg' })).toBe(false);
    expect(changesExerciseIdentity(row, { ...row, name: '  Row  ' })).toBe(false);
    expect(changesExerciseIdentity(row, { ...row, name: 'Lat Pulldown' })).toBe(true);
  });

  it('resolves which weeks a week is displayed by', () => {
    const week = [{ day: 'Montag', exercises: [] }];
    expect(weeksDisplaying({ 'Week 1': week } as never, 'Week 1'))
      .toEqual(['Week 1', 'Week 2', 'Week 3', 'Week 4']);
    expect(weeksDisplaying({ 'Week 1': week, 'Week 2': week } as never, 'Week 2'))
      .toEqual(['Week 2', 'Week 3', 'Week 4']);
    expect(weeksDisplaying({ 'Week 1': week, 'Week 2': week } as never, 'Week 1'))
      .toEqual(['Week 1']);
  });
});
