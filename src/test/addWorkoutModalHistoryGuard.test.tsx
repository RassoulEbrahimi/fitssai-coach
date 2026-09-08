import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * P1-05 — the modal's own plan writer.
 *
 * `AddWorkoutModal` does not go through `useAddExercise`: it reads the plan,
 * pushes onto the day's exercise array and calls `setDoc` itself. That makes it
 * a fourth identity-changing path with its own error handling, so the guard has
 * to be proven on it separately rather than by analogy with the hooks.
 *
 * Everything below the component boundary is production code: the real modal,
 * the real form, the real guard, the real Firestore calls against the shared
 * in-memory double. Only the exercise catalogue is stubbed, because selecting a
 * movement is a precondition of the write rather than part of what is tested.
 */

const identity = vi.hoisted(() => ({ currentUser: { uid: 'u1' } as { uid: string } | null }));
vi.mock('@/lib/firebase', () => ({ auth: identity, db: {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: identity.currentUser, loading: false }) }));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/toastWithIcon', () => ({
  toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn(),
  toastSuccess: vi.fn(), toastWarning: vi.fn(), toastInfo: vi.fn(),
}));

// The catalogue is a Firestore-backed list of movements to pick from. One
// button standing in for it is enough to reach the submit path.
vi.mock('@/components/ExerciseSelector', () => ({
  PREDEFINED_EXERCISES: [],
  ExerciseSelector: ({ onSelect }: { onSelect: (e: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onSelect({
        id: 'curl', name: 'Curl', target_muscle: 'Arms',
        category: 'Isolation', type: 'strength', icon: '💪',
      })}
    >
      Übung wählen
    </button>
  ),
}));

import { AddWorkoutModal } from '@/components/workout/AddWorkoutModal';
import { toastError, toastSuccess } from '@/lib/toastWithIcon';
import { control, rows, writes, resetWorkoutFirestore } from '@/test/mocks/workoutFirestore';

const PLAN = 'p1';
const PLAN_PATH = `users/u1/workout_plans/${PLAN}`;
const LOGS = 'users/u1/workout_logs';
const WEEK = 'Week 1';

let client: QueryClient;
const onClose = vi.fn();
const onWorkoutAdded = vi.fn();

const seedPlan = (names: string[]) => {
  rows.set(PLAN_PATH, {
    createdAt: { toDate: () => new Date('2026-09-01T00:00:00Z') },
    content: { [WEEK]: [{ day: 'Montag', exercises: names.map(name => ({ name, sets: 3, reps: '10' })) }] },
  });
};

const storedNames = (): string[] =>
  ((rows.get(PLAN_PATH) as { content: Record<string, { exercises: { name: string }[] }[]> })
    .content[WEEK][0].exercises).map(e => e.name);

const planWrites = () => writes.filter(w => w.path === PLAN_PATH).length;

/** Open the modal and drive the manual form to the point of writing. */
const addOneExercise = async () => {
  render(
    <QueryClientProvider client={client}>
      <AddWorkoutModal
        isOpen
        mode="manual"
        onClose={onClose}
        onWorkoutAdded={onWorkoutAdded}
        dayContext={{ weekKey: WEEK, dayIndex: 0 }}
      />
    </QueryClientProvider>
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Übung wählen' }));
  await user.click(await screen.findByRole('button', { name: 'Hinzufügen' }));
};

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  identity.currentUser = { uid: 'u1' };
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

describe('AddWorkoutModal is guarded by the same history check as the hooks', () => {
  it('refuses the write when the server cannot say whether the slot was trained', async () => {
    seedPlan(['Bench Press', 'Row']);
    // The device still reports a connection; the SDK cannot reach the backend.
    control.serverUnavailablePaths = [LOGS];

    await addOneExercise();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const [title, description] = vi.mocked(toastError).mock.calls[0];
    expect(title).toBe('Änderung nicht möglich');
    expect(description).toContain('Trainingsverlauf');
    // Not the modal's catch-all, which would say the wrong thing.
    expect(description).not.toMatch(/Training konnte nicht hinzugefügt werden/);
    expect(toastError).toHaveBeenCalledTimes(1);

    // Nothing was persisted and nothing claimed otherwise.
    expect(planWrites()).toBe(0);
    expect(storedNames()).toEqual(['Bench Press', 'Row']);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onWorkoutAdded).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses to append onto a slot an earlier delete left history in', async () => {
    seedPlan(['Bench Press', 'Row']);
    // History that predates the guard: the plan lost its third exercise while
    // the log for index 2 stayed behind. Appending would adopt those sets.
    rows.set(`${LOGS}/orphan`, {
      planId: PLAN, weekKey: WEEK, dayIndex: 0, exerciseIndex: 2, completed: true,
    });

    await addOneExercise();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(vi.mocked(toastError).mock.calls[0][0]).toBe('Änderung nicht möglich');
    expect(planWrites()).toBe(0);
    expect(storedNames()).toEqual(['Bench Press', 'Row']);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still adds the exercise when the slot is free and the check can be answered', async () => {
    seedPlan(['Bench Press', 'Row']);

    await addOneExercise();

    await waitFor(() => expect(storedNames()).toEqual(['Bench Press', 'Row', 'Curl']));
    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(onWorkoutAdded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
