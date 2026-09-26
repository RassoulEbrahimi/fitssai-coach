import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n';

/*
  NUT-04. Legacy Nutrition (`nutrition_plans`) is client read-only under the
  Firestore rules, so the admin table must not offer — or issue — a client
  delete for it. Workout plan deletion is unchanged.
*/

const firestore = vi.hoisted(() => {
  const docs = (entries: { id: string; data: Record<string, unknown> }[]) => ({
    docs: entries.map((e) => ({ id: e.id, data: () => e.data })),
    forEach(cb: (d: { id: string; data: () => Record<string, unknown> }) => void) {
      entries.forEach((e) => cb({ id: e.id, data: () => e.data }));
    },
  });
  const byPath: Record<string, ReturnType<typeof docs>> = {
    users: docs([{ id: 'u1', data: { email: 'mia@example.test', role: 'user' } }]),
    'users/u1/workout_plans': docs([{ id: 'w1', data: { content: {} } }]),
    'users/u1/nutrition_plans': docs([
      {
        id: 'n1',
        data: {
          content: {
            breakfast: [{ meal: 'Porridge', description: 'Haferflocken mit Beeren', calories: 420 }],
            lunch: 'not a list',
            dinner: [null, { meal: 'Linsen-Dal', calories: { kcal: 500 } }],
          },
        },
      },
    ]),
  };
  return {
    collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    getDoc: vi.fn(async () => ({ exists: () => true, data: () => ({ role: 'admin' }) })),
    getDocs: vi.fn(async (ref: { path: string }) => byPath[ref.path] ?? docs([])),
    deleteDoc: vi.fn(async (_ref: unknown) => {}),
    Timestamp: class {},
  };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('@/lib/firebase', () => ({ db: {} }));
// One stable identity: AdminPanel refetches whenever `user` changes identity.
const auth = vi.hoisted(() => ({ user: { uid: 'admin', id: 'admin' }, loading: false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import AdminPanel from './AdminPanel';

const openPlansTab = async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminPanel /></MemoryRouter>);
  await user.click(await screen.findByRole('tab', { name: /Pläne/ }));
  const panel = await screen.findByRole('tabpanel');
  await waitFor(() => expect(within(panel).getAllByRole('row').length).toBeGreaterThan(2));
  const rowFor = (label: string) =>
    within(panel).getAllByRole('row').find((row) => within(row).queryByText(label)) as HTMLElement;
  return { user, panel, rowFor };
};

const deleteControl = (row: HTMLElement) => row.querySelector('button.text-destructive');

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('AdminPanel plan deletion', () => {
  it('still lists legacy Nutrition plans next to workout plans', async () => {
    const { rowFor } = await openPlansTab();

    expect(rowFor('Training')).toBeTruthy();
    expect(rowFor('Ernährung')).toBeTruthy();
  });

  it('deletes a workout plan exactly as before', async () => {
    const { user, rowFor } = await openPlansTab();

    const trigger = deleteControl(rowFor('Training'));
    expect(trigger).not.toBeNull();
    await user.click(trigger as HTMLElement);
    await user.click(await screen.findByRole('button', { name: 'Löschen' }));

    await waitFor(() => expect(firestore.deleteDoc).toHaveBeenCalledTimes(1));
    expect(firestore.deleteDoc.mock.calls[0][0]).toEqual({ path: 'users/u1/workout_plans/w1' });
  });

  it('offers no client delete for a legacy Nutrition plan and never issues one', async () => {
    const { user, rowFor } = await openPlansTab();

    const nutritionRow = rowFor('Ernährung');
    expect(deleteControl(nutritionRow)).toBeNull();

    // Opening every other action on the row still never reaches deleteDoc.
    for (const button of within(nutritionRow).getAllByRole('button')) {
      await user.click(button);
      await user.keyboard('{Escape}');
    }

    expect(firestore.deleteDoc).not.toHaveBeenCalled();
    const deletedPaths = firestore.doc.mock.calls.map((call) => call.slice(1).join('/'));
    expect(deletedPaths.some((path) => path.includes('nutrition_plans'))).toBe(false);
  });

  it('shows a legacy Nutrition plan read-only through the tolerant adapter', async () => {
    const { user, rowFor } = await openPlansTab();

    await user.click(within(rowFor('Ernährung')).getAllByRole('button')[0]);
    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveTextContent('Haferflocken mit Beeren');
    expect(dialog).toHaveTextContent('420 cal');
    expect(dialog).toHaveTextContent('Linsen-Dal');
    // The malformed bucket is ignored, and the unreadable calorie value gets no badge.
    expect(dialog).not.toHaveTextContent('lunch');
    expect(within(dialog).getAllByText(/cal$/)).toHaveLength(1);
  });
});
