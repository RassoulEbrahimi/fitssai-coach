import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import { resetWorkoutFirestore, writes } from '@/test/mocks/workoutFirestore';

/*
  The real Dashboard, Bottom Nav, Focus Mode context, training session and
  TodayWorkoutCard, driven by keyboard. Only account/data sources are fixtures.
  The home view renders the card next to one ordinary background control, so
  containment is proven against something that really is focusable.
*/
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', uid: 'u1' } }) }));
vi.mock('@/hooks/useThrottledToast', () => ({ useThrottledToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/useSetTracking', () => ({
  useSetTracking: () => ({
    isSetCompleted: () => false,
    getCompletedSetsCount: () => 0,
    toggleSet: vi.fn(),
    isTogglingSet: false,
    isLoadingSets: false,
  }),
}));
vi.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ timerState: { remaining: 0, isActive: false }, startTimer: vi.fn(), skipTimer: vi.fn() }),
}));
vi.mock('@/hooks/useWorkoutHelpers', () => ({ useWorkoutHelpers: () => ({ getWeekContentWithFallback: () => ({}) }) }));
vi.mock('@/hooks/queries/useProfile', () => ({ useProfile: () => ({ data: { id: 'u1' }, isLoading: false }) }));
vi.mock('@/hooks/queries/useWorkoutPlan', () => ({ useWorkoutPlan: () => ({ data: null, isLoading: false }) }));
vi.mock('@/hooks/queries/useWorkoutLogs', () => ({ useWorkoutLogs: () => ({ data: [], isToggling: false }) }));
vi.mock('@/hooks/queries/useNutritionPlan', () => ({ useNutritionPlan: () => ({ data: null }) }));
vi.mock('@/hooks/useWeeklyActivity', () => ({ useWeeklyActivity: () => ({}) }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
// TodayWorkoutCard is imported statically below so its module graph loads at
// collection time, not inside the first test's lazy view import.
vi.mock('@/views/HomeView', () => ({
  default: () => (
    <>
      <button type="button">Hintergrund-Aktion</button>
      <TodayWorkoutCard {...CARD_PROPS} />
    </>
  ),
}));

import TodayWorkoutCard from '@/components/TodayWorkoutCard';
import Dashboard from '@/components/Dashboard';
import { TrainingProvider } from '@/contexts/TrainingContext';
import { FocusModeProvider } from '@/contexts/FocusModeContext';
import { PreferencesProvider } from '@/contexts/PreferencesContext';
import { ThemeProvider } from '@/hooks/useTheme';

const CARD_PROPS = {
  selectedDate: new Date('2025-12-10T12:00:00'),
  weekKey: 'Week 1',
  dayIndex: 0,
  workoutPlan: { id: 'plan1', created_at: '2025-12-10T08:00:00Z', content: { name: 'Test Workout' } },
  completionMap: {},
  isLoading: false,
  toggleExercise: vi.fn(),
  isToggling: false,
};
const SESSION_STORAGE_KEY = 'fitssai.training.session:u1';
const WORKOUT_STORAGE_KEY = 'fitssai.training.cache:u1';
const SEEDED_EXERCISES = [
  { id: 'e1', name: 'Bankdrücken', sets: 2, reps: '10', rest: '90s', weight: '', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 0 },
];

let queryClient: QueryClient;
const mount = () => render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider><PreferencesProvider><FocusModeProvider><TrainingProvider>
      <Dashboard />
    </TrainingProvider></FocusModeProvider></PreferencesProvider></ThemeProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  resetWorkoutFirestore();
  localStorage.clear();
  localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(SEEDED_EXERCISES));
  history.replaceState(null, '', '#/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  await new Promise(requestAnimationFrame);
  queryClient.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '#/');
});

// While the summary is open Radix aria-hides everything else, so lookups of
// Focus Mode itself include hidden elements.
const focusMode = () => screen.queryByRole('dialog', { name: 'Trainings-Fokusmodus', hidden: true });
const activeElement = () => document.activeElement as HTMLElement;
const storedSession = () => localStorage.getItem(SESSION_STORAGE_KEY);

const setup = async () => {
  const user = userEvent.setup();
  mount();
  // The home view is lazy; allow for a loaded CI worker before it resolves.
  await screen.findByRole('button', { name: 'Vollbild' }, { timeout: 10_000 });
  return user;
};

/** Focus a control and activate it from the keyboard. */
const press = async (user: ReturnType<typeof userEvent.setup>, name: string | RegExp) => {
  const button = await screen.findByRole('button', { name });
  button.focus();
  await user.keyboard('{Enter}');
};

const enterViaFullscreen = async (user: ReturnType<typeof userEvent.setup>) => {
  await press(user, 'Vollbild');
  await waitFor(() => expect(focusMode()).not.toBeNull());
};

const startTraining = async (user: ReturnType<typeof userEvent.setup>) => {
  await press(user, /Training starten/i);
  await waitFor(() => expect(focusMode()).not.toBeNull());
  await screen.findByRole('button', { name: /^Training beenden/i });
};

describe('Focus Mode keyboard modality', () => {
  it('moves focus onto the exit control when entered from "Vollbild"', async () => {
    const user = await setup();
    await enterViaFullscreen(user);

    const dialog = focusMode()!;
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const exit = within(dialog).getByRole('button', { name: 'Vollbild beenden' });
    expect(activeElement()).toBe(exit);
  });

  it('keeps Tab and Shift+Tab inside Focus Mode and wraps at both ends', async () => {
    const user = await setup();
    await enterViaFullscreen(user);
    const dialog = focusMode()!;
    const exit = within(dialog).getByRole('button', { name: 'Vollbild beenden' });
    const start = within(dialog).getByRole('button', { name: /Training starten/i });

    // Pre-start Focus Mode has exactly two stops: exit, then Start.
    await user.keyboard('{Tab}');
    expect(activeElement()).toBe(start);
    await user.keyboard('{Tab}');
    expect(activeElement()).toBe(exit);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(activeElement()).toBe(start);

    for (let i = 0; i < 6; i++) {
      await user.keyboard(i % 2 ? '{Shift>}{Tab}{/Shift}' : '{Tab}');
      expect(dialog.contains(activeElement())).toBe(true);
    }
    expect(activeElement()).not.toBe(screen.getByRole('button', { name: 'Hintergrund-Aktion' }));
  });

  it('keeps Tab contained in the started workout as well', async () => {
    const user = await setup();
    await startTraining(user);
    const dialog = focusMode()!;
    const stops = new Set<Element>();
    for (let i = 0; i < 12; i++) {
      await user.keyboard('{Tab}');
      expect(dialog.contains(activeElement())).toBe(true);
      stops.add(activeElement());
    }
    // It really cycles (exit, exercise, sets, finish), not sticks on one control.
    expect(stops.size).toBeGreaterThan(2);
  });

  it('pulls focus back when it lands on background content', async () => {
    const user = await setup();
    await enterViaFullscreen(user);

    screen.getByRole('button', { name: 'Hintergrund-Aktion' }).focus();

    expect(activeElement()).toBe(within(focusMode()!).getByRole('button', { name: 'Vollbild beenden' }));
  });

  it('removes the Bottom Navigation from the document while active and brings it back after', async () => {
    const user = await setup();
    const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    expect(within(nav).getAllByRole('button').length).toBeGreaterThan(0);

    await enterViaFullscreen(user);
    expect(screen.queryByRole('navigation', { name: 'Hauptnavigation', hidden: true })).toBeNull();
    expect(document.getElementById('navigation')).toBeNull();
    const reachable = Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [tabindex]'))
      .filter((el) => el.tabIndex >= 0 && !focusMode()!.contains(el))
      .map((el) => el.getAttribute('aria-label') ?? el.textContent);
    // Only the fixture remains outside, and the containment tests prove it is unreachable.
    expect(reachable).toEqual(['Hintergrund-Aktion']);

    await user.keyboard('{Escape}');
    expect(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument();
  });

  it.each(['Escape', 'exit button'])('exits via %s and returns focus to the card\'s "Vollbild" control', async (how) => {
    const user = await setup();
    await enterViaFullscreen(user);

    if (how === 'Escape') await user.keyboard('{Escape}');
    else await user.keyboard('{Enter}'); // focus is already on "Vollbild beenden"

    await waitFor(() => expect(focusMode()).toBeNull());
    expect(activeElement()).toBe(screen.getByRole('button', { name: 'Vollbild' }));
    expect(screen.getByRole('button', { name: /Training starten/i })).toBeInTheDocument();
    expect(storedSession()).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it('restores focus to "Vollbild" after "Training starten" entered Focus Mode, keeping the session', async () => {
    const user = await setup();
    await startTraining(user);
    expect(activeElement()).toBe(within(focusMode()!).getByRole('button', { name: 'Vollbild beenden' }));
    const session = storedSession();
    expect(session).not.toBeNull();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(focusMode()).toBeNull());
    const fullscreen = screen.getByRole('button', { name: 'Vollbild' });
    expect(activeElement()).toBe(fullscreen);
    expect(fullscreen.isConnected).toBe(true);
    // Escape leaves the presentation only: still training, nothing saved.
    expect(screen.getByRole('button', { name: /^Training beenden/i })).toBeInTheDocument();
    expect(storedSession()).toBe(session);
    expect(writes).toHaveLength(0);
  });

  it('keeps focus in Focus Mode when training is started from inside it', async () => {
    const user = await setup();
    await enterViaFullscreen(user);
    await press(user, /Training starten/i);
    await screen.findByRole('button', { name: /^Training beenden/i });

    expect(activeElement()).toBe(within(focusMode()!).getByRole('button', { name: 'Vollbild beenden' }));
  });

  it('lets Escape close only the nested summary, then exits Focus Mode on a second Escape', async () => {
    const user = await setup();
    await startTraining(user);
    const session = storedSession();

    await press(user, /^Training beenden/i);
    const summary = await screen.findByRole('dialog', { name: 'Training beendet?' });
    await waitFor(() => expect(summary.contains(activeElement())).toBe(true));
    // The summary's own trap owns Tab while it is open.
    await user.keyboard('{Tab}');
    expect(summary.contains(activeElement())).toBe(true);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Training beendet?' })).toBeNull());
    expect(focusMode()).not.toBeNull();
    const finish = within(focusMode()!).getByRole('button', { name: /^Training beenden/i });
    await waitFor(() => expect(activeElement()).toBe(finish));
    expect(storedSession()).toBe(session);
    expect(writes).toHaveLength(0);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(focusMode()).toBeNull());
    expect(activeElement()).toBe(screen.getByRole('button', { name: 'Vollbild' }));
    expect(storedSession()).toBe(session);
    expect(writes).toHaveLength(0);
  });

  it('does not strand focus in the removed portal after a successful finish closes Focus Mode', async () => {
    const user = await setup();
    await startTraining(user);
    await press(user, /^Training beenden/i);
    await screen.findByRole('dialog', { name: 'Training beendet?' });

    await press(user, /Training speichern & beenden/i);

    await waitFor(() => expect(storedSession()).toBeNull());
    await waitFor(() => expect(focusMode()).toBeNull());
    const fullscreen = screen.getByRole('button', { name: 'Vollbild' });
    await waitFor(() => expect(activeElement()).toBe(fullscreen));
    // Radix runs its close-autofocus on a timer; it must not undo the restore.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeElement()).toBe(fullscreen);
    expect(activeElement().isConnected).toBe(true);
    expect(writes).toHaveLength(1);
  });
});
