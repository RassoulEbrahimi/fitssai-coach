import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('TodayWorkoutCard', () => {
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

    it.skip('renders start button when session not started', () => {
        renderWithProvider(<TodayWorkoutCard {...defaultProps} />);
        expect(screen.getByText('Start Training')).toBeInTheDocument();
    });

    it.skip('shows live timer and finish button when started', () => {
        const { getByText } = renderWithProvider(<TodayWorkoutCard {...defaultProps} />);

        // Start training
        fireEvent.click(screen.getByText('Start Training'));

        // Check that we switched to active view
        expect(screen.getByText(/Training im Gange/i)).toBeInTheDocument();
        expect(screen.getByText('Training beenden')).toBeInTheDocument();
    });
});
