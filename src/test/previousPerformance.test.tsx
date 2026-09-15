import React, { useEffect } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';

/*
  TRAINING-EXEC-02B: "Letztes Mal" and "Übernehmen" in the running workout.

  The shipped card, session context, set tracking, history lookup, writer and
  finish flow run against the in-memory Firestore boundary. Only account
  identity, telemetry, toasts and Focus Mode are fixtures. Last time is a
  reference: it must never be written, ticked, rested on or presented as
  today's performance unless the user copies it and a normal 02A commit
  saves it.
*/

const identity = vi.hoisted(() => ({ currentUser: { uid: 'u1' } as { uid: string } | null }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/firebase', () => ({ db: {}, auth: identity }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: identity.currentUser ? { id: identity.currentUser.uid, uid: identity.currentUser.uid } : null }),
}));
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({
  toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn(),
  toastSuccess: vi.fn(), toastWarning: vi.fn(), toastInfo: vi.fn(),
}));
vi.mock('@/hooks/useThrottledToast', () => ({ useThrottledToast: () => ({ showToast }) }));
vi.mock('@/contexts/FocusModeContext', () => ({
  useFocusMode: () => ({ isFocusMode: false, setFocusMode: vi.fn() }),
}));
vi.mock('@/hooks/useBerlinToday', () => ({ useBerlinToday: () => '2026-09-15' }));

import TodayWorkoutCard from '@/components/TodayWorkoutCard';
import { TrainingProvider, useTraining } from '@/contexts/TrainingContext';
import { loadQueue } from '@/lib/offlineQueue';
import { exerciseIdentityKeys } from '@/lib/previousPerformance';
import { queryKeys } from '@/lib/queryKeys';
import { resetSetWriteIntentsForTests } from '@/lib/setWriteIntents';
import type { WorkoutPlan } from '@/lib/types';
import { firestore, resetWorkoutFirestore, rows, writes } from '@/test/mocks/workoutFirestore';
import { toastError } from '@/lib/toastWithIcon';

const PLAN_ID = 'plan-2';
/** Tuesday of the plan's Week 2, midday in Berlin. */
const NOW = Date.parse('2026-09-15T10:00:00Z');
const REST_KEY = 'fitssai.training.rest:u1';
const sessionKey = (uid = 'u1') => `fitssai.training.session:${uid}`;

const exercise = (name: string, sets: number, reps: string, weight?: string) =>
  ({ name, sets, reps, ...(weight ? { weight } : {}), rest: '60s' });
/*
  Tuesday trains Bankdrücken - which has history - and Kniebeugen, which has
  none. Monday trains something else, so a lookup that followed the calendar
  would visibly change.
*/
const WEEK = [
  { day: 'Montag', exercises: [exercise('Rudern', 2, '10')] },
  { day: 'Dienstag', exercises: [exercise('Bankdrücken', 3, '8–12', '50 kg'), exercise('Kniebeugen', 2, '5')] },
  { day: 'Mittwoch', exercises: [] },
  { day: 'Donnerstag', exercises: [] },
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

interface Day { weekKey: string; dayIndex: number; workoutDay: string; date: Date }
const day = (weekKey: string, dayIndex: number, workoutDay: string): Day =>
  ({ weekKey, dayIndex, workoutDay, date: new Date(`${workoutDay}T12:00:00`) });
const TUESDAY = day('Week 2', 1, '2026-09-15');
const MONDAY = day('Week 2', 0, '2026-09-14');
const NEXT_TUESDAY = day('Week 3', 1, '2026-09-22');

const logsPath = (uid = 'u1') => `users/${uid}/workout_logs`;

const seedPlanDocument = (uid = 'u1') => rows.set(`users/${uid}/workout_plans/${PLAN_ID}`, {
  content: PLAN.content,
  createdAt: new firestore.Timestamp(Date.parse(PLAN.created_at)),
});

/** Last Tuesday's Bankdrücken as stored: reps and weight, reps only, and a tick with nothing recorded. */
const seedLastTuesday = (uid = 'u1') => {
  seedPlanDocument(uid);
  const parent = `${logsPath(uid)}/last-tuesday-bench`;
  rows.set(parent, { planId: PLAN_ID, weekKey: 'Week 1', dayIndex: 1, exerciseIndex: 0, workoutDay: '2026-09-08', completed: true });
  rows.set(`${parent}/workout_set_logs/s1`, { setNumber: 1, completed: true, completedAt: 'ts', performanceSource: 'user-recorded', repsCompleted: 10, weightUsed: 52.5 });
  rows.set(`${parent}/workout_set_logs/s2`, { setNumber: 2, completed: true, completedAt: 'ts', performanceSource: 'user-recorded', repsCompleted: 8 });
  rows.set(`${parent}/workout_set_logs/s3`, { setNumber: 3, performanceSource: 'completion-only' });
};

/** Set documents written for today's workout - never last Tuesday's. */
const todaySets = () => [...rows.entries()]
  .filter(([path]) => path.includes('/workout_set_logs/') && !path.includes('/last-'))
  .map(([, data]) => data);

const setOnline = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  onlineManager.setOnline(value);
};

let queryClient: QueryClient;
const freshQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** The card as WorkoutView mounts it, with the selected-day cache following the calendar. */
const CardOnScreen = ({ onScreen }: { onScreen: Day }) => {
  const { syncFromPlan } = useTraining();
  useEffect(() => {
    syncFromPlan(WEEK[onScreen.dayIndex].exercises, onScreen.weekKey, onScreen.dayIndex);
  }, [onScreen, syncFromPlan]);
  return (
    <TodayWorkoutCard
      selectedDate={onScreen.date}
      weekKey={onScreen.weekKey}
      dayIndex={onScreen.dayIndex}
      workoutPlan={PLAN}
      completionMap={{}}
      isLoading={false}
      toggleExercise={vi.fn()}
      isToggling={false}
    />
  );
};
const card = (onScreen: Day) => (
  <QueryClientProvider client={queryClient}>
    <TrainingProvider><CardOnScreen onScreen={onScreen} /></TrainingProvider>
  </QueryClientProvider>
);

const startFromCard = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Training starten/i }));
  await screen.findByRole('button', { name: /^Training beenden/ });
};

/* Only Bankdrücken is expanded, so these names are unique on screen. */
const reps = (set: number) => screen.getByRole('textbox', { name: `Satz ${set}: ausgeführte Wiederholungen` });
const weight = (set: number) => screen.getByRole('textbox', { name: `Satz ${set}: ausgeführtes Gewicht in kg` });
const checkbox = (set: number) => screen.getByRole('checkbox', { name: new RegExp(`Satz ${set}: Vorgabe 8–12 Wiederholungen`) });
const copyName = (set: number) => new RegExp(`^Übernehmen für Satz ${set}:`);
const copyButton = (set: number) => screen.getByRole('button', { name: copyName(set) });
const findCopy = (set: number) => screen.findByRole('button', { name: copyName(set) });
const setRow = (set: number) => screen.getByRole('group', { name: `${set}. Satz` });
const closeRest = () => fireEvent.click(screen.getByRole('button', { name: 'Pause schließen' }));
const savedRest = () => JSON.parse(localStorage.getItem(REST_KEY) ?? 'null');
const finish = () => fireEvent.click(screen.getByRole('button', { name: /^Training beenden/ }));

const pathOf = (target: unknown) =>
  (target as { source?: { path: string } }).source?.path ?? (target as { path?: string }).path ?? '';
const serverReads = () => firestore.getDocsFromServer.mock.calls.map(([target]) => target);
const logReads = (uid = 'u1') => serverReads().filter((target) => pathOf(target) === logsPath(uid));
const lookups = () => queryClient.getQueryCache().findAll({ queryKey: queryKeys.previousPerformance.all });
/** Lookups that actually ran. A key registered before Start stays disabled and reads nothing. */
const runLookups = () => lookups().filter((lookup) => lookup.state.fetchStatus !== 'idle' || lookup.state.status !== 'pending');
/** The running Tuesday's lookup, addressed by account, plan day, date and exercise identities. */
const TUESDAY_IDENTITIES = exerciseIdentityKeys(WEEK[1].exercises);
const tuesdayLookup = (uid = 'u1') => queryClient.getQueryCache().find({
  queryKey: queryKeys.previousPerformance.byExecution(uid, PLAN_ID, 'Week 2', 1, '2026-09-15', TUESDAY_IDENTITIES),
  exact: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  localStorage.clear();
  resetSetWriteIntentsForTests();
  identity.currentUser = { uid: 'u1' };
  setOnline(true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  queryClient = freshQueryClient();
});
afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
  queryClient.clear();
});

describe('last time, beside today', () => {
  it('reviews dirty actuals against bound history without finishing, resetting rest or adding reads/writes on reopen', async () => {
    seedLastTuesday();
    const view = render(card(TUESDAY));
    await startFromCard();
    await findCopy(1);
    fireEvent.change(reps(1), { target: { value: '8' } });
    fireEvent.change(weight(1), { target: { value: '55' } });
    fireEvent.click(checkbox(1));
    closeRest();
    await waitFor(() => expect(todaySets()).toHaveLength(1));
    fireEvent.change(reps(2), { target: { value: '10' } });
    const rest = savedRest();
    const session = localStorage.getItem(sessionKey());
    const reads = serverReads().length;
    finish();

    let summary = await screen.findByRole('dialog', { name: 'Training abschließen?' });
    const comparison = within(summary).getByRole('region', { name: 'Vergleich zum letzten Mal' });
    expect(comparison).toHaveTextContent('Wdh. -2');
    expect(comparison).toHaveTextContent('Gewicht +2,5 kg');
    expect(comparison).toHaveTextContent('Wdh. +2');
    expect(comparison).toHaveTextContent('Satz 2 · offen');
    expect(summary).toHaveTextContent('Übungen abgeschlossen0 von 2');
    expect(summary).toHaveTextContent('1/5');
    expect(summary).toHaveTextContent('15.09.2026');
    expect(localStorage.getItem(sessionKey())).toBe(session);
    expect(savedRest()).toEqual(rest);
    await waitFor(() => expect(todaySets()).toHaveLength(2));
    const writeCount = writes.length;
    const comparisonText = comparison.textContent;
    fireEvent.click(within(summary).getByRole('button', { name: 'Zurück zum Training' }));
    view.rerender(card(MONDAY));
    view.rerender(card(NEXT_TUESDAY));
    finish();
    summary = await screen.findByRole('dialog', { name: 'Training abschließen?' });
    expect(within(summary).getByRole('region', { name: 'Vergleich zum letzten Mal' }).textContent).toBe(comparisonText);
    expect(summary).toHaveTextContent('15.09.2026');
    expect(summary.textContent).not.toMatch(/Rudern|22\.09\.2026|14\.09\.2026/);
    expect(savedRest()).toEqual(rest);
    expect(localStorage.getItem(sessionKey())).toBe(session);
    expect(serverReads()).toHaveLength(reads);
    expect(writes).toHaveLength(writeCount);
  });

  it('previous data and completion alone do not become today or create a comparison', async () => {
    seedLastTuesday();
    render(card(TUESDAY));
    await startFromCard();
    await findCopy(1);
    fireEvent.click(checkbox(1));
    closeRest();
    finish();
    const summary = await screen.findByRole('dialog', { name: 'Training abschließen?' });
    expect(within(summary).queryByRole('region', { name: 'Erfasste Leistung' })).toBeNull();
    expect(within(summary).queryByRole('region', { name: 'Vergleich zum letzten Mal' })).toBeNull();
    expect(summary.textContent).not.toMatch(/52,5|50 kg|8–12/);
  });
  it('shows what was recorded last time without filling today\'s inputs or writing anything', async () => {
    seedLastTuesday();
    const stored = structuredClone([...rows.entries()]);
    render(card(TUESDAY));
    await startFromCard();
    await findCopy(1);

    expect(setRow(1)).toHaveTextContent('Letztes Mal: 10 Wdh. · 52,5 kg');
    expect(within(setRow(2)).getByText('Letztes Mal:').parentElement).toHaveTextContent(/^Letztes Mal: 8 Wdh\.$/);
    // A tick with nothing recorded is not a reference.
    expect(within(setRow(3)).queryByText(/Letztes Mal/)).toBeNull();
    expect(screen.getAllByText('Zuletzt am 08.09.2026')).toHaveLength(1);

    // Today's actual inputs stay empty, the set open, the workout untouched.
    for (const set of [1, 2, 3]) {
      expect(reps(set)).toHaveValue('');
      expect(weight(set)).toHaveValue('');
      expect(checkbox(set)).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.getByText('0/5 Sätze')).toBeInTheDocument();
    expect([...rows.entries()]).toEqual(stored);
    expect(writes).toEqual([]);

    // An exercise with no history adds nothing to its rows.
    fireEvent.click(screen.getByRole('button', { name: /^Kniebeugen/ }));
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(5));
    expect(screen.getAllByText('Letztes Mal:')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Übernehmen/ })).toHaveLength(2);
    expect(screen.getAllByText(/^Zuletzt am/)).toHaveLength(1);
  });

  it('reads history once for the whole day, bounded, and keeps it on the running workout while browsing', async () => {
    seedLastTuesday();
    const view = render(card(TUESDAY));
    await startFromCard();
    await findCopy(1);

    expect(logReads()).toHaveLength(1);
    expect(logReads()[0]).toMatchObject({
      filters: [{ field: 'workoutDay', op: '<', value: '2026-09-15' }],
      order: { __orderBy: 'workoutDay', __direction: 'desc' },
      limit: 100,
    });
    // Sets are opened only for the matching position - not per row, not per log.
    expect(serverReads().filter((target) => pathOf(target).endsWith('/workout_set_logs'))).toHaveLength(1);
    expect(firestore.getDocFromServer).toHaveBeenCalledTimes(1);

    view.rerender(card(MONDAY));
    view.rerender(card(NEXT_TUESDAY));
    fireEvent.change(reps(3), { target: { value: '9' } });
    fireEvent.change(reps(3), { target: { value: '' } });

    expect(copyButton(1)).toBeInTheDocument();
    expect(setRow(1)).toHaveTextContent('Letztes Mal: 10 Wdh. · 52,5 kg');
    expect(logReads()).toHaveLength(1);
    expect(firestore.getDocFromServer).toHaveBeenCalledTimes(1);
    // One lookup ran, keyed by the session's day - never by the day on screen.
    expect(runLookups()).toHaveLength(1);
    expect(runLookups()[0]).toBe(tuesdayLookup());
    expect(tuesdayLookup()?.state.status).toBe('success');
  });
});

describe('Übernehmen', () => {
  it('fills today\'s drafts only: nothing is saved or ticked, rest does not start, focus stays', async () => {
    const user = userEvent.setup({ delay: null });
    seedLastTuesday();
    const planBefore = structuredClone(PLAN);
    render(card(TUESDAY));
    await startFromCard();
    const session = localStorage.getItem(sessionKey());

    await user.click(await findCopy(1));

    expect(reps(1)).toHaveValue('10');
    expect(weight(1)).toHaveValue('52,5');
    expect(copyButton(1)).toHaveFocus();
    expect(todaySets()).toEqual([]);
    expect(writes).toEqual([]);
    expect(loadQueue()).toEqual([]);
    expect(checkbox(1)).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('0/5 Sätze')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Pause' })).toBeNull();
    expect(localStorage.getItem(REST_KEY)).toBeNull();
    expect(localStorage.getItem(sessionKey())).toBe(session);
    expect(PLAN).toEqual(planBefore);
    // Other sets are not touched.
    expect(reps(2)).toHaveValue('');
  });

  it('lets a copied value be edited before it is saved, and blur saves it through the normal path', async () => {
    seedLastTuesday();
    render(card(TUESDAY));
    await startFromCard();

    fireEvent.click(await findCopy(1));
    fireEvent.change(weight(1), { target: { value: '55' } });
    expect(todaySets()).toEqual([]);
    fireEvent.blur(weight(1));

    await waitFor(() => expect(todaySets()).toEqual([
      { setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 10, weightUsed: 55 },
    ]));
    expect(checkbox(1)).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem(REST_KEY)).toBeNull();
    expect(weight(1)).toHaveValue('55');
  });

  it('saves a copied draft on Enter', async () => {
    seedLastTuesday();
    render(card(TUESDAY));
    await startFromCard();

    fireEvent.click(await findCopy(2));
    fireEvent.keyDown(reps(2), { key: 'Enter' });

    await waitFor(() => expect(todaySets()).toEqual([
      { setNumber: 2, completed: false, performanceSource: 'user-recorded', repsCompleted: 8 },
    ]));
    expect(checkbox(2)).toHaveAttribute('aria-checked', 'false');
  });

  it('ticking straight after copying saves the copied values first and starts rest exactly once', async () => {
    seedLastTuesday();
    render(card(TUESDAY));
    await startFromCard();

    fireEvent.click(await findCopy(1));
    fireEvent.click(checkbox(1));

    expect(screen.getAllByRole('dialog', { name: 'Pause' })).toHaveLength(1);
    expect(savedRest().state).toMatchObject({ exerciseIndex: 0, setNumber: 1, totalRestSeconds: 60 });
    await waitFor(() => expect(todaySets()).toEqual([{
      setNumber: 1, completed: true, completedAt: expect.anything(),
      performanceSource: 'user-recorded', repsCompleted: 10, weightUsed: 52.5,
    }]));
    closeRest();
    const rest = savedRest();

    // Copying again changes neither the recorded values nor the running rest.
    fireEvent.click(copyButton(1));
    expect(savedRest()).toEqual(rest);
    expect(screen.queryByRole('dialog', { name: 'Pause' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause für Satz 1 öffnen' })).toBeInTheDocument();
    expect(reps(1)).toHaveValue('10');
    expect(weight(1)).toHaveValue('52,5');
  });

  it('finishing straight after copying commits today and compares the same trusted set', async () => {
    seedLastTuesday();
    render(card(TUESDAY));
    await startFromCard();

    fireEvent.click(await findCopy(2));
    finish();

    const summary = await screen.findByRole('dialog', { name: 'Training abschließen?' });
    const recordedSection = within(summary).getByRole('region', { name: 'Erfasste Leistung' });
    expect(within(recordedSection).getByText('Satz 2 · 8 Wdh. · offen')).toBeInTheDocument();
    expect(recordedSection.textContent).not.toMatch(/Letztes Mal|Zuletzt am|52,5/);
    const comparison = within(summary).getByRole('region', { name: 'Vergleich zum letzten Mal' });
    expect(comparison).toHaveTextContent('Satz 2 · offen');
    expect(within(comparison).getAllByText('8 Wdh.')).toHaveLength(2);
    expect(comparison).not.toHaveTextContent('Satz 1');

    fireEvent.click(within(summary).getByRole('button', { name: /Training speichern & beenden/ }));

    await waitFor(() => expect(localStorage.getItem(sessionKey())).toBeNull());
    expect(todaySets()).toEqual([{ setNumber: 2, completed: false, performanceSource: 'user-recorded', repsCompleted: 8 }]);
  });

  it('fills only empty fields: a value recorded or typed today is never replaced', async () => {
    const user = userEvent.setup({ delay: null });
    seedLastTuesday();
    const today = `${logsPath()}/today-bench`;
    rows.set(today, { planId: PLAN_ID, weekKey: 'Week 2', dayIndex: 1, exerciseIndex: 0, workoutDay: '2026-09-15', completed: false });
    rows.set(`${today}/workout_set_logs/t1`, { setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 12 });
    render(card(TUESDAY));
    await startFromCard();
    await waitFor(() => expect(reps(1)).toHaveValue('12'));

    // Recorded reps stay; only the missing weight is copied.
    await user.click(await findCopy(1));
    expect(reps(1)).toHaveValue('12');
    expect(weight(1)).toHaveValue('52,5');
    expect(rows.get(`${today}/workout_set_logs/t1`)).toEqual({ setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 12 });

    // Typed and not yet saved: tapping Übernehmen saves the typed value, and it stays.
    await user.click(reps(2));
    await user.keyboard('6');
    await user.click(copyButton(2));
    expect(reps(2)).toHaveValue('6');
    expect(weight(2)).toHaveValue('');
    await waitFor(() => expect(todaySets()).toContainEqual({ setNumber: 2, completed: false, performanceSource: 'user-recorded', repsCompleted: 6 }));

    fireEvent.keyDown(weight(1), { key: 'Enter' });
    await waitFor(() => expect(rows.get(`${today}/workout_set_logs/t1`)).toEqual({
      setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 12, weightUsed: 52.5,
    }));
    expect(todaySets()).toHaveLength(2);
  });

  it('a reload restores today\'s saved values as today\'s, and last time stays a reference', async () => {
    seedLastTuesday();
    const view = render(card(TUESDAY));
    await startFromCard();
    fireEvent.click(await findCopy(1));
    fireEvent.change(reps(1), { target: { value: '11' } });
    fireEvent.blur(reps(1));
    await waitFor(() => expect(todaySets()).toEqual([
      { setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 11, weightUsed: 52.5 },
    ]));

    view.unmount();
    resetSetWriteIntentsForTests();
    queryClient = freshQueryClient();
    render(card(TUESDAY));

    await waitFor(() => expect(reps(1)).toHaveValue('11'));
    expect(weight(1)).toHaveValue('52,5');
    await findCopy(1);
    expect(setRow(1)).toHaveTextContent('Letztes Mal: 10 Wdh. · 52,5 kg');
    // A set only referenced last time comes back empty, not pre-filled.
    expect(reps(2)).toHaveValue('');
    expect(weight(2)).toHaveValue('');
    expect(checkbox(1)).toHaveAttribute('aria-checked', 'false');
  });

  it('copied drafts survive exercise guidance and collapsing, and nothing is written', async () => {
    seedLastTuesday();
    render(card(TUESDAY));
    await startFromCard();
    fireEvent.click(await findCopy(1));

    fireEvent.click(screen.getByRole('button', { name: 'Informationen zu Bankdrücken' }));
    expect(screen.getByRole('dialog', { name: 'Bankdrücken' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Übungsdetails schließen' }));
    expect(reps(1)).toHaveValue('10');
    expect(weight(1)).toHaveValue('52,5');

    fireEvent.click(screen.getByRole('button', { name: /^Bankdrücken/ }));
    expect(screen.queryByRole('textbox', { name: 'Satz 1: ausgeführte Wiederholungen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Bankdrücken/ }));

    expect(reps(1)).toHaveValue('10');
    expect(weight(1)).toHaveValue('52,5');
    expect(setRow(1)).toHaveTextContent('Letztes Mal: 10 Wdh. · 52,5 kg');
    expect(writes).toEqual([]);
    expect(localStorage.getItem(REST_KEY)).toBeNull();
  });
});

describe('an optional hint never gets in the way', () => {
  const trainThroughTheWorkout = async () => {
    fireEvent.change(reps(1), { target: { value: '9' } });
    fireEvent.blur(reps(1));
    await waitFor(() => expect(todaySets()).toHaveLength(1));
    fireEvent.click(checkbox(1));
    expect(screen.getAllByRole('dialog', { name: 'Pause' })).toHaveLength(1);
    closeRest();
    fireEvent.click(screen.getByRole('button', { name: 'Informationen zu Bankdrücken' }));
    fireEvent.click(screen.getByRole('button', { name: 'Übungsdetails schließen' }));
    finish();
    expect(within(await screen.findByRole('dialog', { name: 'Training abschließen?' }))
      .queryByRole('region', { name: 'Vergleich zum letzten Mal' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Training speichern & beenden/ }));
    await waitFor(() => expect(localStorage.getItem(sessionKey())).toBeNull());
    expect(todaySets()).toEqual([expect.objectContaining({ setNumber: 1, completed: true, repsCompleted: 9 })]);
  };

  it('a lookup that is still loading holds nothing up', async () => {
    seedLastTuesday();
    firestore.getDocsFromServer.mockImplementationOnce(() => new Promise(() => {}));
    render(card(TUESDAY));
    await startFromCard();

    await waitFor(() => expect(tuesdayLookup()?.state.fetchStatus).toBe('fetching'));
    expect(screen.queryByText(/Letztes Mal/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Übernehmen/ })).toBeNull();
    await trainThroughTheWorkout();
  });

  it('a failed lookup shows nothing, says nothing, and the workout carries on', async () => {
    seedLastTuesday();
    firestore.getDocsFromServer.mockRejectedValueOnce(Object.assign(new Error('Failed to get documents from server.'), { code: 'unavailable' }));
    render(card(TUESDAY));
    await startFromCard();

    await waitFor(() => expect(tuesdayLookup()?.state.status).toBe('error'));
    expect(screen.queryByText(/Letztes Mal/)).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    await trainThroughTheWorkout();
  });

  it("never shows another account's history, and each account reads only its own", async () => {
    seedLastTuesday('u2');
    seedPlanDocument('u1');
    const view = render(card(TUESDAY));
    await startFromCard();

    await waitFor(() => expect(tuesdayLookup('u1')?.state.status).toBe('success'));
    expect(screen.queryByText(/Letztes Mal/)).toBeNull();
    expect(serverReads().length).toBeGreaterThan(0);
    expect(serverReads().every((target) => pathOf(target).startsWith('users/u1/'))).toBe(true);
    expect(runLookups().map((lookup) => lookup.queryKey[1])).toEqual(['u1']);

    view.unmount();
    identity.currentUser = { uid: 'u2' };
    // Each account has its own query client, as QueryProvider gives it.
    queryClient = freshQueryClient();
    render(card(TUESDAY));
    await startFromCard();

    await findCopy(1);
    expect(runLookups().map((lookup) => lookup.queryKey[1])).toEqual(['u2']);
    expect(tuesdayLookup('u2')?.state.status).toBe('success');
    expect(logReads('u2')).toHaveLength(1);
  });

  it('shows a cached reference offline without reading, and nothing when none was cached', async () => {
    seedLastTuesday();
    const view = render(card(TUESDAY));
    await startFromCard();
    await findCopy(1);
    const reads = firestore.getDocsFromServer.mock.calls.length;
    view.unmount();

    setOnline(false);
    render(card(TUESDAY));
    expect(await findCopy(1)).toBeInTheDocument();
    expect(firestore.getDocsFromServer.mock.calls.length).toBe(reads);
    screen.getAllByRole('button', { name: /^Training beenden/ });

    // A device with no cached lookup shows today's workout without one.
    document.body.innerHTML = '';
    queryClient = freshQueryClient();
    queryClient.setQueryData(queryKeys.sets.byDay(PLAN_ID, 'Week 2', 1), {});
    render(card(TUESDAY));
    await screen.findByRole('button', { name: /^Training beenden/ });
    expect(screen.queryByText(/Letztes Mal/)).toBeNull();
    expect(firestore.getDocsFromServer.mock.calls.length).toBe(reads);
    expect(reps(1)).toHaveValue('');
  });
});
