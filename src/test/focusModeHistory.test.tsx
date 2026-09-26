import React, { useCallback, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';

/*
  TRAINING-E2E-FIX-01: Focus Mode owns one browser-history level.

  The shipped Dashboard, tab router, Trainingsplan view and navigation, Focus
  Mode, training session and card run against the in-memory Firestore
  boundary. Only account identity, telemetry, toasts, "today", the Home view
  and the plan/log queries feeding the Dashboard are fixtures.
*/

const today = vi.hoisted(() => ({ value: '2026-09-08' }));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', uid: 'u1' } }) }));
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({
  toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn(),
  toastSuccess: vi.fn(), toastWarning: vi.fn(), toastInfo: vi.fn(),
}));
vi.mock('@/hooks/useThrottledToast', () => ({ useThrottledToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/useBerlinToday', () => ({ useBerlinToday: () => today.value }));
vi.mock('@/hooks/queries/useProfile', () => ({ useProfile: () => ({ data: { id: 'u1' }, isLoading: false }) }));
vi.mock('@/hooks/queries/useWorkoutPlan', () => ({ useWorkoutPlan: () => ({ data: PLAN, isLoading: false }) }));
vi.mock('@/hooks/queries/useWorkoutLogs', () => ({ useWorkoutLogs: () => ({ data: [], toggleDay: vi.fn(), isToggling: false }) }));
vi.mock('@/hooks/queries/useLegacyNutritionPlan', () => ({ useLegacyNutritionPlan: () => ({ data: null }) }));
vi.mock('@/hooks/useWeeklyActivity', () => ({ useWeeklyActivity: () => ({}) }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/views/HomeView', () => ({ default: () => <h1>Home fixture</h1> }));

import Dashboard from '@/components/Dashboard';
import WorkoutView from '@/views/WorkoutView';
import { TrainingProvider } from '@/contexts/TrainingContext';
import { FocusModeProvider, useFocusMode } from '@/contexts/FocusModeContext';
import { PreferencesProvider } from '@/contexts/PreferencesContext';
import { ThemeProvider } from '@/hooks/useTheme';
import { isFocusModeEntry } from '@/hooks/useFocusModeHistory';
import type { WorkoutPlan } from '@/lib/types';
import { getWorkoutDate, getWorkoutWeekDay } from '@/lib/workoutDateUtils';
import { firestore, resetWorkoutFirestore, rows, writes } from '@/test/mocks/workoutFirestore';

const PLAN_ID = 'plan-1';
const SESSION_KEY = 'fitssai.training.session:u1';
/** Tuesday of Week 1, midday in Berlin. */
const TUESDAY_NOW = Date.parse('2026-09-08T10:00:00Z');
const TUESDAY_BINDING = { planId: PLAN_ID, weekKey: 'Week 1', dayIndex: 1, workoutDay: '2026-09-08' };

const exercise = (name: string, sets: number, reps: string) => ({ name, sets, reps, rest: '60s' });
const WEEK = [
  { day: 'Montag', exercises: [exercise('Kniebeugen', 3, '8')] },
  { day: 'Push A', exercises: [exercise('Bankdrücken', 4, '12')] },
  { day: 'Mittwoch', exercises: [] },
  { day: 'Donnerstag', exercises: [exercise('Kreuzheben', 3, '5')] },
  { day: 'Freitag', exercises: [] },
  { day: 'Samstag', exercises: [] },
  { day: 'Sonntag', exercises: [] },
];
const PLAN = {
  id: PLAN_ID,
  user_id: 'u1',
  created_at: '2026-09-07T08:00:00Z',
  content: { 'Week 1': WEEK, 'Week 2': WEEK, 'Week 3': WEEK, 'Week 4': WEEK },
} as unknown as WorkoutPlan;

let queryClient: QueryClient;

/** The global Focus Mode flag, as the Dashboard shell reads it. */
const FocusProbe = () => <output aria-label="Fokusmodus-Status">{String(useFocusMode().isFocusMode)}</output>;
const globalFocusMode = () => screen.getByRole('status', { name: 'Fokusmodus-Status', hidden: true }).textContent;

/** Dashboard's part for the Trainingsplan tab alone. */
const WorkoutScreen = () => {
  const [selectedDate, setSelectedDate] = useState(new Date(`${today.value}T12:00:00`));
  const getWeekKeyForDate = useCallback((date: Date) => getWorkoutWeekDay(PLAN.created_at, date).weekKey, []);
  const getDateFor = useCallback((weekKey: string, dayIndex: number) => getWorkoutDate(PLAN.created_at, weekKey, dayIndex), []);
  const never = useCallback(() => false, []);
  const noop = useCallback(() => {}, []);
  return (
    <WorkoutView
      workoutPlan={PLAN}
      workoutLogs={[]}
      completingWorkout={false}
      selectedDate={selectedDate}
      isDayCompleted={never}
      isDayInFuture={never}
      isTodayInWeekDay={never}
      getDateFor={getDateFor}
      getWeekTitle={(weekKey) => weekKey}
      getWeeklyProgress={() => ({ completed: 0, total: 0 })}
      getWeekKeyForDate={getWeekKeyForDate}
      toggleDayComplete={noop}
      handleDateChange={setSelectedDate}
    />
  );
};

/** The Trainingsplan tab, which can be taken away while the providers stay. */
const TabHost = () => {
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <FocusProbe />
      <button type="button" onClick={() => setMounted(false)}>Tab entfernen</button>
      {mounted && <WorkoutScreen />}
    </>
  );
};

const mountTab = () => render(
  <QueryClientProvider client={queryClient}>
    <FocusModeProvider><TrainingProvider><TabHost /></TrainingProvider></FocusModeProvider>
  </QueryClientProvider>
);

const mountDashboard = () => render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider><PreferencesProvider><FocusModeProvider><TrainingProvider>
      <FocusProbe />
      <Dashboard />
    </TrainingProvider></FocusModeProvider></PreferencesProvider></ThemeProvider>
  </QueryClientProvider>
);

const storedSession = () => JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
const stack = () => (history.state as Record<string, { stack?: unknown[] }> | null)?.trainingsplanV2?.stack ?? [];
const todayCard = () => screen.findByRole('region', { name: 'Heute' });
const focusMode = () => screen.queryByRole('dialog', { name: 'Trainings-Fokusmodus', hidden: true });
const bottomNav = () => screen.queryByRole('navigation', { name: 'Hauptnavigation' });
const browserBack = () => act(() => { history.back(); });
const onMain = async () => {
  await todayCard();
  expect(screen.getByRole('heading', { level: 1, name: 'Trainingsplan' })).toBeInTheDocument();
};
const onPlan = () => screen.findByRole('heading', { level: 1, name: '4-Wochen-Plan' });
const onTuesday = () => screen.findByRole('heading', { level: 1, name: 'Push A' });

const openFocus = async () => {
  await waitFor(() => expect(focusMode()).not.toBeNull());
  // Our own entry is in place before anything is asserted about it.
  await waitFor(() => expect(isFocusModeEntry(history.state)).toBe(true));
  expect(globalFocusMode()).toBe('true');
};
const expectClosed = async () => {
  await waitFor(() => expect(focusMode()).toBeNull());
  await waitFor(() => expect(isFocusModeEntry(history.state)).toBe(false));
  expect(globalFocusMode()).toBe('false');
};
const startFromCard = async () => {
  fireEvent.click(within(await todayCard()).getByRole('button', { name: /Training starten/ }));
  await waitFor(() => expect(storedSession()).toMatchObject(TUESDAY_BINDING));
  await openFocus();
};
/** Plan Overview → today's Day Detail → start from its footer. */
const startFromTuesdayDetail = async () => {
  await todayCard();
  fireEvent.click(screen.getByRole('button', { name: /^Planübersicht öffnen/ }));
  await onPlan();
  fireEvent.click(screen.getByRole('button', { name: /^Di .*1 Übung/ }));
  await onTuesday();
  expect(stack()).toHaveLength(2);
  fireEvent.click(within(screen.getByTestId('day-detail-footer')).getByRole('button', { name: /Training starten/ }));
  await waitFor(() => expect(storedSession()).toMatchObject(TUESDAY_BINDING));
  await openFocus();
};

beforeEach(() => {
  resetWorkoutFirestore();
  localStorage.clear();
  today.value = '2026-09-08';
  history.replaceState(null, '', '#/workout');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  onlineManager.setOnline(true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TUESDAY_NOW);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  rows.set(`users/u1/workout_plans/${PLAN_ID}`, { content: PLAN.content, createdAt: new firestore.Timestamp(Date.parse(PLAN.created_at)) });
});
afterEach(async () => {
  await new Promise(requestAnimationFrame);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  queryClient.clear();
});

describe('browser Back closes Focus Mode first', () => {
  it('Home → Trainingsplan → Start → Focus → Back: Focus closes on the tab, nav returns, the workout runs on', async () => {
    history.replaceState(null, '', '#/');
    mountDashboard();
    await screen.findByRole('heading', { name: 'Home fixture' });
    fireEvent.click(within(bottomNav()!).getByRole('button', { name: 'Trainingsplan' }));
    await onMain();
    expect(window.location.hash).toBe('#/workout');

    await startFromCard();
    const session = storedSession();
    expect(bottomNav()).toBeNull();

    await browserBack();
    await expectClosed();
    // Still the Trainingsplan tab, with the shell's normal layout back.
    expect(window.location.hash).toBe('#/workout');
    await onMain();
    expect(bottomNav()).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Home fixture' })).toBeNull();
    // The workout is untouched: same session, running, nothing written.
    const card = await todayCard();
    expect(within(card).getByText(/Läuft/)).toBeInTheDocument();
    expect(storedSession()).toEqual(session);
    expect(writes).toHaveLength(0);

    // The next Back is the tab router's own again.
    await browserBack();
    expect(await screen.findByRole('heading', { name: 'Home fixture' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/');
    expect(storedSession()).toEqual(session);
  });

  it('Trainingsplan Main → Focus → Back leaves Main underneath, focus on the way back in', async () => {
    mountTab();
    await startFromCard();
    const session = storedSession();
    expect(stack()).toHaveLength(0);

    await browserBack();
    await expectClosed();
    await onMain();
    expect(stack()).toHaveLength(0);
    expect(window.location.hash).toBe('#/workout');
    await waitFor(() => expect(document.activeElement).toBe(
      within(screen.getByRole('region', { name: 'Heute' })).getByRole('button', { name: 'Fortsetzen' })
    ));
    expect(storedSession()).toEqual(session);
  });

  it('Plan Overview → Day Detail → Focus → Back returns to that same Day Detail', async () => {
    mountTab();
    await startFromTuesdayDetail();
    const session = storedSession();
    // The Focus Mode entry carries the Trainingsplan stack it was opened on.
    expect(stack()).toHaveLength(2);
    vi.mocked(window.scrollTo).mockClear();

    await browserBack();
    await expectClosed();
    await onTuesday();
    expect(stack()).toHaveLength(2);
    const resume = within(screen.getByTestId('day-detail-footer')).getByRole('button', { name: 'Fortsetzen' });
    // The Day Detail is uncovered, not re-entered: no scroll reset, focus on its action.
    await waitFor(() => expect(document.activeElement).toBe(resume));
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(storedSession()).toEqual(session);

    // The Trainingsplan's own Back walks on from there.
    await browserBack();
    await onPlan();
    expect(stack()).toHaveLength(1);
    await browserBack();
    await onMain();
    expect(storedSession()).toEqual(session);
  });
});

describe('an explicit exit leaves no Focus Mode entry behind', () => {
  it.each(['exit button', 'Escape'])('Focus → %s → the next Back is the Day Detail\'s own', async (how) => {
    mountTab();
    await startFromTuesdayDetail();
    const session = storedSession();

    if (how === 'Escape') fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    else fireEvent.click(within(focusMode()!).getByRole('button', { name: 'Vollbild beenden' }));
    await expectClosed();
    await onTuesday();
    expect(stack()).toHaveLength(2);

    // No invisible Focus Mode level: Back leaves the Day Detail at once.
    await browserBack();
    await onPlan();
    expect(stack()).toHaveLength(1);
    expect(globalFocusMode()).toBe('false');
    expect(storedSession()).toEqual(session);
  });

  it('closing and immediately resuming keeps exactly one Focus Mode level', async () => {
    mountTab();
    await startFromCard();
    fireEvent.click(within(focusMode()!).getByRole('button', { name: 'Vollbild beenden' }));
    // Resumed before the exit's own history step has landed.
    fireEvent.click(within(await todayCard()).getByRole('button', { name: 'Fortsetzen' }));
    await openFocus();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(focusMode()).not.toBeNull();
    expect(isFocusModeEntry(history.state)).toBe(true);

    await browserBack();
    await expectClosed();
    await onMain();
  });
});

describe('Focus Mode history ownership', () => {
  it('Resume while already in Focus adds no second history entry', async () => {
    mountTab();
    await startFromCard();
    const length = history.length;

    // The agenda row under Focus Mode resumes the same workout.
    fireEvent.click(screen.getByRole('button', { name: /^Di 8, .*läuft, fortsetzen$/, hidden: true }));
    fireEvent.click(screen.getByRole('button', { name: /^Di 8, .*läuft, fortsetzen$/, hidden: true }));
    await openFocus();
    expect(history.length).toBe(length);

    // One Back closes it; nothing else was stacked.
    await browserBack();
    await expectClosed();
    await onMain();
    expect(history.length).toBe(length);
  });

  it('the owner unmounting while open releases Focus Mode without moving the history or the workout', async () => {
    mountTab();
    await startFromTuesdayDetail();
    const session = storedSession();
    const length = history.length;
    const href = window.location.href;

    fireEvent.click(screen.getByRole('button', { name: 'Tab entfernen', hidden: true }));
    await waitFor(() => expect(globalFocusMode()).toBe('false'));
    expect(focusMode()).toBeNull();
    // The mark is dropped in place; the entry and the Trainingsplan stack stay.
    expect(isFocusModeEntry(history.state)).toBe(false);
    expect(stack()).toHaveLength(2);
    expect(history.length).toBe(length);
    expect(window.location.href).toBe(href);
    expect(storedSession()).toEqual(session);
    expect(writes).toHaveLength(0);
  });
});
