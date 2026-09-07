import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/lib/i18n';
import TodayWorkoutCard from '../components/TodayWorkoutCard';
import { TrainingProvider } from '../contexts/TrainingContext';
import React from 'react';
import { rows, writes, control, resetWorkoutFirestore, logPath } from '@/test/mocks/workoutFirestore';
import { isCompletedDayLog } from '@/lib/workoutCompletion';
import { SESSION_STORAGE_KEY } from '@/lib/trainingSession';
const showToast = vi.hoisted(() => vi.fn());
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
    beforeEach(() => {
        vi.clearAllMocks();
        resetWorkoutFirestore();
        localStorage.clear();
        localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(SEEDED_EXERCISES));
        rows.set(logPath('a-exercise'), exercise);
        rows.set(logPath('b-day'), selectedDay);
        vi.spyOn(Date, 'now').mockReturnValue(STARTED);
    });
    afterEach(() => vi.restoreAllMocks());
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
    const assertSafeSave = () => {
        expect(rows.get(logPath('a-exercise'))).toEqual(exercise);
        expect(rows.get(logPath('b-day'))).toEqual(selectedDay);
        expect(writes).toHaveLength(1);
        expect(writes[0].data).toMatchObject({ ...A, durationSec: 2700 });
        expect([...rows.values()].some(isCompletedDayLog)).toBe(false);
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
        const bound = localStorage.getItem(SESSION_STORAGE_KEY);
        view.rerender(card(true));
        control.rejectNext = true;
        fireEvent.click(await openSummary());
        expect(await screen.findByRole('alert')).toHaveTextContent('Deine Session bleibt aktiv');
        expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(bound);
        expect(showToast.mock.calls.every(call => call[1] === 'error')).toBe(true);
        expect(writes).toHaveLength(0);
        expect(screen.getByRole('button', { name: /Erneut speichern/i })).toBeEnabled();
        view.unmount();
        view = render(card(true));
        fireEvent.click(await openSummary());
        await waitFor(() => expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
        assertSafeSave();
        expect(showToast.mock.calls.filter(call => call[1] !== 'error')).toHaveLength(1);
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
        view.rerender(card(false, true));
        fireEvent.click(screen.getByRole('button', { name: /Erneut speichern/i }));
        await waitFor(() => expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
        assertSafeSave();
    });

    it('does not report success when the duration cannot be measured', async () => {
        render(card());
        await start();
        vi.mocked(Date.now).mockReturnValue(STARTED - 1000);
        fireEvent.click(await openSummary());
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(writes).toHaveLength(0);
        expect(localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
        expect(showToast.mock.calls.every(call => call[1] === 'error')).toBe(true);
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
});
