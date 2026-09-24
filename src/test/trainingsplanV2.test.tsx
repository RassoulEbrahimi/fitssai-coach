import React, { useCallback, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';

/*
  TRAINING-PLAN-V2-01: the Trainingsplan tab, day detail, plan overview and
  the editing compatibility surface, on the shipped Workout view, session
  context, Focus Mode and plan editors against the in-memory Firestore
  boundary. Only account identity, telemetry, toasts and "today" are fixtures.
*/

const today = vi.hoisted(() => ({ value: '2026-09-08' }));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', uid: 'u1' } }) }));
vi.mock('@/lib/telemetryClient', () => ({ logEvent, logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({
  toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn(),
  toastSuccess: vi.fn(), toastWarning: vi.fn(), toastInfo: vi.fn(),
}));
vi.mock('@/hooks/useThrottledToast', () => ({ useThrottledToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/useBerlinToday', () => ({ useBerlinToday: () => today.value }));

import WorkoutView from '@/views/WorkoutView';
import { TrainingProvider } from '@/contexts/TrainingContext';
import { FocusModeProvider } from '@/contexts/FocusModeContext';
import type { WorkoutLog, WorkoutPlan } from '@/lib/types';
import { getWorkoutDate, getWorkoutDateString, getWorkoutWeekDay } from '@/lib/workoutDateUtils';
import { firestore, resetWorkoutFirestore, rows } from '@/test/mocks/workoutFirestore';

const PLAN_ID = 'plan-1';
const PLAN_PATH = `users/u1/workout_plans/${PLAN_ID}`;
const SESSION_KEY = 'fitssai.training.session:u1';
/** Tuesday of Week 1, midday in Berlin. */
const TUESDAY_NOW = Date.parse('2026-09-08T10:00:00Z');
const LONG_NAME = 'Kreuzheben konventionell mit Pause am Boden und langem Namen';

const exercise = (name: string, sets: number, reps: string, rest = '60s') => ({ name, sets, reps, rest });
const WEEK = [
  { day: 'Montag', exercises: [exercise('Kniebeugen', 3, '8'), exercise('Rudern', 2, '10')] },
  { day: 'Push A', exercises: [exercise('Bankdrücken', 4, '12')] },
  { day: 'Mittwoch', exercises: [] },
  { day: 'Donnerstag', exercises: [exercise(LONG_NAME, 3, '5', '150s')] },
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
const TUESDAY_BINDING = { planId: PLAN_ID, weekKey: 'Week 1', dayIndex: 1, workoutDay: '2026-09-08' };
const MONDAY_BINDING = { planId: PLAN_ID, weekKey: 'Week 1', dayIndex: 0, workoutDay: '2026-09-07' };

const storedSession = () => JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
const planContent = () => (rows.get(PLAN_PATH)?.content ?? {}) as Record<string, typeof WEEK>;
const completedTuesday = (durationSec?: number) => [{
  id: 'day-session', workout_day: '2026-09-08', week_key: 'Week 1', day_index: 1,
  exercise_index: null, completed: true, duration_sec: durationSec ?? null, plan_id: PLAN_ID, user_id: 'u1',
}] as unknown as WorkoutLog[];

let queryClient: QueryClient;
const navHidden = vi.fn();

/** Dashboard's part: the selected date, the plan-to-date mapping and day completion from logs. */
const WorkoutScreen = ({ logs = [] }: { logs?: WorkoutLog[] }) => {
  const [selectedDate, setSelectedDate] = useState(new Date(`${today.value}T12:00:00`));
  const getWeekKeyForDate = useCallback((date: Date) => getWorkoutWeekDay(PLAN.created_at, date).weekKey, []);
  const getDateFor = useCallback((weekKey: string, dayIndex: number) => getWorkoutDate(PLAN.created_at, weekKey, dayIndex), []);
  const isDayCompleted = useCallback((weekKey: string, dayIndex: number) => {
    const day = getWorkoutDateString(PLAN.created_at, weekKey, dayIndex);
    return logs.some((log) => log.completed && log.workout_day === day);
  }, [logs]);
  const never = useCallback(() => false, []);
  const noop = useCallback(() => {}, []);
  return (
    <WorkoutView
      workoutPlan={PLAN}
      workoutLogs={logs}
      completingWorkout={false}
      selectedDate={selectedDate}
      isDayCompleted={isDayCompleted}
      isDayInFuture={never}
      isTodayInWeekDay={never}
      getDateFor={getDateFor}
      getWeekTitle={(weekKey) => weekKey}
      getWeeklyProgress={() => ({ completed: 0, total: 0 })}
      getWeekKeyForDate={getWeekKeyForDate}
      toggleDayComplete={noop}
      handleDateChange={setSelectedDate}
      onBottomNavHiddenChange={navHidden}
    />
  );
};

const mount = (logs?: WorkoutLog[]) => render(
  <QueryClientProvider client={queryClient}>
    <FocusModeProvider><TrainingProvider><WorkoutScreen logs={logs} /></TrainingProvider></FocusModeProvider>
  </QueryClientProvider>
);

const todayCard = () => screen.findByRole('region', { name: 'Heute' });
const focusMode = () => screen.queryByRole('dialog', { name: 'Trainings-Fokusmodus', hidden: true });
const footer = () => screen.getByTestId('day-detail-footer');
const row = (name: RegExp) => screen.getByRole('button', { name });
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  localStorage.clear();
  today.value = '2026-09-08';
  // Each case starts on a fresh Trainingsplan entry: no pushed screens carried over.
  history.replaceState(null, '', '#/workout');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  onlineManager.setOnline(true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TUESDAY_NOW);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  rows.set(PLAN_PATH, { content: PLAN.content, createdAt: new firestore.Timestamp(Date.parse(PLAN.created_at)) });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  queryClient.clear();
});

describe('Trainingsplan main', () => {
  it('shows Today, a vertical week agenda, next week and the plan row - and none of the legacy browsing UI', async () => {
    mount();
    const card = await todayCard();
    expect(within(card).getByText('Heute · Di 8')).toBeInTheDocument();
    expect(within(card).getByText('Geplant')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Push A' })).toBeInTheDocument();
    expect(within(card).getByText('1 Übung · 4 Sätze')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Training starten/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Ansehen' })).toBeInTheDocument();

    // Agenda: open (past), today, rest, upcoming, merged future rest.
    expect(row(/^Mo 7, .*nicht erledigt, 2 Übungen$/)).toBeInTheDocument();
    expect(row(/^Di 8, Push A, heute$/)).toBeInTheDocument();
    expect(row(/^Do 10, .*1 Übung$/)).toBeInTheDocument();
    expect(screen.getByText('Mi 9').closest('button')).toBeNull();
    expect(screen.getByText('Fr–So').closest('button')).toBeNull();
    expect(screen.getByText('Ruhetage')).toBeInTheDocument();
    expect(screen.getByText('Woche 1 · 0/3')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Nächste Woche.*Mo 14/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4-Wochen-Plan.*Woche 1 von 4 · 3 Tage\/Woche/ })).toBeInTheDocument();

    // No calendar strip, plan stepper, accordion or inline editing on the tab.
    expect(document.querySelector('#weekCard')).toBeNull();
    expect(screen.queryByText(/Tage abgeschlossen/)).toBeNull();
    expect(document.querySelector('[aria-pressed]')).toBeNull();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/Automatisch ausfüllen|Auto-ausfüllen/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vollbild' })).toBeNull();
  });

  it('starts through the card: binds today, opens the running workout, and resumes that same session', async () => {
    mount();
    fireEvent.click(within(await todayCard()).getByRole('button', { name: /Training starten/ }));

    await waitFor(() => expect(storedSession()).toMatchObject(TUESDAY_BINDING));
    const startedAt = storedSession().startedAt;
    await waitFor(() => expect(focusMode()).not.toBeNull());
    expect(within(focusMode()!).getByRole('button', { name: /^Training beenden/ })).toBeInTheDocument();

    // Leave the workout: the tab shows it running, with its own progress.
    fireEvent.click(within(focusMode()!).getByRole('button', { name: 'Vollbild beenden' }));
    await waitFor(() => expect(focusMode()).toBeNull());
    const card = await todayCard();
    expect(within(card).getByText(/Läuft/)).toBeInTheDocument();
    // Focus lands on the action that brings the workout back.
    await waitFor(() => expect(document.activeElement).toBe(within(card).getByRole('button', { name: 'Fortsetzen' })));
    expect(within(card).getByRole('progressbar', { name: 'Trainingsfortschritt' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByRole('button', { name: /Training starten/ })).toBeNull();

    // Fortsetzen and the running day's agenda row both reopen the same session.
    fireEvent.click(within(card).getByRole('button', { name: 'Fortsetzen' }));
    await waitFor(() => expect(focusMode()).not.toBeNull());
    fireEvent.click(within(focusMode()!).getByRole('button', { name: 'Vollbild beenden' }));
    await waitFor(() => expect(focusMode()).toBeNull());
    fireEvent.click(row(/^Di 8, .*läuft, fortsetzen$/));
    await waitFor(() => expect(focusMode()).not.toBeNull());
    expect(storedSession()).toEqual({ version: 1, ...TUESDAY_BINDING, startedAt });
  });

  it('lets a running session from another day take precedence over today', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ version: 1, startedAt: TUESDAY_NOW - 600_000, ...MONDAY_BINDING }));
    mount();
    const card = await todayCard();
    expect(within(card).getByText('Training · Mo 7')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Fortsetzen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Training starten/ })).toBeNull();
    expect(row(/^Mo 7, .*läuft, fortsetzen$/)).toBeInTheDocument();

    // Today's own detail cannot start a second workout either.
    fireEvent.click(row(/^Di 8,/));
    expect(within(footer()).getByRole('button', { name: 'Training läuft bereits' })).toBeDisabled();
    expect(storedSession()).toMatchObject(MONDAY_BINDING);
  });

  it("shows today's completion with its stored duration, and starts nothing", async () => {
    mount(completedTuesday(3840));
    const card = await todayCard();
    expect(within(card).getByText('Erledigt')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Push A · 64 Min' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Training starten/ })).toBeNull();
    expect(screen.queryByText(/Zusammenfassung/)).toBeNull();
    expect(row(/^Di 8, Push A, heute, erledigt$/)).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: /Als Nächstes/ }));
    // An unlabelled day of unknown exercises is plainly "Training", never an invented name.
    expect(await screen.findByRole('heading', { level: 1, name: 'Training' })).toBeInTheDocument();
    expect(screen.getByText(/^Donnerstag · 10/)).toBeInTheDocument();
  });

  it('omits a duration that was never measured', async () => {
    mount(completedTuesday());
    expect(within(await todayCard()).getByRole('heading', { name: 'Push A' })).toBeInTheDocument();
  });

  it('shows a rest day with the next workout, and no start', async () => {
    today.value = '2026-09-09';
    vi.setSystemTime(Date.parse('2026-09-09T10:00:00Z'));
    mount();
    const card = await todayCard();
    expect(within(card).getByRole('heading', { name: 'Ruhetag' })).toBeInTheDocument();
    expect(within(card).getByText('Als Nächstes · Morgen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Training starten/ })).toBeNull();
    expect(screen.getByText('Mi 9').closest('button')).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: /^Ansehen: Do 10/ }));
    expect(await screen.findByText(/^Donnerstag · 10/)).toBeInTheDocument();
  });
});

describe('Day Detail', () => {
  it('lists one row per exercise with the prescription kept apart from a long name', async () => {
    mount();
    await todayCard();
    fireEvent.click(row(/^Do 10,/));

    const name = await screen.findByText(LONG_NAME);
    expect(name).toHaveClass('tp-ellipsis');
    const rx = within(name.closest('button')!).getByText('3×5 · 150s');
    expect(rx).not.toBe(name);
    expect(screen.getByText('1 Übung · 3 Sätze')).toBeInTheDocument();
    expect(navHidden).toHaveBeenLastCalledWith(true);

    // Future day: browse only, no start and no move to today.
    expect(within(footer()).queryByRole('button')).toBeNull();
    expect(within(footer()).getByText('Starten kannst du dieses Training am Do 10.')).toBeInTheDocument();

    back();
    await todayCard();
    expect(navHidden).toHaveBeenLastCalledWith(false);
  });

  it("starts today's planned workout from its detail through the same flow", async () => {
    mount();
    fireEvent.click(within(await todayCard()).getByRole('button', { name: 'Ansehen' }));
    expect(await screen.findByText('Dienstag · 8 · Heute')).toBeInTheDocument();

    fireEvent.click(within(footer()).getByRole('button', { name: /Training starten/ }));
    await waitFor(() => expect(storedSession()).toMatchObject(TUESDAY_BINDING));
    await waitFor(() => expect(focusMode()).not.toBeNull());
    fireEvent.click(within(focusMode()!).getByRole('button', { name: 'Vollbild beenden' }));
    await waitFor(() => expect(focusMode()).toBeNull());
    // Still on the detail, which now resumes the same session, with focus on it.
    const resume = within(footer()).getByRole('button', { name: 'Fortsetzen' });
    await waitFor(() => expect(document.activeElement).toBe(resume));
  });

  it('never restarts a completed day or starts a past one', async () => {
    mount(completedTuesday(1200));
    await todayCard();
    fireEvent.click(row(/^Di 8,/));
    expect(await screen.findByText('Dienstag · 8 · Heute · Erledigt')).toBeInTheDocument();
    expect(within(footer()).queryByRole('button')).toBeNull();
    expect(within(footer()).getByText('Dieses Training ist erledigt.')).toBeInTheDocument();
    back();

    fireEvent.click(await screen.findByRole('button', { name: /^Mo 7,/ }));
    expect(within(footer()).queryByRole('button')).toBeNull();
    expect(within(footer()).getByText('Dieser Trainingstag liegt in der Vergangenheit.')).toBeInTheDocument();
    expect(storedSession()).toBeNull();
  });

  it("opens next week's first workout from the teaser", async () => {
    mount();
    await todayCard();
    fireEvent.click(screen.getByRole('button', { name: /Nächste Woche/ }));
    expect(await screen.findByText('Montag · 14')).toBeInTheDocument();
    expect(screen.getByText('Kniebeugen')).toBeInTheDocument();
  });
});

describe('Plan Overview', () => {
  it('shows the stored plan structure and no actions the app cannot perform', async () => {
    mount();
    await todayCard();
    fireEvent.click(screen.getByRole('button', { name: /^Planübersicht öffnen, Woche 1 von 4$/ }));

    expect(await screen.findByRole('heading', { level: 1, name: '4-Wochen-Plan' })).toBeInTheDocument();
    expect(screen.getByText('3 Tage/Woche · 4 Wochen')).toBeInTheDocument();
    expect(screen.getByText('Woche 1 von 4')).toBeInTheDocument();
    expect(screen.getByText('Mi · Fr · Sa · So: Ruhetage')).toBeInTheDocument();
    expect(screen.getByText('7. Sep. – 4. Okt. 2026')).toBeInTheDocument();
    expect(screen.queryByText(/Plan bearbeiten|Plan wechseln|Neuen Plan/)).toBeNull();
    expect(navHidden).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: /^Do .*1 Übung/ }));
    expect(await screen.findByText(/^Donnerstag · 10/)).toBeInTheDocument();
  });
});

describe('editing compatibility', () => {
  const openEdit = async (dayRow: RegExp) => {
    mount();
    await todayCard();
    fireEvent.click(row(dayRow));
    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    return screen.findByRole('heading', { name: /bearbeiten$/ });
  };

  it('keeps the existing inline editor and its update path', async () => {
    await openEdit(/^Di 8,/);
    expect(screen.getByRole('heading', { name: 'Push A bearbeiten' })).toBeInTheDocument();
    expect(screen.getByText(/gelten nur für diesen Tag \(Di 8\)/)).toBeInTheDocument();
    // The existing inline editor: exercise picker and set/rep selects.
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(navHidden).toHaveBeenLastCalledWith(true);

    const weight = screen.getByPlaceholderText('kg');
    fireEvent.change(weight, { target: { value: '60' } });
    fireEvent.blur(weight);

    await waitFor(() => expect(planContent()['Week 1'][1].exercises[0]).toMatchObject({ name: 'Bankdrücken', weight: '60' }));
    // Only that plan day changed.
    expect(planContent()['Week 2'][1].exercises[0]).not.toHaveProperty('weight');
  });

  it('keeps the existing delete path', async () => {
    await openEdit(/^Do 10,/);
    fireEvent.click(screen.getByRole('button', { name: /Löschen/ }));
    await waitFor(() => expect(planContent()['Week 1'][3].exercises).toEqual([]));
    expect(planContent()['Week 1'][1].exercises).toHaveLength(1);
  });

  it('opens the existing add and autofill dialog, and returns to the day', async () => {
    await openEdit(/^Di 8,/);
    fireEvent.click(screen.getByRole('button', { name: /Übung hinzufügen/ }));
    expect(await screen.findByRole('dialog', { name: 'Training hinzufügen' })).toBeInTheDocument();
    expect(logEvent).toHaveBeenCalledWith('add_exercise_dialog_opened', { weekKey: 'Week 1', dayIndex: 1, mode: 'manual' });
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Training hinzufügen' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Training hinzufügen' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Auto-ausfüllen/ }));
    expect(await screen.findByRole('dialog', { name: 'Training hinzufügen' })).toBeInTheDocument();
    expect(logEvent).toHaveBeenCalledWith('ai_autofill_opened', { weekKey: 'Week 1', dayIndex: 1 });
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Training hinzufügen' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Training hinzufügen' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(await screen.findByText('Dienstag · 8 · Heute')).toBeInTheDocument();
  });

  it("editing another day leaves today's workout and any running session alone", async () => {
    await openEdit(/^Do 10,/);
    const rest = screen.getByPlaceholderText('90s');
    fireEvent.change(rest, { target: { value: '180s' } });
    fireEvent.blur(rest);
    await waitFor(() => expect(planContent()['Week 1'][3].exercises[0]).toMatchObject({ rest: '180s' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Zurück' }));
    const card = await todayCard();
    await act(async () => {});
    expect(within(card).getByRole('heading', { name: 'Push A' })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: /Training starten/ }));
    await waitFor(() => expect(storedSession()).toMatchObject(TUESDAY_BINDING));
    await waitFor(() => expect(focusMode()).not.toBeNull());
    expect(within(focusMode()!).getByRole('button', { name: /^Bankdrücken/ })).toBeInTheDocument();
  });
});

/*
  The pushed screens form a stack kept in the browser history: the in-app
  Zurück / Fertig and browser (or Android) Back walk the same hierarchy, and
  none of it reaches the running workout or the app's tab routing.
*/
describe('navigation hierarchy', () => {
  const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });
  const onMain = async () => {
    await todayCard();
    expect(screen.getByRole('heading', { level: 1, name: 'Trainingsplan' })).toBeInTheDocument();
  };
  const onPlan = () => heading('4-Wochen-Plan');
  const onThursday = () => screen.findByText(/^Donnerstag · 10/);
  const openPlan = () => fireEvent.click(screen.getByRole('button', { name: /^Planübersicht öffnen/ }));
  const browserBack = () => act(() => { history.back(); });
  const stored = () => (history.state as Record<string, { stack?: unknown[] }> | null)?.trainingsplanV2?.stack ?? [];

  it('Main → Day Detail → Zurück returns to Main, with focus and scroll back on the row', async () => {
    mount();
    await todayCard();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 420 });
    const thursday = row(/^Do 10,/);
    thursday.focus();
    fireEvent.click(thursday);
    await onThursday();
    expect(stored()).toHaveLength(1);
    expect(window.location.hash).toBe('#/workout');

    back();
    await onMain();
    expect(stored()).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(row(/^Do 10,/)));
    await waitFor(() => expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 420, left: 0, behavior: 'auto' }));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('Main → Plan Overview → Zurück returns to Main', async () => {
    mount();
    await todayCard();
    openPlan();
    await onPlan();
    back();
    await onMain();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Planübersicht öffnen/ })));
  });

  it('Plan Overview → Day Detail → Zurück returns to Plan Overview, then to Main', async () => {
    mount();
    await todayCard();
    openPlan();
    await onPlan();
    fireEvent.click(screen.getByRole('button', { name: /^Do .*1 Übung/ }));
    await onThursday();
    expect(stored()).toHaveLength(2);

    back();
    await onPlan();
    // Focus goes back to the weekday row that opened the day.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Do .*1 Übung/ })));

    back();
    await onMain();
  });

  it('Day Detail → Bearbeiten → Fertig returns to that day, and Back still follows the origin', async () => {
    mount();
    await todayCard();
    openPlan();
    await onPlan();
    fireEvent.click(screen.getByRole('button', { name: /^Do .*1 Übung/ }));
    await onThursday();
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await heading(/bearbeiten$/);

    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    await onThursday();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bearbeiten' })));
    back();
    await onPlan();
  });

  it('browser Back and Forward walk the same hierarchy', async () => {
    mount();
    await todayCard();
    openPlan();
    await onPlan();
    fireEvent.click(screen.getByRole('button', { name: /^Do .*1 Übung/ }));
    await onThursday();
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await heading(/bearbeiten$/);
    expect(navHidden).toHaveBeenLastCalledWith(true);

    await browserBack();
    await onThursday();
    expect(screen.queryByRole('heading', { name: /bearbeiten$/ })).toBeNull();
    await browserBack();
    await onPlan();
    expect(navHidden).toHaveBeenLastCalledWith(false);
    await browserBack();
    await onMain();

    // Forward restores the screen from the history entry itself.
    await act(() => { history.forward(); });
    await onPlan();
    await act(() => { history.forward(); });
    await onThursday();
    expect(window.location.hash).toBe('#/workout');
  });

  it("ignores history entries of other tabs and other plans", async () => {
    mount();
    await todayCard();
    openPlan();
    await onPlan();

    // Another tab's entry: the router owns it, the tab stays where it is.
    history.pushState(null, '', '#/dashboard');
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
    expect(screen.getByRole('heading', { level: 1, name: '4-Wochen-Plan' })).toBeInTheDocument();
    history.replaceState(null, '', '#/workout');

    // An entry for a different plan never opens its screens here.
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', {
        state: { trainingsplanV2: { planId: 'old-plan', stack: [{ kind: 'plan' }] } },
      }));
    });
    await onMain();
  });

  it('restores the pushed screen when the tab is mounted again on its entry', async () => {
    const view = mount();
    await todayCard();
    openPlan();
    await onPlan();
    fireEvent.click(screen.getByRole('button', { name: /^Do .*1 Übung/ }));
    await onThursday();

    // Leaving the tab and coming back to this entry (or reloading on it).
    view.unmount();
    mount();
    await onThursday();
    back();
    await onPlan();
  });

  it('never touches the running workout while navigating', async () => {
    mount();
    fireEvent.click(within(await todayCard()).getByRole('button', { name: /Training starten/ }));
    await waitFor(() => expect(storedSession()).toMatchObject(TUESDAY_BINDING));
    const session = storedSession();
    await waitFor(() => expect(focusMode()).not.toBeNull());
    fireEvent.click(within(focusMode()!).getByRole('button', { name: 'Vollbild beenden' }));
    await waitFor(() => expect(focusMode()).toBeNull());

    openPlan();
    await onPlan();
    fireEvent.click(screen.getByRole('button', { name: /^Do .*1 Übung/ }));
    await onThursday();
    expect(within(footer()).getByRole('button', { name: 'Training läuft bereits' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await heading(/bearbeiten$/);
    await browserBack();
    await onThursday();
    back();
    await onPlan();
    await browserBack();
    await onMain();

    expect(storedSession()).toEqual(session);
    const card = await todayCard();
    expect(within(card).getByText('Übung 1 von 1 · Bankdrücken')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Fortsetzen' }));
    await waitFor(() => expect(focusMode()).not.toBeNull());
    expect(within(focusMode()!).getByRole('button', { name: /^Bankdrücken/ })).toBeInTheDocument();
    expect(storedSession()).toEqual(session);
  });
});
