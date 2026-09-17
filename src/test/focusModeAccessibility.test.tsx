import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import { resetWorkoutFirestore, rows, writes } from '@/test/mocks/workoutFirestore';

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
const persistSet = vi.hoisted(() => vi.fn());
const persistPerformance = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useSetTracking', () => ({
  useSetTracking: () => ({
    isSetCompleted: () => false,
    getCompletedSetsCount: () => 0,
    getActualPerformance: () => undefined,
    toggleSet: vi.fn(),
    toggleSetAsync: persistSet,
    updateSetPerformanceAsync: persistPerformance,
    whenSetWritesSettled: vi.fn().mockResolvedValue({ failed: 0 }),
    isTogglingSet: false,
    isLoadingSets: false,
  }),
}));
// A started workout reads its exercises from the plan day its session is bound
// to, so the plan reader serves the seeded exercise on Week 1, day 0 - the day
// CARD_PROPS starts.
vi.mock('@/hooks/useWorkoutHelpers', () => ({
  useWorkoutHelpers: () => ({
    getWeekContentWithFallback: (weekKey: string) =>
      weekKey === 'Week 1' ? [{ day: 'Tag 1', exercises: SEEDED_EXERCISES }] : [],
  }),
}));
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
  persistSet.mockReset().mockResolvedValue({ success: true });
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
    const summary = await screen.findByRole('dialog', { name: 'Training abschließen?' });
    await waitFor(() => expect(summary.contains(activeElement())).toBe(true));
    // The summary's own trap owns Tab while it is open.
    await user.keyboard('{Tab}');
    expect(summary.contains(activeElement())).toBe(true);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Training abschließen?' })).toBeNull());
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
    await screen.findByRole('dialog', { name: 'Training abschließen?' });

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

describe('session status in Focus Mode and on the Dashboard (TRAINING-UI-04)', () => {
  const statusBlocks = () => document.querySelectorAll<HTMLElement>('.workout-session-status');
  const sessionProgress = () => screen.getByRole('progressbar', { name: 'Trainingsfortschritt' });
  const elapsed = () => statusBlocks()[0].querySelector('time')!;
  const count = () => statusBlocks()[0].querySelector('.workout-session-count')!;

  it('shows one running clock and one progress bar in both modes, without resetting either', async () => {
    const now = vi.spyOn(Date, 'now');
    const startedAt = Date.parse('2025-12-10T12:00:00');
    now.mockReturnValue(startedAt);
    const user = await setup();
    await startTraining(user);

    // Focus Mode: the status block sits inside the dialog.
    expect(statusBlocks()).toHaveLength(1);
    expect(focusMode()!.contains(statusBlocks()[0])).toBe(true);
    expect(within(statusBlocks()[0]).getByText('Training läuft')).toBeVisible();
    expect(count()).toHaveTextContent('0/2 Sätze');
    expect(sessionProgress()).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getAllByRole('progressbar')).toEqual([sessionProgress()]);
    now.mockReturnValue(startedAt + 125_000);
    await waitFor(() => expect(elapsed()).toHaveTextContent('02:05'), { timeout: 2500 });

    // Dashboard: the same session, time and progress, outside any dialog.
    await press(user, 'Vollbild beenden');
    await waitFor(() => expect(focusMode()).toBeNull());
    expect(statusBlocks()).toHaveLength(1);
    expect(statusBlocks()[0].closest('[role=dialog]')).toBeNull();
    expect(elapsed()).toHaveTextContent('02:05');
    expect(count()).toHaveTextContent('0/2 Sätze');
    expect(sessionProgress()).toHaveAttribute('aria-valuenow', '0');
    now.mockReturnValue(startedAt + 3_725_000);
    await waitFor(() => expect(elapsed()).toHaveTextContent('62:05'), { timeout: 2500 });

    // And back: the clock keeps counting from where it was.
    await press(user, 'Vollbild');
    await waitFor(() => expect(focusMode()).not.toBeNull());
    expect(statusBlocks()).toHaveLength(1);
    expect(focusMode()!.contains(statusBlocks()[0])).toBe(true);
    expect(elapsed()).toHaveTextContent('62:05');
    expect(JSON.parse(storedSession()!).startedAt).toBe(startedAt);
  });
});

it('rest sheet owns keyboard focus and Escape, and the timer survives Focus Mode transitions', async () => {
  const user = await setup();
  await startTraining(user);
  const set = screen.getByRole('checkbox', { name: /Satz 1/ });
  await user.click(set);
  const sheet = await screen.findByRole('dialog', { name: 'Pause' });
  await waitFor(() => expect(sheet.contains(activeElement())).toBe(true));
  const saved = localStorage.getItem('fitssai.training.rest:u1');
  expect(saved).not.toBeNull();
  for (let i = 0; i < 7; i++) {
    await user.tab();
    expect(sheet.contains(activeElement())).toBe(true);
  }
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pause' })).toBeNull());
  expect(focusMode()).not.toBeNull();
  expect(localStorage.getItem('fitssai.training.rest:u1')).toBe(saved);
  const inline = screen.getByRole('button', { name: 'Pause für Satz 1 öffnen' });
  await waitFor(() => expect(inline).toHaveFocus());
  await user.keyboard('{Escape}');
  await waitFor(() => expect(focusMode()).toBeNull());
  expect(localStorage.getItem('fitssai.training.rest:u1')).toBe(saved);
  await enterViaFullscreen(user);
  await user.click(screen.getByRole('button', { name: 'Pause für Satz 1 öffnen' }));
  expect(await screen.findByRole('dialog', { name: 'Pause' })).toBeInTheDocument();
  expect(localStorage.getItem('fitssai.training.rest:u1')).toBe(saved);
});

it.each(['running', 'paused'])('guidance preserves Focus Mode, session and %s rest with useful focus restoration', async status => {
  const user = await setup();
  await startTraining(user);
  await user.click(screen.getByRole('checkbox', { name: /Satz 1/ }));
  await screen.findByRole('dialog', { name: 'Pause' });
  if (status === 'paused') await user.click(screen.getByRole('button', { name: 'Timer pausieren' }));
  await user.click(screen.getByRole('button', { name: 'Pause schließen' }));
  const session = storedSession();
  const rest = localStorage.getItem('fitssai.training.rest:u1');
  const calls = persistSet.mock.calls.length;
  const info = screen.getByRole('button', { name: 'Informationen zu Bankdrücken' });
  await user.click(info);
  const dialog = screen.getByRole('dialog', { name: 'Bankdrücken' });
  expect(focusMode()).not.toBeNull();
  for (let i = 0; i < 7; i++) {
    await user.tab();
    expect(dialog.contains(activeElement())).toBe(true);
  }
  await user.keyboard('{Escape}');
  await waitFor(() => expect(info).toHaveFocus());
  expect(focusMode()).not.toBeNull();
  expect(storedSession()).toBe(session);
  expect(localStorage.getItem('fitssai.training.rest:u1')).toBe(rest);
  expect(persistSet).toHaveBeenCalledTimes(calls);
  expect(writes).toHaveLength(0);
});

it('a failed older completion cannot cancel a newer rest; its own failure can', async () => {
  const user = await setup();
  await startTraining(user);
  let rejectA!: (error: Error) => void;
  let rejectB!: (error: Error) => void;
  persistSet.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectA = reject; }));
  await user.click(screen.getByRole('checkbox', { name: /Satz 1/ }));
  await user.click(screen.getByRole('button', { name: 'Pause schließen' }));
  persistSet.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectB = reject; }));
  await user.click(screen.getByRole('checkbox', { name: /Satz 2/ }));
  const saved = localStorage.getItem('fitssai.training.rest:u1');
  expect(JSON.parse(saved!).state.setNumber).toBe(2);
  await act(async () => rejectA(new Error('Older write failed')));
  expect(localStorage.getItem('fitssai.training.rest:u1')).toBe(saved);
  expect(screen.getByRole('dialog', { name: 'Pause' })).toBeInTheDocument();
  await act(async () => rejectB(new Error('Current write failed')));
  expect(localStorage.getItem('fitssai.training.rest:u1')).toBeNull();
  expect(screen.queryByRole('dialog', { name: 'Pause' })).toBeNull();
});

it('keeps a copied previous value as an unsaved draft through leaving and re-entering Focus Mode', async () => {
  // Last week's Bankdrücken, recorded against an older plan of its own.
  rows.set('users/u1/workout_plans/old-plan', {
    content: { 'Week 1': [{ day: 'Tag 1', exercises: [{ name: 'Bankdrücken', sets: 2, reps: '10' }] }] },
  });
  rows.set('users/u1/workout_logs/last-bench', {
    planId: 'old-plan', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 0, workoutDay: '2025-12-03', completed: true,
  });
  rows.set('users/u1/workout_logs/last-bench/workout_set_logs/s1', {
    setNumber: 1, completed: true, performanceSource: 'user-recorded', repsCompleted: 10, weightUsed: 52.5,
  });
  const user = await setup();
  await startTraining(user);
  persistPerformance.mockReset().mockResolvedValue({ success: true });
  const reps = () => screen.getByRole('textbox', { name: 'Wiederholungen für Satz 1' });
  const weight = () => screen.getByRole('textbox', { name: 'Gewicht für Satz 1 in kg' });

  const copy = await within(focusMode()!).findByRole('button', { name: /^Übernehmen für Satz 1: Letztes Mal 10 Wdh\. · 52,5 kg$/ });
  await user.click(copy);
  expect(reps()).toHaveValue('10');
  expect(weight()).toHaveValue('52,5');
  expect(copy).toHaveFocus();

  await user.keyboard('{Escape}');
  await waitFor(() => expect(focusMode()).toBeNull());
  expect(reps()).toHaveValue('10');
  expect(weight()).toHaveValue('52,5');

  await enterViaFullscreen(user);
  expect(within(focusMode()!).getByRole('textbox', { name: 'Wiederholungen für Satz 1' })).toHaveValue('10');
  expect(within(focusMode()!).getByRole('textbox', { name: 'Gewicht für Satz 1 in kg' })).toHaveValue('52,5');
  expect(persistPerformance).not.toHaveBeenCalled();
  expect(persistSet).not.toHaveBeenCalled();
  expect(localStorage.getItem('fitssai.training.rest:u1')).toBeNull();
  expect(writes).toHaveLength(0);
});

it('records reps and weight from the keyboard inside Focus Mode, without ticking the set or starting rest', async () => {
  const user = await setup();
  await startTraining(user);
  persistPerformance.mockReset().mockResolvedValue({ success: true });
  const dialog = focusMode()!;
  const reps = within(dialog).getByRole('textbox', { name: 'Wiederholungen für Satz 1' });
  const weight = within(dialog).getByRole('textbox', { name: 'Gewicht für Satz 1 in kg' });

  await user.click(reps);
  await user.keyboard('8');
  await user.tab();

  expect(weight).toHaveFocus();
  expect(persistPerformance).toHaveBeenLastCalledWith(expect.objectContaining({
    planId: 'plan1', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 0, setNumber: 1, reps: 8,
  }));

  await user.keyboard('52,5{Enter}');
  expect(persistPerformance).toHaveBeenLastCalledWith(expect.objectContaining({ setNumber: 1, weightKg: 52.5 }));
  expect(persistPerformance.mock.calls.at(-1)?.[0]).not.toHaveProperty('reps');
  expect(weight).toHaveFocus();

  await user.tab();
  expect(within(dialog).getByRole('checkbox', { name: /Satz 1/ })).toHaveFocus();
  expect(dialog.contains(activeElement())).toBe(true);
  expect(focusMode()).not.toBeNull();
  expect(persistSet).not.toHaveBeenCalled();
  expect(localStorage.getItem('fitssai.training.rest:u1')).toBeNull();
});

/*
  TRAINING-UI-05/06: the one finish action rides along with the workout, in and
  out of Focus Mode, and stays below every layer that opens over it.
*/
describe('Finish action across Focus Mode and overlays', () => {
  // Includes controls Radix has aria-hidden while a dialog is open.
  const finishControls = () => screen.queryAllByRole('button', { name: /^Training beenden$/, hidden: true });
  const repsField = () => screen.getByRole('textbox', { name: 'Wiederholungen für Satz 1' });

  it('keeps exactly one finish action, and unsaved drafts, through leaving and re-entering Focus Mode', async () => {
    const user = await setup();
    await startTraining(user);
    expect(finishControls()).toHaveLength(1);
    expect(focusMode()!.contains(finishControls()[0])).toBe(true);

    // A typed value that has not been committed yet (no blur, no Enter).
    fireEvent.change(repsField(), { target: { value: '9' } });
    fireEvent.click(within(focusMode()!).getByRole('button', { name: 'Vollbild beenden' }));
    await waitFor(() => expect(focusMode()).toBeNull());

    expect(finishControls()).toHaveLength(1);
    // Back on the Dashboard, still the last thing in the running session.
    expect(finishControls()[0].closest('.workout-session')).not.toBeNull();
    expect(repsField()).toHaveValue('9');

    fireEvent.click(screen.getByRole('button', { name: 'Vollbild' }));
    await waitFor(() => expect(focusMode()).not.toBeNull());

    expect(finishControls()).toHaveLength(1);
    expect(focusMode()!.contains(finishControls()[0])).toBe(true);
    expect(repsField()).toHaveValue('9');
    expect(persistPerformance).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('keeps the finish action out of reach while the rest sheet is open', async () => {
    const user = await setup();
    await startTraining(user);
    const session = storedSession();

    // Completing a set starts rest and opens the sheet.
    await user.click(within(focusMode()!).getByRole('checkbox', { name: /^Satz 1:/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Pause' });

    // The sheet is modal: the finish action leaves the accessibility tree and takes no pointer input.
    expect(screen.queryByRole('button', { name: /^Training beenden$/ })).toBeNull();
    expect(finishControls()).toHaveLength(1);
    await expect(user.click(finishControls()[0])).rejects.toThrow(/pointer-events/);
    expect(screen.queryByRole('dialog', { name: 'Training abschließen?' })).toBeNull();
    expect(sheet).toBeInTheDocument();
    expect(storedSession()).toBe(session);
    expect(writes).toHaveLength(0);
  });

  it('opens the summary above the finish action, which then takes no input and finishes nothing', async () => {
    const user = await setup();
    await startTraining(user);
    const session = storedSession();

    const layer = focusMode()!;
    await press(user, /^Training beenden/i);
    const summary = await screen.findByRole('dialog', { name: 'Training abschließen?' });

    expect(screen.queryByRole('button', { name: /^Training beenden$/ })).toBeNull();
    expect(finishControls()).toHaveLength(1);
    await expect(user.click(finishControls()[0])).rejects.toThrow(/pointer-events/);
    expect(screen.getAllByRole('dialog', { name: 'Training abschließen?' })).toEqual([summary]);
    expect(within(summary).getByRole('button', { name: /Training speichern & beenden/i })).toBeEnabled();
    // Opening the summary is a review step only.
    expect(storedSession()).toBe(session);
    expect(writes).toHaveLength(0);
    // Focus Mode stays open underneath, with the action still inside it.
    expect(layer.isConnected).toBe(true);
    expect(layer.contains(finishControls()[0])).toBe(true);
  });
});
