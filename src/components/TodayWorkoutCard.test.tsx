import { render as testingRender, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/lib/i18n';
import TodayWorkoutCard from '../components/TodayWorkoutCard';
import { TrainingProvider } from '../contexts/TrainingContext';
import React from 'react';
import { rows, writes, control, resetWorkoutFirestore, logPath } from '@/test/mocks/workoutFirestore';
import { isCalendarDayComplete, isCompletedDayLog, readCompletedDays, readCompletedDayDates } from '@/lib/workoutCompletion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWorkoutLogs } from '@/hooks/queries/useWorkoutLogs';
import { useWeeklyActivity } from '@/hooks/useWeeklyActivity';
import { buildWeeklyReviewMetrics } from '@/lib/coaching/reviewMetrics';
import { evaluateTrainingNudges } from '@/lib/nudges/eligibility';
import { recordSuccessfulWorkoutFinish } from '@/lib/sessionRecord';
import { generateInsights } from '@/lib/insights/engine';
import { queryKeys } from '@/lib/queryKeys';
import type { WorkoutPlan } from '@/lib/types';
import { SESSION_STORAGE_KEY } from '@/lib/trainingSession';
import { MAX_SESSION_SEC } from '@/lib/workoutLog';
const showToast = vi.hoisted(() => vi.fn());
let queryClient: QueryClient;
beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => queryClient.clear());
const render = (ui: React.ReactNode) => testingRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
});
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);

// Mocks
vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ user: { id: 'u1', uid: 'u1' } }),
}));

vi.mock('@/hooks/useThrottledToast', () => ({
    useThrottledToast: () => ({ showToast }),
}));

vi.mock('@/contexts/FocusModeContext', () => ({
    useFocusMode: () => ({ isFocusMode: false, setFocusMode: vi.fn() }),
}));

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
    useRestTimer: () => ({
        timerState: { remaining: 0, isActive: false },
        startTimer: vi.fn(),
        skipTimer: vi.fn(),
    }),
}));

vi.mock('@/hooks/useBerlinToday', () => ({
    useBerlinToday: () => '2025-12-10',
}));

vi.mock('@/hooks/useWorkoutHelpers', () => ({
    useWorkoutHelpers: () => ({
        getWeekContentWithFallback: () => ({}),
    }),
}));

vi.mock('canvas-confetti', () => ({
    default: vi.fn(),
}));

/*
  The card reads its exercises from TrainingDataContext, which seeds itself
  from localStorage. Seeding it drives the real provider rather than mocking
  the thing under test; with no exercises the card renders the rest-day view.
*/
const WORKOUT_STORAGE_KEY = 'fitssai.training.cache';
const SEEDED_EXERCISES = [
    { id: 'e1', name: 'Bankdrücken', sets: 3, reps: '10', rest: '90s', weight: '', weekKey: 'week1', dayIndex: 0, exerciseIndex: 0 },
    { id: 'e2', name: 'Klimmzüge', sets: 3, reps: '8', rest: '90s', weight: '', weekKey: 'week1', dayIndex: 1, exerciseIndex: 1 },
];

describe('TodayWorkoutCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetWorkoutFirestore();
        localStorage.clear();
        localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(SEEDED_EXERCISES));
    });

    afterEach(() => vi.restoreAllMocks());

    const defaultProps = {
        selectedDate: new Date('2025-12-10'),
        weekKey: 'week1',
        dayIndex: 0,
        workoutPlan: { id: 'plan1', content: { name: 'Test Workout' } },
        completionMap: {},
        isLoading: false,
        toggleExercise: vi.fn(),
        isToggling: false,
    };

    const renderWithProvider = (ui: React.ReactNode) => {
        return render(
            <TrainingProvider>
                {ui}
            </TrainingProvider>
        );
    };

    /*
      These two were `it.skip` and asserted the pre-PR3 English labels
      ("Start Training", "Training im Gange"). The whole file also failed to
      collect on Firebase's module-scope init, so neither the skip nor the
      stale strings were visible. Both now run against the German UI.
    */
    it('renders the start button when the session has not started', () => {
        renderWithProvider(<TodayWorkoutCard {...defaultProps} />);

        expect(screen.getByRole('button', { name: /Training starten/i })).toBeInTheDocument();
        expect(screen.queryByText(/Training beenden/i)).not.toBeInTheDocument();
    });

    it('switches to the active view when training starts', async () => {
        renderWithProvider(<TodayWorkoutCard {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: /Training starten/i }));

        // The two views swap inside <AnimatePresence mode="wait">, so the
        // incoming one only mounts once the outgoing one has finished exiting.
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Training beenden/i })).toBeInTheDocument()
        );
        expect(screen.getByText(/Training läuft/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Training starten/i })).not.toBeInTheDocument();
    });

    it('imports without Firebase credentials configured', () => {
        // Regression: this file failed during collection with
        // auth/invalid-api-key before the Firebase test double existed.
        expect(TodayWorkoutCard).toBeDefined();
    });
});


describe('session finish persistence across selected-day navigation', () => {
    const A = { planId: 'plan1', weekKey: 'Week 1', dayIndex: 0, workoutDay: '2026-09-07' };
    const B = { ...A, dayIndex: 1, workoutDay: '2026-09-08' };
    const exercise = { ...A, exerciseIndex: 0, completed: true };
    const selectedDay = { ...B, completed: false, durationSec: 120 };
    const STARTED = Date.parse('2026-09-07T10:00:00Z');
    const props = {
        selectedDate: new Date('2026-09-07T12:00:00'), weekKey: A.weekKey, dayIndex: A.dayIndex,
        workoutPlan: { id: A.planId, created_at: '2026-09-07T08:00:00Z', content: { name: 'Test Workout' } },
        completionMap: {}, isLoading: false, toggleExercise: vi.fn(), isToggling: false,
    };
    const plan = { ...props.workoutPlan, content: {
        'Week 1': Array.from({ length: 7 }, (_, i) => ({
            day: `Day ${i}`, exercises: [0, 2, 4].includes(i) ? [{ name: 'Squat', sets: 3, reps: '8' }] : [],
        })),
    } } as unknown as WorkoutPlan;
    // Real query adapters and consumer calculations stay mounted with fresh
    // five-minute caches. A finish must refresh them from the committed row.
    const ProgressConsumers = () => {
        const { data: logs = [], isLoading } = useWorkoutLogs(A.planId);
        const activity = useWeeklyActivity();
        const review = buildWeeklyReviewMetrics({ plan, weekKey: A.weekKey, weekNumber: 1, logs });
        const nudge = evaluateTrainingNudges({ plan, date: props.selectedDate, logs });
        if (isLoading || activity.isLoading) return <output data-testid="progress">loading</output>;
        return <output data-testid="progress">{JSON.stringify({
            calendar: isCalendarDayComplete(logs, A.workoutDay),
            weeklyProgress: readCompletedDayDates(logs).length,
            completedDays: review.completedDays, scheduledDays: review.scheduledDays,
            percent: review.completionPercent, coverage: review.durationCoverage,
            measured: review.measuredSessionCount, unmeasured: review.unmeasuredSessionCount,
            activeDays: activity.activeDays, workouts: activity.totalWorkouts,
            minutes: activity.measuredMinutes, nudgeEligible: nudge.eligible,
        })}</output>;
    };
    const progress = () => JSON.parse(screen.getByTestId('progress').textContent!);
    beforeEach(() => {
        vi.clearAllMocks();
        resetWorkoutFirestore();
        localStorage.clear();
        localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(SEEDED_EXERCISES));
        rows.set(logPath('a-exercise'), exercise);
        rows.set(logPath('b-day'), selectedDay);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(STARTED);
        vi.spyOn(Date, 'now').mockReturnValue(STARTED);
    });
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
    const card = (dayB = false, isOnline = true) => <TrainingProvider>
        <TodayWorkoutCard {...props} isOnline={isOnline} {...(dayB ? {
            selectedDate: new Date('2026-09-08T12:00:00'), dayIndex: 1,
        } : {})} />
    </TrainingProvider>;
    const start = async () => {
        fireEvent.click(screen.getByRole('button', { name: /Training starten/i }));
        await screen.findByRole('button', { name: /^Training beenden/i });
        vi.mocked(Date.now).mockReturnValue(STARTED + 2700_000);
    };
    const openSummary = async () => {
        fireEvent.click(await screen.findByRole('button', { name: /^Training beenden/i }));
        return screen.findByRole('button', { name: /Training speichern & beenden/i });
    };
    const storedSession = () => {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY);
        return raw === null ? null : JSON.parse(raw) as Record<string, unknown>;
    };
    /** The bound identity, without the finish stamp that a save attempt adds. */
    const boundIdentity = () => {
        const stored = storedSession();
        if (!stored) return null;
        const { endedAt: _stamp, ...identity } = stored;
        return identity;
    };
    const assertSafeSave = () => {
        expect(rows.get(logPath('a-exercise'))).toEqual(exercise);
        expect(rows.get(logPath('b-day'))).toEqual(selectedDay);
        expect(writes).toHaveLength(1);
        expect(writes[0].data).toMatchObject({ ...A, durationSec: 2700, completed: true });
        expect(writes[0].data.completedAt).toEqual(expect.objectContaining({ millis: STARTED + 2700_000 }));
        expect(readCompletedDays([...rows.values()])).toEqual([{ weekKey: A.weekKey, dayIndex: A.dayIndex }]);
    };

    it.each([false, true])('saves A after navigating to B (return to A: %s)', async returnToA => {
        const view = render(card());
        await start();
        const bound = localStorage.getItem(SESSION_STORAGE_KEY);
        view.rerender(card(true));
        expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(bound);
        if (returnToA) view.rerender(card());
        fireEvent.click(await openSummary());
        await waitFor(() => expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
        assertSafeSave();
        expect(showToast).toHaveBeenCalledWith(expect.any(String));
    });

    it('keeps the session and timer on rejection, survives remount, and retries successfully', async () => {
        let view = render(card());
        await start();
        const bound = boundIdentity();
        view.rerender(card(true));
        control.rejectNext = true;
        fireEvent.click(await openSummary());
        expect(await screen.findByRole('alert')).toHaveTextContent('Deine Session bleibt aktiv');
        expect(boundIdentity()).toEqual(bound);
        // The finish instant is frozen at the first attempt, and it is stored,
        // so the retry below cannot re-measure and inflate the duration.
        expect(storedSession()?.endedAt).toBe(STARTED + 2700_000);
        expect(showToast.mock.calls.every(call => call[1] === 'error')).toBe(true);
        expect(writes).toHaveLength(0);
        expect([...rows.values()].some(isCompletedDayLog)).toBe(false);
        expect(screen.getByRole('button', { name: /Erneut speichern/i })).toBeEnabled();
        view.unmount();
        // A remount reads the stamp back from storage rather than restarting it.
        view = render(card(true));
        expect(storedSession()?.endedAt).toBe(STARTED + 2700_000);
        vi.mocked(Date.now).mockReturnValue(STARTED + 2700_000 + 5400_000);
        fireEvent.click(await openSummary());
        await waitFor(() => expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
        // 2700s: the workout, not the 90 minutes spent getting back to it.
        assertSafeSave();
        expect(showToast.mock.calls.filter(call => call[1] !== 'error')).toHaveLength(1);
        expect(showToast.mock.calls.at(-1)).toEqual([expect.any(String)]);
    });

    it('waits for acknowledgement and ignores repeated save clicks', async () => {
        render(card());
        await start();
        let release!: () => void;
        control.beforeCommit = () => new Promise<void>(resolve => { release = resolve; });
        const save = await openSummary();
        fireEvent.click(save);
        fireEvent.click(save);
        await waitFor(() => expect(release).toBeDefined());
        expect(save).toBeDisabled();
        expect(localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
        expect(showToast).not.toHaveBeenCalled();
        expect([...rows.values()].some(isCompletedDayLog)).toBe(false);
        await act(async () => release());
        await waitFor(() => expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
        assertSafeSave();
    });

    it('keeps offline finish recoverable without using the queue', async () => {
        const view = render(card());
        await start();
        view.rerender(card(false, false));
        fireEvent.click(await openSummary());
        expect(await screen.findByRole('alert')).toHaveTextContent('erneut versuchen');
        expect(writes).toHaveLength(0);
        expect(localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
        expect(showToast.mock.calls.every(call => call[1] === 'error')).toBe(true);
        expect(storedSession()?.endedAt).toBe(STARTED + 2700_000);
        // Reconnecting an hour later must not bill that hour to the workout.
        view.rerender(card(false, true));
        vi.mocked(Date.now).mockReturnValue(STARTED + 2700_000 + 3600_000);
        fireEvent.click(screen.getByRole('button', { name: /Erneut speichern/i }));
        await waitFor(() => expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
        assertSafeSave();
    });

    /*
      A skipped measurement is not a failed write. Holding the session open for
      a retry would trap the user: past MAX_SESSION_SEC every future attempt
      skips for the same reason, so there is nothing a retry could fix.
    */
    it.each([
        ['left running past the plausible maximum', STARTED + (MAX_SESSION_SEC + 60) * 1000],
        ['ended before it started', STARTED - 1000],
    ])('ends the session truthfully when the duration is unmeasurable: %s', async (_case, finishAt) => {
        render(card());
        await start();
        vi.mocked(Date.now).mockReturnValue(finishAt);
        fireEvent.click(await openSummary());

        // Terminal, not retryable: the session is gone and the user is back at
        // a card they can start again.
        await waitFor(() => expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
        expect(await screen.findByRole('button', { name: /Training starten/i })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Erneut speichern/i })).not.toBeInTheDocument();

        // Nothing invented: no duration, no completion, no row touched.
        expect(writes).toHaveLength(0);
        expect(rows.get(logPath('a-exercise'))).toEqual(exercise);
        expect(rows.get(logPath('b-day'))).toEqual(selectedDay);
        expect([...rows.values()].some(isCompletedDayLog)).toBe(false);

        // Truthful: neither a saved-training success nor a save error.
        expect(evaluateTrainingNudges({ plan, date: props.selectedDate, logs: [...rows.values()] }).eligible).toBe(true);
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('Dauer konnte nicht gemessen werden'), 'info');
    });

    it('reopens a still-running session for a longer finish after going back', async () => {
        render(card());
        await start();
        control.rejectNext = true;
        fireEvent.click(await openSummary());
        await screen.findByRole('alert');
        expect(storedSession()?.endedAt).toBe(STARTED + 2700_000);

        // Going back is a decision to keep training, so the stamp goes with it.
        // Reusing it would cap the real finish at the moment they first thought
        // about stopping — the mirror image of the inflation it prevents.
        fireEvent.click(screen.getByRole('button', { name: /Zur.ck zum Training/i }));
        await waitFor(() => expect(storedSession()?.endedAt).toBeUndefined());
        expect(writes).toHaveLength(0);
        expect([...rows.values()].some(isCompletedDayLog)).toBe(false);

        vi.mocked(Date.now).mockReturnValue(STARTED + 3600_000);
        fireEvent.click(await openSummary());
        await waitFor(() => expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
        expect(writes).toHaveLength(1);
        expect(writes[0].data).toMatchObject({ ...A, durationSec: 3600, completed: true });
        expect(writes[0].data.completedAt).toEqual(expect.objectContaining({ millis: STARTED + 3600_000 }));
        expect(rows.get(logPath('a-exercise'))).toEqual(exercise);
    });

    it('resolves an older session from its bound plan position after navigation', async () => {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 1,
            planId: A.planId, weekKey: A.weekKey, dayIndex: A.dayIndex, startedAt: STARTED,
        }));
        vi.mocked(Date.now).mockReturnValue(STARTED + 2700_000);
        render(card(true));
        fireEvent.click(await openSummary());
        await waitFor(() => expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
        assertSafeSave();
    });

    it('does not complete on checked exercises, elapsed time, summary open or back-to-training', async () => {
        render(<>{card()}<ProgressConsumers /></>);
        await waitFor(() => expect(progress()).toMatchObject({ calendar: false, completedDays: 0, activeDays: 0, nudgeEligible: true }));
        await start();
        await openSummary();
        expect(writes).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: /Zur.ck zum Training/i }));
        expect(writes).toHaveLength(0);
        expect(storedSession()).not.toBeNull();
        expect(storedSession()?.endedAt).toBeUndefined();
        expect(progress()).toMatchObject({ calendar: false, completedDays: 0, activeDays: 0, nudgeEligible: true });
    });

    it('refreshes calendar, activity, review and nudge from one acknowledged finish and counts retries once', async () => {
        const originalPlan = JSON.stringify(plan);
        queryClient.setQueryData(queryKeys.plans.byUser('u1'), plan);
        render(<>{card()}<ProgressConsumers /></>);
        await waitFor(() => expect(progress()).toMatchObject({ calendar: false, weeklyProgress: 0, completedDays: 0, nudgeEligible: true }));
        await start();
        control.rejectNext = true;
        fireEvent.click(await openSummary());
        await screen.findByRole('alert');
        expect(progress()).toMatchObject({ calendar: false, completedDays: 0, activeDays: 0, nudgeEligible: true });
        expect(writes).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: /Erneut speichern/i }));
        await waitFor(() => expect(progress()).toEqual({ calendar: true, weeklyProgress: 1,
            completedDays: 1, scheduledDays: 3, percent: 33, coverage: 'full', measured: 1,
            unmeasured: 0, activeDays: 1, workouts: 1, minutes: 45, nudgeEligible: false }));
        assertSafeSave();
        // Replay the same frozen finish after acknowledgement (e.g. another tab).
        const finish = { uid: 'u1', ...A, startedAt: STARTED, endedAt: STARTED + 2700_000 };
        await recordSuccessfulWorkoutFinish(finish);
        await recordSuccessfulWorkoutFinish(finish);
        expect(readCompletedDays([...rows.values()])).toHaveLength(1);
        expect(new Set(writes.map(w => w.path)).size).toBe(1);
        expect(progress().completedDays).toBe(1);
        for (const [dayIndex, count, percent] of [[2, 2, 67], [4, 3, 100]]) {
            await recordSuccessfulWorkoutFinish({ ...finish, dayIndex, workoutDay: `2026-09-${String(7 + dayIndex).padStart(2, '0')}` });
            await act(async () => {
                await queryClient.invalidateQueries({ queryKey: queryKeys.logs.byPlan(A.planId, 'u1') });
                await queryClient.invalidateQueries({ queryKey: ['weekly-activity', 'u1'] });
            });
            await waitFor(() => expect(progress()).toMatchObject({ completedDays: count, percent,
                scheduledDays: 3, activeDays: count, workouts: count, measured: count, coverage: 'full' }));
        }
        expect(rows.get(logPath('a-exercise'))).toEqual(exercise);
        expect(rows.get(logPath('b-day'))).toEqual(selectedDay);
        expect(writes.every(w => w.path.startsWith('users/u1/workout_logs/day-session_'))).toBe(true);
        expect(JSON.stringify(plan)).toBe(originalPlan);
        expect(queryClient.getQueryState(queryKeys.plans.byUser('u1'))?.isInvalidated).toBe(false);
        expect(generateInsights({ activeDays: progress().activeDays }, null, 3, A.workoutDay)).toMatchObject({
            type: 'streak', payload: { activeDays: 3 },
        });
    });

    it('keeps zero-second duration coverage truthful after an explicit successful finish', async () => {
        render(<>{card()}<ProgressConsumers /></>);
        await waitFor(() => expect(progress().completedDays).toBe(0));
        await start();
        // PR #62 accepts zero elapsed seconds as written; readers correctly
        // count it as unmeasured rather than claiming measured training time.
        vi.mocked(Date.now).mockReturnValue(STARTED);
        fireEvent.click(await openSummary());
        await waitFor(() => expect(progress()).toMatchObject({ calendar: true, completedDays: 1,
            activeDays: 1, minutes: 0, measured: 0, unmeasured: 1, coverage: 'none', nudgeEligible: false }));
        expect(writes).toHaveLength(1);
        expect(writes[0].data).toMatchObject({ completed: true, durationSec: 0 });
    });
});
