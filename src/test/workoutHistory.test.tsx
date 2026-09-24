import React, { useCallback, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';

/*
  TRAINING-HISTORY-01: Verlauf and Session Detail on the shipped Workout view,
  session context and Focus Mode against the in-memory Firestore boundary.
  Only account identity, telemetry, toasts and "today" are fixtures.
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

import WorkoutView from '@/views/WorkoutView';
import { TrainingProvider } from '@/contexts/TrainingContext';
import { FocusModeProvider } from '@/contexts/FocusModeContext';
import type { WorkoutLog, WorkoutPlan } from '@/lib/types';
import { getWorkoutDate, getWorkoutDateString, getWorkoutWeekDay } from '@/lib/workoutDateUtils';
import { control, firestore, resetWorkoutFirestore, rows } from '@/test/mocks/workoutFirestore';

const PLAN_ID = 'plan-1';
const OLD_PLAN_ID = 'plan-old';
/** Tuesday of Week 1 of the active plan, midday in Berlin. */
const TUESDAY_NOW = Date.parse('2026-09-08T10:00:00Z');
const LONG_TITLE = 'Ganzkörper B – Schwerpunkt Rücken und hintere Kette mit langem Namen';

const exercise = (name: string, sets = 3) => ({ name, sets, reps: '10', rest: '60s' });
const rest = (day: string) => ({ day, exercises: [] });
const WEEK = [
  { day: 'Ganzkörper A', exercises: [exercise('Kniebeugen'), exercise('Bankdrücken'), exercise('Klimmzüge')] },
  { day: 'Push A', exercises: [exercise('Schulterdrücken')] },
  rest('Mittwoch'),
  { day: 'Pull A', exercises: [exercise('Kreuzheben')] },
  rest('Freitag'), rest('Samstag'), rest('Sonntag'),
];
const PLAN = {
  id: PLAN_ID,
  user_id: 'u1',
  created_at: '2026-09-07T08:00:00Z',
  content: { 'Week 1': WEEK, 'Week 2': WEEK, 'Week 3': WEEK, 'Week 4': WEEK },
} as unknown as WorkoutPlan;
/** An earlier plan whose Weeks 3-4 mirror Week 2. Its names must never come from the active plan. */
const OLD_WEEK_1 = [{ day: 'Oberkörper Alt A', exercises: [exercise('Rudern')] }, rest('Di'), rest('Mi'), rest('Do'), rest('Fr'), rest('Sa'), rest('So')];
const OLD_WEEK_2 = [
  { day: 'Oberkörper Alt B', exercises: [exercise('Seitheben'), exercise('Face Pulls', 2)] },
  rest('Di'), rest('Mi'), { day: LONG_TITLE, exercises: [exercise('Rumänisches Kreuzheben')] }, rest('Fr'), rest('Sa'), rest('So'),
];

const log = (id: string, data: Record<string, unknown>) => rows.set(`users/u1/workout_logs/${id}`, data);
const set = (logId: string, id: string, data: Record<string, unknown>) =>
  rows.set(`users/u1/workout_logs/${logId}/workout_set_logs/${id}`, data);
const daySession = (id: string, planId: string, workoutDay: string, weekKey: string | null, dayIndex: number | null, extra: Record<string, unknown> = {}) =>
  log(id, { planId, workoutDay, ...(weekKey !== null ? { weekKey, dayIndex } : {}), completed: true, ...extra });

/** A realistic account: this plan's Monday, and three sessions of an older plan. */
const seedHistory = () => {
  // Active plan, Mon 7 Sep (Week 1): measured, recorded sets.
  daySession('day-2026-09-07', PLAN_ID, '2026-09-07', 'Week 1', 0, { durationSec: 3120 });
  log('ex-mon-0', { planId: PLAN_ID, workoutDay: '2026-09-07', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 0, completed: true });
  set('ex-mon-0', 's1', { setNumber: 1, completed: true, performanceSource: 'user-recorded', repsCompleted: 10, weightUsed: 52.5 });
  set('ex-mon-0', 's2', { setNumber: 2, completed: true, performanceSource: 'user-recorded', repsCompleted: 9 });
  set('ex-mon-0', 's3', { setNumber: 3, completed: false, performanceSource: 'user-recorded', repsCompleted: 8, weightUsed: 50 });
  log('ex-mon-1', { planId: PLAN_ID, workoutDay: '2026-09-07', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 1, completed: true });
  set('ex-mon-1', 's1', { setNumber: 1, completed: true, performanceSource: 'completion-only' });
  // Legacy: prescription-copied numbers, no marker. Completed, but not a measurement.
  set('ex-mon-1', 's2', { setNumber: 2, repsCompleted: 12, weightUsed: 80 });
  log('ex-mon-2', { planId: PLAN_ID, workoutDay: '2026-09-07', weekKey: 'Week 1', dayIndex: 0, exerciseIndex: 2, completed: false });
  set('ex-mon-2', 's1', { setNumber: 1, completed: true, performanceSource: 'user-recorded', weightUsed: 10 });

  // Older plan: Week 3 mirrors Week 2; no duration measured.
  daySession('day-old-w3', OLD_PLAN_ID, '2026-08-24', 'Week 3', 0);
  daySession('day-old-long', OLD_PLAN_ID, '2026-08-13', 'Week 2', 3, { durationSec: 3840 });
  // Legacy day log: a date and a completion, nothing else.
  daySession('day-old-legacy', OLD_PLAN_ID, '2026-07-30', null, null);
  // Never sessions: a ticked exercise, an unfinished day, an undated completion.
  log('ex-old-only', { planId: OLD_PLAN_ID, workoutDay: '2026-08-20', weekKey: 'Week 3', dayIndex: 3, exerciseIndex: 0, completed: true });
  log('day-old-open', { planId: OLD_PLAN_ID, workoutDay: '2026-08-19', weekKey: 'Week 3', dayIndex: 2, completed: false });
  log('day-old-undated', { planId: OLD_PLAN_ID, weekKey: 'Week 1', dayIndex: 0, completed: true });

  rows.set(`users/u1/workout_plans/${OLD_PLAN_ID}`, { content: { 'Week 1': OLD_WEEK_1, 'Week 2': OLD_WEEK_2 } });
};

/** This plan's completed Tuesday, as Dashboard hands it over and as Firestore stores it. */
const completedTuesdayLogs = (planId = PLAN_ID) => [{
  id: 'day-tue', workout_day: '2026-09-08', week_key: 'Week 1', day_index: 1,
  exercise_index: null, completed: true, duration_sec: 1200, plan_id: planId, user_id: 'u1',
}] as unknown as WorkoutLog[];
const seedTuesday = () => {
  daySession('day-tue', PLAN_ID, '2026-09-08', 'Week 1', 1, { durationSec: 1200 });
  log('ex-tue-0', { planId: PLAN_ID, workoutDay: '2026-09-08', weekKey: 'Week 1', dayIndex: 1, exerciseIndex: 0, completed: true });
  set('ex-tue-0', 's1', { setNumber: 1, completed: true, performanceSource: 'user-recorded', repsCompleted: 12, weightUsed: 30 });
};

let queryClient: QueryClient;

const WorkoutScreen = ({ logs = [], plan }: { logs?: WorkoutLog[]; plan: WorkoutPlan | null }) => {
  const [selectedDate, setSelectedDate] = useState(new Date(`${today.value}T12:00:00`));
  const getWeekKeyForDate = useCallback((date: Date) => getWorkoutWeekDay(PLAN.created_at, date).weekKey, []);
  const getDateFor = useCallback((weekKey: string, dayIndex: number) => getWorkoutDate(PLAN.created_at, weekKey, dayIndex), []);
  // Dashboard's rule, over the plan-scoped logs it passes: the day session record decides.
  const isDayCompleted = useCallback((weekKey: string, dayIndex: number) => {
    const day = getWorkoutDateString(PLAN.created_at, weekKey, dayIndex);
    return logs.some((entry) => entry.completed && entry.workout_day === day);
  }, [logs]);
  const never = useCallback(() => false, []);
  const noop = useCallback(() => {}, []);
  return (
    <WorkoutView
      workoutPlan={plan as WorkoutPlan}
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
    />
  );
};

const mount = ({ logs, plan = PLAN }: { logs?: WorkoutLog[]; plan?: WorkoutPlan | null } = {}) => render(
  <QueryClientProvider client={queryClient}>
    <FocusModeProvider><TrainingProvider><WorkoutScreen logs={logs} plan={plan} /></TrainingProvider></FocusModeProvider>
  </QueryClientProvider>
);

const todayCard = () => screen.findByRole('region', { name: 'Heute' });
const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
const browserBack = () => act(() => { history.back(); });
const stored = () => (history.state as Record<string, { stack?: unknown[] }> | null)?.trainingsplanV2?.stack ?? [];
const verlaufRow = () => screen.findByRole('button', { name: /^Verlauf/ });
const sessionRow = (name: RegExp) => screen.findByRole('button', { name });
/** The entries a reload finds: Main, then Verlauf, then the session, as the tab pushed them. */
const enterSession = (planId: string, workoutDay: string) => {
  const HISTORY = { kind: 'history' };
  history.pushState({ trainingsplanV2: { planId: PLAN_ID, stack: [HISTORY] } }, '', '#/workout');
  history.pushState({ trainingsplanV2: { planId: PLAN_ID, stack: [HISTORY, { kind: 'session', session: { planId, workoutDay } }] } }, '', '#/workout');
};
const setLines = () => screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label')).filter(Boolean);

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  localStorage.clear();
  today.value = '2026-09-08';
  history.replaceState(null, '', '#/workout');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  onlineManager.setOnline(true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TUESDAY_NOW);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  rows.set(`users/u1/workout_plans/${PLAN_ID}`, { content: PLAN.content, createdAt: new firestore.Timestamp(Date.parse(PLAN.created_at)) });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  queryClient.clear();
});

describe('Verlauf', () => {
  it('lists completed sessions newest first by month, named from each session\'s own plan', async () => {
    seedHistory();
    mount();
    await todayCard();
    // The quiet row under the plan row names the newest session once it is known.
    expect(await screen.findByText('Zuletzt: Mo 7 · Ganzkörper A')).toBeInTheDocument();
    fireEvent.click(await verlaufRow());

    expect(await heading('Verlauf')).toBeInTheDocument();
    const months = await screen.findAllByRole('region');
    expect(months.map((month) => month.getAttribute('aria-label'))).toEqual(['September 2026', 'August 2026', 'Juli 2026']);
    const labels = months.flatMap((month) => within(month).getAllByRole('button').map((button) => button.getAttribute('aria-label')));
    expect(labels).toEqual([
      'Montag, 7. Sep. 2026, Ganzkörper A, 3 Übungen · 52 Min',
      // Week 3 of the older plan mirrors its Week 2 - never the active plan's Monday.
      'Montag, 24. Aug. 2026, Oberkörper Alt B, 2 Übungen',
      `Donnerstag, 13. Aug. 2026, ${LONG_TITLE}, 1 Übung · 1 Std 04 Min`,
      'Donnerstag, 30. Juli 2026, Training, Nur Abschluss gespeichert',
    ]);
    // A long name truncates; the date block does not.
    expect(screen.getByText(LONG_TITLE)).toHaveClass('tp-ellipsis');
    expect(screen.getByText('Gestern')).toBeInTheDocument();
    // Read-only: no edit, delete, restart, charts or inputs.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/Bearbeiten|Löschen|Wiederholen|Erledigt/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ältere Trainings laden' })).toBeNull();
  });

  it('Verlauf → Session Detail → Zurück → Verlauf → Zurück → Trainingsplan, with focus back on each opener', async () => {
    seedHistory();
    mount();
    await todayCard();
    fireEvent.click(await verlaufRow());
    fireEvent.click(await sessionRow(/^Montag, 7\. Sep\. 2026/));

    expect(await heading('Ganzkörper A')).toBeInTheDocument();
    expect(stored()).toHaveLength(2);
    expect(window.location.hash).toBe('#/workout');
    expect(screen.getByText('Montag · 7. Sep. 2026')).toBeInTheDocument();
    expect(screen.getByText('52 Min · 3 Übungen · 5/9 Sätze')).toBeInTheDocument();
    expect(screen.getByText('4-Wochen-Plan · Woche 1')).toBeInTheDocument();
    expect(setLines()).toEqual(expect.arrayContaining([
      'Satz 1 · 10 Wdh. · 52,5 kg',
      'Satz 2 · 9 Wdh.',
      'Satz 3 · 8 Wdh. · 50 kg · offen',
      'Satz 1 · 10 kg',
    ]));
    // Completion without values stays completion; the legacy numbers are not shown as performance.
    expect(screen.getByText('2 Sätze abgehakt · keine Werte erfasst')).toBeInTheDocument();
    expect(screen.queryByText(/12 Wdh|80 kg/)).toBeNull();
    expect(screen.getByText('Nur selbst eingetragene Werte. – bedeutet: nicht erfasst.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();

    back();
    expect(await heading('Verlauf')).toBeInTheDocument();
    expect(stored()).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Montag, 7\. Sep\. 2026/ })));

    back();
    await todayCard();
    expect(stored()).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Verlauf/ })));
  });

  it('browser / Android Back follows the same hierarchy, and Forward returns to the session', async () => {
    seedHistory();
    mount();
    await todayCard();
    fireEvent.click(await verlaufRow());
    fireEvent.click(await sessionRow(/^Montag, 24\. Aug\. 2026/));
    expect(await heading('Oberkörper Alt B')).toBeInTheDocument();
    expect(screen.getByText('2 Übungen · 0/5 Sätze')).toBeInTheDocument();

    await browserBack();
    expect(await heading('Verlauf')).toBeInTheDocument();
    await act(() => { history.forward(); });
    expect(await heading('Oberkörper Alt B')).toBeInTheDocument();
    await browserBack();
    await heading('Verlauf');
    await browserBack();
    await todayCard();
    expect(stored()).toHaveLength(0);
  });

  it('restores Verlauf and a session on a remount from the history entry', async () => {
    seedHistory();
    enterSession(OLD_PLAN_ID, '2026-07-30');
    mount();
    expect(await heading('Training')).toBeInTheDocument();
    expect(screen.getByText(/nur Datum und Abschluss gespeichert/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Übungen' })).toBeNull();
    back();
    expect(await heading('Verlauf')).toBeInTheDocument();
  });

  it('pages 30 sessions at a time, counting sessions rather than mixed documents', async () => {
    for (let index = 0; index < 35; index += 1) {
      const workoutDay = `2026-0${index < 28 ? 8 : 7}-${String(28 - (index % 28)).padStart(2, '0')}`;
      daySession(`day-${index}`, OLD_PLAN_ID, workoutDay, 'Week 1', 0);
      for (let exerciseIndex = 0; exerciseIndex < 4; exerciseIndex += 1) {
        log(`ex-${index}-${exerciseIndex}`, { planId: OLD_PLAN_ID, workoutDay, weekKey: 'Week 1', dayIndex: 0, exerciseIndex, completed: true });
      }
    }
    rows.set(`users/u1/workout_plans/${OLD_PLAN_ID}`, { content: { 'Week 1': OLD_WEEK_1 } });
    mount();
    await todayCard();
    fireEvent.click(await verlaufRow());
    await heading('Verlauf');
    const sessions = () => screen.getAllByRole('button', { name: /Oberkörper Alt A/ });
    await waitFor(() => expect(sessions()).toHaveLength(30));
    fireEvent.click(screen.getByRole('button', { name: 'Ältere Trainings laden' }));
    await waitFor(() => expect(sessions()).toHaveLength(35));
    expect(screen.queryByRole('button', { name: 'Ältere Trainings laden' })).toBeNull();
  });

  it('shows a read error with retry - never as an empty history', async () => {
    seedHistory();
    control.serverUnavailablePaths = ['users/u1/workout_logs'];
    mount();
    await todayCard();
    // Unknown is not "none": the row names nothing rather than "Noch keine Trainings".
    const row = await verlaufRow();
    expect(within(row).queryByText('Noch keine Trainings')).toBeNull();
    fireEvent.click(row);

    expect(await screen.findByRole('alert')).toHaveTextContent('Verlauf konnte nicht geladen werden');
    expect(screen.queryByText('Noch keine Trainings')).toBeNull();

    control.serverUnavailablePaths = [];
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await sessionRow(/^Montag, 7\. Sep\. 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a focused not-found state for a session that has no completed record', async () => {
    seedHistory();
    enterSession(OLD_PLAN_ID, '2026-08-19');
    mount();
    expect(await heading('Training nicht gefunden')).toBeInTheDocument();
    expect(screen.getByText('Zu diesem Tag ist kein abgeschlossenes Training gespeichert.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zum Verlauf' }));
    expect(await heading('Verlauf')).toBeInTheDocument();
  });
});

describe('Zusammenfassung ansehen', () => {
  it('Today completed → its exact session → Zurück returns to Trainingsplan, never through Verlauf', async () => {
    seedHistory();
    seedTuesday();
    mount({ logs: completedTuesdayLogs() });
    const card = await todayCard();
    fireEvent.click(within(card).getByRole('button', { name: 'Zusammenfassung ansehen' }));

    expect(await heading('Push A')).toBeInTheDocument();
    expect(screen.getByText('Dienstag · 8. Sep. 2026 · Heute')).toBeInTheDocument();
    expect(screen.getByText('20 Min · 1 Übung · 1/3 Sätze')).toBeInTheDocument();
    expect(setLines()).toContain('Satz 1 · 12 Wdh. · 30 kg');
    expect(stored()).toEqual([{ kind: 'session', session: { planId: PLAN_ID, workoutDay: '2026-09-08' } }]);

    back();
    const again = await todayCard();
    expect(screen.queryByRole('heading', { level: 1, name: 'Verlauf' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(again).getByRole('button', { name: 'Zusammenfassung ansehen' })));
  });

  it('completed Day Detail → its session → Zurück (and browser Back) return to that same Day Detail', async () => {
    seedHistory();
    seedTuesday();
    mount({ logs: completedTuesdayLogs() });
    await todayCard();
    fireEvent.click(screen.getByRole('button', { name: /^Di 8,/ }));
    expect(await screen.findByText('Dienstag · 8 · Heute · Erledigt')).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('day-detail-footer')).getByRole('button', { name: 'Zusammenfassung ansehen' }));
    expect(await heading('Push A')).toBeInTheDocument();
    expect(screen.getByText('20 Min · 1 Übung · 1/3 Sätze')).toBeInTheDocument();
    expect(stored()).toHaveLength(2);

    back();
    expect(await screen.findByText('Dienstag · 8 · Heute · Erledigt')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(
      within(screen.getByTestId('day-detail-footer')).getByRole('button', { name: 'Zusammenfassung ansehen' })
    ));

    fireEvent.click(within(screen.getByTestId('day-detail-footer')).getByRole('button', { name: 'Zusammenfassung ansehen' }));
    await heading('Push A');
    await browserBack();
    expect(await screen.findByText('Dienstag · 8 · Heute · Erledigt')).toBeInTheDocument();
    await browserBack();
    await todayCard();
  });

  it('is not offered for the same date completed in another plan, and never falls back to the latest session', async () => {
    seedHistory();
    daySession('other-plan-tue', OLD_PLAN_ID, '2026-09-08', 'Week 1', 0);
    mount({ logs: completedTuesdayLogs(OLD_PLAN_ID) });
    const card = await todayCard();
    expect(within(card).getByText('Erledigt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zusammenfassung ansehen' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Di 8,/ }));
    expect(await screen.findByText('Dieses Training ist erledigt.')).toBeInTheDocument();
    expect(within(screen.getByTestId('day-detail-footer')).queryByRole('button')).toBeNull();
  });

  it('shows the not-found state, not another session, when the record is gone after opening', async () => {
    mount({ logs: completedTuesdayLogs() });
    fireEvent.click(within(await todayCard()).getByRole('button', { name: 'Zusammenfassung ansehen' }));
    expect(await heading('Training nicht gefunden')).toBeInTheDocument();
    // Opened from Today: Zurück leads back there; Verlauf is not offered as a detour.
    expect(screen.queryByRole('button', { name: 'Zum Verlauf' })).toBeNull();
  });
});

describe('without an active plan', () => {
  it('keeps the existing no-plan state and still reaches Verlauf and its sessions', async () => {
    seedHistory();
    mount({ plan: null });
    expect(await screen.findByText(/Zuletzt: Mo 7 · Ganzkörper A/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Heute' })).toBeNull();

    fireEvent.click(await verlaufRow());
    expect(await heading('Verlauf')).toBeInTheDocument();
    fireEvent.click(await sessionRow(/^Donnerstag, 13\. Aug\. 2026/));
    expect(await heading(LONG_TITLE)).toBeInTheDocument();
    expect(screen.getByText('Rumänisches Kreuzheben')).toBeInTheDocument();
    expect(screen.getByText('1 Std 04 Min · 1 Übung · 0/3 Sätze')).toBeInTheDocument();

    back();
    await heading('Verlauf');
    back();
    expect(await verlaufRow()).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Verlauf/ })));
  });

  it('names a session from its own plan and degrades to numbered positions when that plan is gone', async () => {
    seedHistory();
    rows.delete(`users/u1/workout_plans/${PLAN_ID}`);
    mount({ plan: null });
    fireEvent.click(await verlaufRow());
    fireEvent.click(await sessionRow(/^Montag, 7\. Sep\. 2026, Training, 52 Min$/));
    expect(await heading('Training')).toBeInTheDocument();
    expect(screen.getByText(/Der Plan zu diesem Training ist nicht mehr verfügbar/)).toBeInTheDocument();
    expect(screen.getByText('Übung 1')).toBeInTheDocument();
    expect(screen.queryByText('Kniebeugen')).toBeNull();
    expect(setLines()).toContain('Satz 1 · 10 Wdh. · 52,5 kg');
  });

  it('shows a truthful empty history', async () => {
    mount({ plan: null });
    const row = await verlaufRow();
    await waitFor(() => expect(within(row).getByText('Noch keine Trainings')).toBeInTheDocument());
    fireEvent.click(row);
    expect(await heading('Verlauf')).toBeInTheDocument();
    expect(await screen.findByText('Noch keine Trainings')).toBeInTheDocument();
    expect(screen.getByText('Sobald du ein Training speicherst und beendest, erscheint es hier.')).toBeInTheDocument();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });
});
