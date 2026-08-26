import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/lib/i18n';
import TodayWorkoutCard from '../components/TodayWorkoutCard';
import { TrainingProvider } from '../contexts/TrainingContext';
import React from 'react';

// Mocks
vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ user: { id: 'test-user' } }),
}));

vi.mock('@/hooks/useThrottledToast', () => ({
    useThrottledToast: () => ({ showToast: vi.fn() }),
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
        localStorage.clear();
        localStorage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(SEEDED_EXERCISES));
    });

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
