import React, { useCallback, useEffect, useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';

/*
  TRAINING-EXEC-01A: a running workout is its session, not the calendar.

  The shipped session context, plan reader, set tracking, offline queue, card
  and Workout view run against the in-memory Firestore boundary. Only account
  identity, telemetry, toasts and Focus Mode are fixtures. Every case is the
  shape of the original defect: start Monday, browse elsewhere, keep training.
*/

const showToast = vi.hoisted(() => vi.fn());
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', uid: 'u1' } }) }));
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({
  toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn(),
  toastSuccess: vi.fn(), toastWarning: vi.fn(), toastInfo: vi.fn(),
}));
vi.mock('@/hooks/useThrottledToast', () => ({ useThrottledToast: () => ({ showToast }) }));
vi.mock('@/contexts/FocusModeContext', () => ({
  useFocusMode: () => ({ isFocusMode: false, setFocusMode: vi.fn() }),
}));
vi.mock('@/hooks/useBerlinToday', () => ({ useBerlinToday: () => '2026-09-08' }));

import TodayWorkoutCard from '@/components/TodayWorkoutCard';
import WorkoutView from '@/views/WorkoutView';
import { TrainingProvider, useTraining } from '@/contexts/TrainingContext';
import { useWorkoutExecution } from '@/hooks/useWorkoutExecution';
import { loadQueue } from '@/lib/offlineQueue';
import { queryKeys } from '@/lib/queryKeys';
import type { SessionPlanContext } from '@/lib/trainingSession';
import type { WorkoutPlan } from '@/lib/types';
import { getWorkoutDate, getWorkoutDateString, getWorkoutWeekDay } from '@/lib/workoutDateUtils';
import { firestore, resetWorkoutFirestore, rows, writes } from '@/test/mocks/workoutFirestore';

const PLAN_ID = 'plan-1';
const SESSION_KEY = 'fitssai.training.session:u1';
const LOGS = 'users/u1/workout_logs';
/** Tuesday of Week 1, midday in Berlin. */
const NOW = Date.parse('2026-09-08T10:00:00Z');

const exercise = (name: string, sets: number, reps: string) => ({ name, sets, reps, rest: '60s' });
/*
  Monday and Tuesday train different exercises and Wednesday rests, so any part
  of the running workout that followed the calendar shows up as a wrong name, a
  wrong set count or a workout that disappears.
*/
const WEEK = [
  { day: 'Montag', exercises: [exercise('Kniebeugen', 3, '8'), exercise('Rudern', 2, '10')] },
  { day: 'Dienstag', exercises: [exercise('Bankdrücken', 4, '12')] },
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

interface Day { weekKey: string; dayIndex: number; workoutDay: string; date: Date }
const day = (weekKey: string, dayIndex: number, workoutDay: string): Day =>
  ({ weekKey, dayIndex, workoutDay, date: new Date(`${workoutDay}T12:00:00`) });
const MONDAY = day('Week 1', 0, '2026-09-07');
const TUESDAY = day('Week 1', 1, '2026-09-08');
const WEDNESDAY = day('Week 1', 2, '2026-09-09');
const NEXT_THURSDAY = day('Week 2', 3, '2026-09-17');

const MONDAY_BINDING = { planId: PLAN_ID, weekKey: 'Week 1', dayIndex: 0, workoutDay: '2026-09-07' };
const MONDAY_TARGET = { source: 'session', ...MONDAY_BINDING };

/** The rule Dashboard applies to a stored session once the plan has loaded. */
const planContext: SessionPlanContext = {
  planId: PLAN_ID,
  hasDay: (weekKey, dayIndex) => {
    const days = PLAN.content[weekKey];
    return Array.isArray(days) && !!days[dayIndex];
  },
};

const storeSession = (session: Record<string, unknown>) =>
  localStorage.setItem(SESSION_KEY, JSON.stringify({ version: 1, startedAt: NOW - 600_000, ...session }));
const storedSession = () => JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');

/** Exercise-position parents, as set writes create them. */
const parentLogs = () => [...rows.entries()]
  .filter(([path]) => path.startsWith(`${LOGS}/`) && path.split('/').length === 4)
  .map(([, data]) => data);
const setLogs = () => [...rows.entries()]
  .filter(([path]) => path.includes('/workout_set_logs/'))
  .map(([, data]) => data);

const setOnline = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  onlineManager.setOnline(value);
};

let queryClient: QueryClient;
const freshQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  localStorage.clear();
  setOnline(true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  queryClient = freshQueryClient();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setOnline(true);
  queryClient.clear();
});

/*
  WorkoutView keeps the selected-day cache in step with the calendar. These
  harnesses do the same, so a running workout that still read that cache would
  visibly follow the calendar here too.
*/
const useCalendarCache = (onScreen: Day) => {
  const training = useTraining();
  const { syncFromPlan } = training;
  useEffect(() => {
    syncFromPlan(WEEK[onScreen.dayIndex].exercises, onScreen.weekKey, onScreen.dayIndex);
  }, [onScreen, syncFromPlan]);
  return training;
};

const useBrowsing = (onScreen: Day) => ({
  training: useCalendarCache(onScreen),
  execution: useWorkoutExecution(PLAN, onScreen),
});

const providers = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <TrainingProvider>{children}</TrainingProvider>
  </QueryClientProvider>
);

const browse = (onScreen: Day) =>
  renderHook((props: { onScreen: Day }) => useBrowsing(props.onScreen), {
    wrapper: providers,
    initialProps: { onScreen },
  });

const startMonday = async (result: { current: ReturnType<typeof useBrowsing> }) => {
  act(() => result.current.training.startSession(MONDAY_BINDING));
  await waitFor(() => expect(result.current.execution.isLoadingSets).toBe(false));
};

describe('a started workout stays bound to the day it was started on', () => {
  it('binds execution to the selected plan, week, day and date at start', () => {
    const { result } = browse(MONDAY);
    expect(result.current.execution.target).toEqual({ source: 'selection', ...MONDAY_BINDING });

    act(() => result.current.training.startSession(MONDAY_BINDING));

    expect(result.current.execution.target).toEqual(MONDAY_TARGET);
    expect(storedSession()).toMatchObject(MONDAY_BINDING);
  });

  it.each([
    ['another training day', TUESDAY],
    ['a rest day', WEDNESDAY],
    ['a day in another week', NEXT_THURSDAY],
  ])('keeps exercises, progress and the set query on Monday while browsing %s', async (_label, elsewhere) => {
    const { result, rerender } = browse(MONDAY);
    await startMonday(result);

    rerender({ onScreen: elsewhere });

    // The selected-day cache did follow the calendar...
    await waitFor(() => expect(result.current.training.todayWorkouts.map((item) => item.name))
      .toEqual(WEEK[elsewhere.dayIndex].exercises.map((item) => item.name)));
    // ...and the running workout did not.
    const { execution } = result.current;
    expect(execution.target).toEqual(MONDAY_TARGET);
    expect(execution.exercises.map((item) => item.name)).toEqual(['Kniebeugen', 'Rudern']);
    expect(execution.progress).toEqual({ totalSets: 5, completedSets: 0, progressPercent: 0, isComplete: false });
    const cache = queryClient.getQueryCache();
    expect(cache.find({ queryKey: queryKeys.sets.byDay(PLAN_ID, 'Week 1', 0), exact: true })?.getObserversCount()).toBe(1);
    expect(cache.find({ queryKey: queryKeys.sets.byDay(PLAN_ID, elsewhere.weekKey, elsewhere.dayIndex), exact: true }))
      .toBeUndefined();
  });

  it('writes a set ticked while browsing to Monday, optimistically first and as completion only', async () => {
    const { result, rerender } = browse(MONDAY);
    await startMonday(result);
    rerender({ onScreen: TUESDAY });

    // Hold the writer at its first read - the parent lookup, which finds nothing
    // yet - so the optimistic tick is observable on its own.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    firestore.getDocs.mockImplementationOnce(async () => { await held; return { docs: [], empty: true }; });

    act(() => result.current.execution.toggleSet({ exerciseIndex: 1, setNumber: 2, completed: true }));

    await waitFor(() => expect(result.current.execution.isSetCompleted(1, 2)).toBe(true));
    expect(result.current.execution.progress.completedSets).toBe(1);
    expect(setLogs()).toHaveLength(0);
    expect(queryClient.getQueryData(queryKeys.sets.byDay(PLAN_ID, 'Week 1', 1))).toBeUndefined();

    await act(async () => release());
    if (screen.queryByRole('button', { name: 'Pause schließen' })) fireEvent.click(screen.getByRole('button', { name: 'Pause schließen' }));
    await waitFor(() => expect(setLogs()).toHaveLength(1));

    expect(parentLogs()).toEqual([expect.objectContaining({ ...MONDAY_BINDING, exerciseIndex: 1, completed: false })]);
    expect(setLogs()[0]).toMatchObject({ setNumber: 2, performanceSource: 'completion-only' });
    expect(setLogs()[0]).not.toHaveProperty('repsCompleted');
    expect(setLogs()[0]).not.toHaveProperty('weightUsed');
    await waitFor(() => expect(result.current.execution.isSetCompleted(1, 2)).toBe(true));
    expect(result.current.execution.target).toEqual(MONDAY_TARGET);
  });

  it('queues a set ticked offline while browsing against Monday, as completion only', async () => {
    const { result, rerender } = browse(MONDAY);
    await startMonday(result);
    rerender({ onScreen: NEXT_THURSDAY });
    setOnline(false);

    act(() => result.current.execution.toggleSet({ exerciseIndex: 0, setNumber: 3, completed: true }));

    await waitFor(() => expect(loadQueue()).toHaveLength(1));
    expect(loadQueue()[0].type).toBe('TOGGLE_SET');
    expect(loadQueue()[0].payload).toEqual({ ...MONDAY_BINDING, exerciseIndex: 0, setNumber: 3, completed: true });
    expect(result.current.execution.isSetCompleted(0, 3)).toBe(true);
    expect(writes).toHaveLength(0);
  });
});

describe('a reloaded session resumes its own day', () => {
  it('resolves a stored session to Monday whatever is on screen, and validation keeps it', async () => {
    rows.set(`${LOGS}/monday-squat`, { ...MONDAY_BINDING, exerciseIndex: 0, completed: false });
    rows.set(`${LOGS}/monday-squat/workout_set_logs/s1`, { setNumber: 1, performanceSource: 'completion-only' });
    rows.set(`${LOGS}/tuesday-bench`, { planId: PLAN_ID, weekKey: 'Week 1', dayIndex: 1, exerciseIndex: 0, workoutDay: '2026-09-08', completed: false });
    rows.set(`${LOGS}/tuesday-bench/workout_set_logs/s2`, { setNumber: 2, performanceSource: 'completion-only' });
    storeSession(MONDAY_BINDING);

    // A fresh provider over stored state is what a reload is.
    const { result } = browse(TUESDAY);
    act(() => result.current.training.validateSessionAgainstPlan(planContext));

    expect(result.current.training.isStarted).toBe(true);
    expect(result.current.training.rejectionNotice).toBeNull();
    expect(result.current.execution.target).toEqual(MONDAY_TARGET);
    expect(result.current.execution.exercises.map((item) => item.name)).toEqual(['Kniebeugen', 'Rudern']);
    await waitFor(() => expect(result.current.execution.isSetCompleted(0, 1)).toBe(true));
    // Tuesday's set is Tuesday's; it does not leak into Monday's progress.
    expect(result.current.execution.isSetCompleted(0, 2)).toBe(false);
    expect(result.current.execution.progress.completedSets).toBe(1);
  });

  it("writes a session that predates captured dates against its own plan's date, not the one on screen", async () => {
    storeSession({ planId: PLAN_ID, weekKey: 'Week 1', dayIndex: 0 });
    const { result } = browse(TUESDAY);
    expect(result.current.execution.target).toEqual(MONDAY_TARGET);
    await waitFor(() => expect(result.current.execution.isLoadingSets).toBe(false));

    act(() => result.current.execution.toggleSet({ exerciseIndex: 0, setNumber: 1, completed: true }));

    if (screen.queryByRole('button', { name: 'Pause schließen' })) fireEvent.click(screen.getByRole('button', { name: 'Pause schließen' }));
    await waitFor(() => expect(setLogs()).toHaveLength(1));
    expect(parentLogs()).toEqual([expect.objectContaining({ ...MONDAY_BINDING, exerciseIndex: 0 })]);
  });

  it.each([
    ['belongs to another plan', { planId: 'old-plan', weekKey: 'Week 2', dayIndex: 4, workoutDay: '2026-08-21' }],
    ['points at a day the plan does not have', { planId: PLAN_ID, weekKey: 'Week 9', dayIndex: 0, workoutDay: '2026-11-02' }],
  ])('rejects a stored session that %s as before, without rebinding it to the day on screen', async (_label, stale) => {
    storeSession(stale);
    const { result } = browse(TUESDAY);
    expect(result.current.execution.target).toEqual({ source: 'session', ...stale });

    act(() => result.current.training.validateSessionAgainstPlan(planContext));

    expect(result.current.training.isStarted).toBe(false);
    expect(result.current.training.session).toBeNull();
    expect(result.current.training.rejectionNotice).toBeTruthy();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    // Back to browsing: Tuesday is only what Start would bind.
    expect(result.current.execution.target).toEqual({
      source: 'selection', planId: PLAN_ID, weekKey: 'Week 1', dayIndex: 1, workoutDay: '2026-09-08',
    });
    expect(writes).toHaveLength(0);
  });
});

/** The card as WorkoutView mounts it: props from the selected date, cache synced for that day. */
const CardOnScreen = ({ onScreen }: { onScreen: Day }) => {
  useCalendarCache(onScreen);
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
const card = (onScreen: Day) => providers({ children: <CardOnScreen onScreen={onScreen} /> });

/** The started view: everything the finish control sits beside. */
const running = () => screen.getByRole('button', { name: /^Training beenden/ }).parentElement!;
/** The session status above the exercises: its progress bar and running time. */
const sessionProgress = () => within(running()).getByRole('progressbar', { name: 'Trainingsfortschritt' });
const elapsed = () => running().querySelector('.workout-session-status time')!;
/** The hero header, which names the workout's day. */
const hero = () => screen.getByRole('button', { name: 'Vollbild' }).parentElement!;

const startFromCard = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Training starten/i }));
  await screen.findByRole('button', { name: /^Training beenden/ });
};

describe('the card keeps showing the running workout while the calendar moves', () => {
  it('shows, ticks and counts Monday after browsing to a rest day and on to Tuesday, and after a reload', async () => {
    const view = render(card(MONDAY));
    await startFromCard();

    vi.setSystemTime(NOW + 754_000);
    await waitFor(() => expect(elapsed()).toHaveTextContent('12:34'), { timeout: 2500 });

    view.rerender(card(WEDNESDAY));
    // A rest day on screen no longer swallows the running workout.
    expect(await screen.findByRole('button', { name: /^Training beenden/ })).toBeInTheDocument();
    expect(within(hero()).getByText('Montag')).toBeInTheDocument();

    view.rerender(card(TUESDAY));
    await waitFor(() => expect(within(running()).getByText('0/5 Sätze')).toBeInTheDocument());
    // The status block still describes Monday: its progress and its clock.
    expect(sessionProgress()).toHaveAttribute('aria-valuenow', '0');
    expect(elapsed()).toHaveTextContent('12:34');
    expect(within(running()).getByRole('button', { name: /^Kniebeugen/ })).toBeInTheDocument();
    expect(within(running()).queryByText(/Bankdrücken/)).not.toBeInTheDocument();
    expect(within(hero()).queryByText('Dienstag')).not.toBeInTheDocument();

    fireEvent.click(within(running()).getByRole('checkbox', { name: /Satz 1: Vorgabe 8 Wiederholungen/ }));

    if (screen.queryByRole('button', { name: 'Pause schließen' })) fireEvent.click(screen.getByRole('button', { name: 'Pause schließen' }));
    await waitFor(() => expect(setLogs()).toHaveLength(1));
    expect(parentLogs()).toEqual([expect.objectContaining({ ...MONDAY_BINDING, exerciseIndex: 0 })]);
    await waitFor(() => expect(within(running()).getByText('1/5 Sätze')).toBeInTheDocument());
    expect(sessionProgress()).toHaveAttribute('aria-valuenow', '20');

    // Reload on Tuesday: new cache, stored session, Monday resumes with its tick.
    view.unmount();
    queryClient = freshQueryClient();
    render(card(TUESDAY));
    await waitFor(() => expect(within(running()).getByText('1/5 Sätze')).toBeInTheDocument());
    expect(sessionProgress()).toHaveAttribute('aria-valuenow', '20');
    expect(elapsed()).toHaveTextContent('12:34');
    expect(within(running()).getByRole('checkbox', { name: /Satz 1: Vorgabe 8 Wiederholungen/ }))
      .toHaveAttribute('aria-checked', 'true');
    expect(within(hero()).getByText('Montag')).toBeInTheDocument();
    expect(storedSession()).toMatchObject(MONDAY_BINDING);
  });

  it('finishes Monday after browsing away, summarises Monday and clears the bound session', async () => {
    const view = render(card(MONDAY));
    await startFromCard();
    view.rerender(card(NEXT_THURSDAY));

    fireEvent.click(await screen.findByRole('button', { name: /^Training beenden/ }));
    const summary = await screen.findByRole('dialog', { name: 'Training abschließen?' });
    // The summary counts the workout being finished, not the day on screen.
    expect(within(summary).getByText('0/5')).toBeInTheDocument();
    expect(within(summary).getByText('0 von 2')).toBeInTheDocument();
    fireEvent.click(within(summary).getByRole('button', { name: /Training speichern & beenden/ }));

    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBeNull());
    expect([...rows.values()].filter((row) => row.completed === true))
      .toEqual([expect.objectContaining({ ...MONDAY_BINDING, completed: true })]);
    expect(await screen.findByRole('button', { name: /Training starten/i })).toBeInTheDocument();
  });
});

describe('the Workout view calendar', () => {
  /** Dashboard's part: it owns the selected date and the plan-to-date mapping. */
  const WorkoutScreen = () => {
    const [selectedDate, setSelectedDate] = useState(MONDAY.date);
    const getWeekKeyForDate = useCallback((date: Date) => getWorkoutWeekDay(PLAN.created_at, date).weekKey, []);
    const getDateFor = useCallback(
      (weekKey: string, dayIndex: number) => getWorkoutDate(PLAN.created_at, weekKey, dayIndex), []);
    const dateOf = useCallback(
      (weekKey: string, dayIndex: number) => getWorkoutDateString(PLAN.created_at, weekKey, dayIndex), []);
    const isDayCompleted = useCallback(() => false, []);
    const isDayInFuture = useCallback((weekKey: string, dayIndex: number) => dateOf(weekKey, dayIndex) > '2026-09-08', [dateOf]);
    const isTodayInWeekDay = useCallback((weekKey: string, dayIndex: number) => dateOf(weekKey, dayIndex) === '2026-09-08', [dateOf]);
    const getWeeklyProgress = useCallback(() => ({ completed: 0, total: 0 }), []);
    const noop = useCallback(() => {}, []);

    return (
      <WorkoutView
        workoutPlan={PLAN}
        workoutLogs={[]}
        completingWorkout={false}
        selectedDate={selectedDate}
        isDayCompleted={isDayCompleted}
        isDayInFuture={isDayInFuture}
        isTodayInWeekDay={isTodayInWeekDay}
        getDateFor={getDateFor}
        getWeekTitle={(weekKey) => weekKey}
        getWeeklyProgress={getWeeklyProgress}
        getWeekKeyForDate={getWeekKeyForDate}
        toggleDayComplete={noop}
        handleDateChange={setSelectedDate}
      />
    );
  };

  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    rows.set(`users/u1/workout_plans/${PLAN_ID}`, {
      content: PLAN.content,
      createdAt: new firestore.Timestamp(Date.parse(PLAN.created_at)),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps Monday running, ticked and counted after the calendar selects Tuesday', async () => {
    render(providers({ children: <WorkoutScreen /> }));
    await startFromCard();

    fireEvent.click(screen.getByRole('button', { name: /^Di\.? 8/ }));

    // The calendar moved to Tuesday...
    await waitFor(() => expect(screen.getByRole('button', { name: /^Di\.? 8/ })).toHaveAttribute('aria-pressed', 'true'));
    // ...the running workout did not.
    expect(within(running()).getByRole('button', { name: /^Kniebeugen/ })).toBeInTheDocument();
    expect(within(running()).getByText('0/5 Sätze')).toBeInTheDocument();
    expect(sessionProgress()).toHaveAttribute('aria-valuenow', '0');
    expect(within(running()).queryByText(/Bankdrücken/)).not.toBeInTheDocument();
    expect(within(hero()).getByText('Montag')).toBeInTheDocument();

    fireEvent.click(within(running()).getByRole('checkbox', { name: /Satz 1: Vorgabe 8 Wiederholungen/ }));

    if (screen.queryByRole('button', { name: 'Pause schließen' })) fireEvent.click(screen.getByRole('button', { name: 'Pause schließen' }));
    await waitFor(() => expect(setLogs()).toHaveLength(1));
    expect(parentLogs()).toEqual([expect.objectContaining({ ...MONDAY_BINDING, exerciseIndex: 0 })]);
    await waitFor(() => expect(within(running()).getByText('1/5 Sätze')).toBeInTheDocument());
    expect(sessionProgress()).toHaveAttribute('aria-valuenow', '20');
    expect(storedSession()).toMatchObject(MONDAY_BINDING);
  });
});

describe('active rest loop in the session-bound card', () => {
  const restKey = 'fitssai.training.rest:u1';
  const savedRest = () => JSON.parse(localStorage.getItem(restKey) ?? 'null');
  const closeRest = () => fireEvent.click(screen.getByRole('button', { name: 'Pause schließen' }));
  const tick = async (set: number) => {
    const box = await screen.findByRole('checkbox', { name: new RegExp(`Satz ${set}: Vorgabe 8 Wiederholungen`) });
    await waitFor(() => expect(box).not.toBeDisabled());
    fireEvent.click(box);
    await waitFor(() => expect(box).not.toBeDisabled());
    return box;
  };

  it('auto-opens prescribed rest, controls it, dismisses/reopens, replaces and skips without changing completed sets', async () => {
    render(card(MONDAY));
    await startFromCard();
    await tick(1);
    expect(screen.getByRole('dialog', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('01:00');
    const original = savedRest();
    expect(original.state).toMatchObject({ exerciseIndex: 0, setNumber: 1, totalRestSeconds: 60 });
    act(() => { vi.setSystemTime(NOW + 12000); window.dispatchEvent(new Event('focus')); });
    expect(screen.getByRole('timer')).toHaveTextContent('00:48');
    closeRest();
    expect(savedRest()).toEqual(original);
    const inline = screen.getByRole('button', { name: 'Pause für Satz 1 öffnen' });
    expect(within(inline).getByRole('timer')).toHaveTextContent('00:48');
    fireEvent.click(screen.getByRole('button', { name: /^Kniebeugen/ }));
    expect(inline).toBeVisible(); // A collapsed exercise never strands rest.
    fireEvent.click(inline);
    fireEvent.click(screen.getByRole('button', { name: 'Timer pausieren' }));
    act(() => { vi.setSystemTime(NOW + 72000); window.dispatchEvent(new Event('focus')); });
    expect(screen.getByRole('timer')).toHaveTextContent('00:48');
    fireEvent.click(screen.getByRole('button', { name: 'Pause um 15 Sekunden verlängern' }));
    expect(screen.getByRole('timer')).toHaveTextContent('01:03');
    fireEvent.click(screen.getByRole('button', { name: 'Pause um 15 Sekunden verkürzen' }));
    expect(screen.getByRole('timer')).toHaveTextContent('00:48');
    expect(savedRest().state.totalRestSeconds).toBe(60);
    fireEvent.click(screen.getByRole('button', { name: 'Pause fortsetzen' }));
    expect(savedRest().state.deadlineMs).toBe(NOW + 120000);
    closeRest();
    fireEvent.click(screen.getByRole('button', { name: /^Kniebeugen/ }));
    await tick(2);
    expect(savedRest().state).toMatchObject({ setNumber: 2 });
    closeRest();
    await tick(1); // Undo the older set.
    expect(savedRest().state.setNumber).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Pause für Satz 2 öffnen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause überspringen' }));
    expect(localStorage.getItem(restKey)).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Satz 2: Vorgabe 8 Wiederholungen/ })).toHaveAttribute('aria-checked', 'true');
    await tick(3);
    closeRest();
    await tick(3); // Exact owner undo cancels.
    expect(localStorage.getItem(restKey)).toBeNull();
  });

  it.each(['running', 'paused'])('guidance leaves completed sets, prescription, identity and %s rest intact as time passes', async status => {
    render(card(MONDAY));
    await startFromCard();
    await tick(1);
    await waitFor(() => expect(setLogs()).toHaveLength(1));
    if (status === 'paused') fireEvent.click(screen.getByRole('button', { name: 'Timer pausieren' }));
    closeRest();
    const originalRest = savedRest();
    const originalSession = storedSession();
    const originalWrites = structuredClone(writes);
    const originalPlan = structuredClone(PLAN);
    fireEvent.click(screen.getByRole('button', { name: 'Informationen zu Kniebeugen' }));
    expect(screen.getByRole('dialog', { name: 'Kniebeugen' })).toBeInTheDocument();
    act(() => { vi.setSystemTime(NOW + 12000); window.dispatchEvent(new Event('focus')); });
    fireEvent.click(screen.getByRole('button', { name: 'Übungsdetails schließen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(savedRest()).toEqual(originalRest);
    expect(screen.getByRole('timer')).toHaveTextContent(status === 'running' ? '00:48' : '01:00');
    expect(storedSession()).toEqual(originalSession);
    expect(writes).toEqual(originalWrites);
    expect(PLAN).toEqual(originalPlan);
    expect(screen.getByRole('checkbox', { name: /Satz 1: Vorgabe 8 Wiederholungen/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /Satz 2: Vorgabe 8 Wiederholungen/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('restores the timer with the session while browsing elsewhere, and clears it on finish', async () => {
    const view = render(card(MONDAY));
    await startFromCard();
    await tick(1);
    await waitFor(() => expect(setLogs()).toHaveLength(1));
    const saved = savedRest();
    closeRest();
    view.rerender(card(TUESDAY));
    expect(savedRest()).toEqual(saved);
    view.unmount();
    vi.setSystemTime(NOW + 17000);
    queryClient = freshQueryClient();
    render(card(TUESDAY));
    const inline = await screen.findByRole('button', { name: 'Pause für Satz 1 öffnen' });
    expect(within(inline).getByRole('timer')).toHaveTextContent('00:43');
    expect(savedRest()).toEqual(saved);
    fireEvent.click(screen.getByRole('button', { name: /^Training beenden/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Training speichern & beenden/ }));
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBeNull());
    expect(localStorage.getItem(restKey)).toBeNull();
  });
});

describe('recorded set performance in the session-bound card (TRAINING-EXEC-02A)', () => {
  const restKey = 'fitssai.training.rest:u1';
  const savedRest = () => JSON.parse(localStorage.getItem(restKey) ?? 'null');
  const reps = (set: number) => screen.getByRole('textbox', { name: `Wiederholungen für Satz ${set}` });
  const weight = (set: number) => screen.getByRole('textbox', { name: `Gewicht für Satz ${set} in kg` });
  const checkbox = (set: number) => screen.getByRole('checkbox', { name: new RegExp(`Satz ${set}: Vorgabe 8 Wiederholungen`) });
  const closeRest = () => fireEvent.click(screen.getByRole('button', { name: 'Pause schließen' }));
  /** Type a value and leave the field, the way a user does. */
  const enter = (input: HTMLElement, text: string) => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
  };

  beforeEach(async () => {
    (await import('@/lib/setWriteIntents')).resetSetWriteIntentsForTests();
  });

  it('recording reps and weight neither completes the set nor starts rest, and a reload restores them open', async () => {
    const planBefore = structuredClone(PLAN);
    const view = render(card(MONDAY));
    await startFromCard();

    enter(reps(1), '8');
    enter(weight(1), '52,5');

    await waitFor(() => expect(setLogs()).toEqual([
      { setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 8, weightUsed: 52.5 },
    ]));
    expect(checkbox(1)).toHaveAttribute('aria-checked', 'false');
    expect(within(running()).getByText('0/5 Sätze')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Pause' })).toBeNull();
    expect(localStorage.getItem(restKey)).toBeNull();
    expect(PLAN).toEqual(planBefore);

    view.unmount();
    (await import('@/lib/setWriteIntents')).resetSetWriteIntentsForTests();
    queryClient = freshQueryClient();
    render(card(MONDAY));

    await waitFor(() => expect(reps(1)).toHaveValue('8'));
    expect(weight(1)).toHaveValue('52,5');
    expect(checkbox(1)).toHaveAttribute('aria-checked', 'false');
    expect(within(running()).getByText('0/5 Sätze')).toBeInTheDocument();
  });

  it('never records the prescription shown as a placeholder, on blur, Enter or completion (TRAINING-UI-02)', async () => {
    render(card(MONDAY));
    await startFromCard();

    expect(reps(1)).toHaveAttribute('placeholder', '8');
    expect(reps(1)).toHaveValue('');
    // Leaving and confirming an untouched field saves nothing.
    fireEvent.focus(reps(1));
    fireEvent.blur(reps(1));
    fireEvent.keyDown(reps(1), { key: 'Enter' });
    fireEvent.blur(weight(1));
    expect(writes).toHaveLength(0);

    // Completing the set records completion only and starts rest once.
    fireEvent.click(checkbox(1));
    expect(screen.getAllByRole('dialog', { name: 'Pause' })).toHaveLength(1);
    await waitFor(() => expect(setLogs()).toEqual([
      { setNumber: 1, completed: true, completedAt: expect.anything(), performanceSource: 'completion-only' },
    ]));
    closeRest();
    expect(reps(1)).toHaveValue('');
    expect(reps(1)).toHaveAttribute('placeholder', '8');
    expect(checkbox(1)).toHaveAttribute('aria-checked', 'true');
  });

  it('writes and reads recorded values on Monday while the calendar shows other days', async () => {
    const view = render(card(MONDAY));
    await startFromCard();
    view.rerender(card(TUESDAY));
    await waitFor(() => expect(within(running()).getByRole('button', { name: /^Kniebeugen/ })).toBeInTheDocument());

    enter(reps(2), '6');

    await waitFor(() => expect(setLogs()).toHaveLength(1));
    expect(parentLogs()).toEqual([expect.objectContaining({ ...MONDAY_BINDING, exerciseIndex: 0 })]);
    expect(setLogs()[0]).toMatchObject({ setNumber: 2, repsCompleted: 6, completed: false });

    view.rerender(card(NEXT_THURSDAY));
    expect(reps(2)).toHaveValue('6');
    expect(queryClient.getQueryData(queryKeys.sets.byDay(PLAN_ID, 'Week 1', 1))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.sets.byDay(PLAN_ID, 'Week 2', 3))).toBeUndefined();
  });

  it.each(['running', 'paused'])('editing recorded values leaves %s rest exactly as it was', async (status) => {
    render(card(MONDAY));
    await startFromCard();
    fireEvent.click(checkbox(1));
    expect(screen.getByRole('dialog', { name: 'Pause' })).toBeInTheDocument();
    if (status === 'paused') fireEvent.click(screen.getByRole('button', { name: 'Timer pausieren' }));
    closeRest();
    await waitFor(() => expect(setLogs()).toHaveLength(1));
    const rest = savedRest();

    act(() => { vi.setSystemTime(NOW + 5000); });
    enter(reps(1), '8');
    enter(weight(1), '60');

    await waitFor(() => expect(setLogs()[0]).toMatchObject({ completed: true, repsCompleted: 8, weightUsed: 60 }));
    expect(savedRest()).toEqual(rest);
    expect(screen.queryByRole('dialog', { name: 'Pause' })).toBeNull();
    const inline = screen.getByRole('button', { name: 'Pause für Satz 1 öffnen' });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(within(inline).getByRole('timer')).toHaveTextContent(status === 'running' ? '00:55' : '01:00');
  });

  it('ticking starts the prescribed rest once, saves an unblurred value first and copies nothing; un-ticking keeps values', async () => {
    render(card(MONDAY));
    await startFromCard();
    enter(weight(1), '52,5');
    await waitFor(() => expect(setLogs()).toHaveLength(1));
    expect(localStorage.getItem(restKey)).toBeNull();

    // Typed, never blurred - a tap on the tick does not blur on every phone.
    fireEvent.change(reps(1), { target: { value: '9' } });
    fireEvent.click(checkbox(1));

    expect(screen.getAllByRole('dialog', { name: 'Pause' })).toHaveLength(1);
    expect(savedRest().state).toMatchObject({ exerciseIndex: 0, setNumber: 1, totalRestSeconds: 60 });
    await waitFor(() => expect(setLogs()).toEqual([{
      setNumber: 1, completed: true, completedAt: expect.anything(),
      performanceSource: 'user-recorded', repsCompleted: 9, weightUsed: 52.5,
    }]));

    closeRest();
    enter(reps(2), '');
    fireEvent.click(checkbox(2));
    expect(savedRest().state).toMatchObject({ setNumber: 2 });
    closeRest();
    await waitFor(() => expect(setLogs()).toHaveLength(2));
    expect(setLogs()[1]).toEqual({ setNumber: 2, completed: true, completedAt: expect.anything(), performanceSource: 'completion-only' });

    fireEvent.click(checkbox(2)); // Exact owner undo cancels its own rest.
    await waitFor(() => expect(setLogs()).toHaveLength(1));
    expect(localStorage.getItem(restKey)).toBeNull();

    fireEvent.click(checkbox(1));
    await waitFor(() => expect(setLogs()[0]).toEqual({
      setNumber: 1, completed: false, performanceSource: 'user-recorded', repsCompleted: 9, weightUsed: 52.5,
    }));
    expect(reps(1)).toHaveValue('9');
    expect(weight(1)).toHaveValue('52,5');
  });

  it('does not lose the last edit when finishing straight away, and saves it before the finish', async () => {
    render(card(MONDAY));
    await startFromCard();

    // Still in the field when "Training beenden" is pressed.
    fireEvent.change(weight(1), { target: { value: '52,5' } });
    fireEvent.click(screen.getByRole('button', { name: /^Training beenden/ }));

    const summary = await screen.findByRole('dialog', { name: 'Training abschließen?' });
    const recordedSection = within(summary).getByRole('region', { name: 'Erfasste Leistung' });
    expect(within(recordedSection).getByText('Kniebeugen')).toBeInTheDocument();
    expect(within(recordedSection).getByText('Satz 1 · 52,5 kg · offen')).toBeInTheDocument();
    expect(recordedSection.textContent).not.toMatch(/8 Wdh/);

    fireEvent.click(within(summary).getByRole('button', { name: /Training speichern & beenden/ }));

    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBeNull());
    expect(setLogs()).toEqual([{ setNumber: 1, completed: false, performanceSource: 'user-recorded', weightUsed: 52.5 }]);
    const setWrite = writes.findIndex((write) => write.path.includes('/workout_set_logs/'));
    const finishWrite = writes.findIndex((write) => write.data.durationSec !== undefined);
    expect(setWrite).toBeGreaterThanOrEqual(0);
    expect(setWrite).toBeLessThan(finishWrite);
  });

  it('keeps the user in the workout, at the field, when a value cannot be saved', async () => {
    render(card(MONDAY));
    await startFromCard();

    fireEvent.change(weight(1), { target: { value: '52,555' } });
    fireEvent.click(screen.getByRole('button', { name: /^Training beenden/ }));

    expect(screen.queryByRole('dialog', { name: 'Training abschließen?' })).toBeNull();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Kniebeugen, Satz 1'), 'error');
    expect(weight(1)).toHaveValue('52,555');
    expect(weight(1)).toHaveAttribute('aria-invalid', 'true');
    expect(weight(1)).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Gewicht');
    expect(writes).toHaveLength(0);
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it('keeps recorded and unsaved values through exercise guidance and collapsing', async () => {
    render(card(MONDAY));
    await startFromCard();
    enter(reps(1), '8');
    await waitFor(() => expect(setLogs()).toHaveLength(1));
    const writesBefore = writes.length;

    fireEvent.click(screen.getByRole('button', { name: 'Informationen zu Kniebeugen' }));
    expect(screen.getByRole('dialog', { name: 'Kniebeugen' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Übungsdetails schließen' }));
    expect(reps(1)).toHaveValue('8');

    fireEvent.change(weight(1), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /^Kniebeugen/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Kniebeugen/ }));
    expect(weight(1)).toHaveValue('40');
    expect(reps(1)).toHaveValue('8');
    expect(writes.length).toBeGreaterThanOrEqual(writesBefore);
    expect(localStorage.getItem(restKey)).toBeNull();
  });
});
