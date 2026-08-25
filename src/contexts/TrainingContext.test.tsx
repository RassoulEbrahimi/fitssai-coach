import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrainingProvider, useTraining } from '../contexts/TrainingContext';
import React from 'react';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value.toString();
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        }
    };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('TrainingContext', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TrainingProvider>{children}</TrainingProvider>
    );

    it('starts with default values', () => {
        const { result } = renderHook(() => useTraining(), { wrapper });
        expect(result.current.isStarted).toBe(false);
        expect(result.current.duration).toBe(0);
        expect(result.current.todayWorkouts).toEqual([]);
    });

    it('starts a session and updates timer', () => {
        const { result } = renderHook(() => useTraining(), { wrapper });

        act(() => {
            // A session is now bound to the plan day it was started from, and
            // persists as one versioned payload under a single key.
            result.current.startSession({ planId: 'plan-1', weekKey: 'Week 2', dayIndex: 3 });
        });

        expect(result.current.isStarted).toBe(true);

        const stored = JSON.parse(localStorage.getItem('fitssai.training.session') as string);
        expect(stored.planId).toBe('plan-1');
        expect(stored.weekKey).toBe('Week 2');
        expect(stored.dayIndex).toBe(3);
        expect(stored.startedAt).toBeGreaterThan(0);

        // The two legacy keys are gone.
        expect(localStorage.getItem('fitssai.training.session.started')).toBeNull();
        expect(localStorage.getItem('fitssai.training.session.start_time')).toBeNull();

        // Fast forward 5 seconds
        act(() => {
            vi.advanceTimersByTime(5000);
        });

        // Note: In real hook, duration updates via interval.
        // We expect duration to be >= 5 (allow some jitter)
        expect(result.current.duration).toBeGreaterThanOrEqual(5);
    });

    it('ends a session and clears storage', () => {
        const { result } = renderHook(() => useTraining(), { wrapper });

        act(() => {
            result.current.startSession({ planId: 'plan-1', weekKey: 'Week 1', dayIndex: 0 });
            vi.advanceTimersByTime(2000); // 2 seconds
            result.current.endSession();
        });

        expect(result.current.isStarted).toBe(false);
        expect(result.current.duration).toBe(0);
        expect(localStorage.getItem('fitssai.training.session')).toBeNull();
    });

    it('persists a bound session across reloads (simulated)', () => {
        const startedAt = Date.now() - 10000; // Started 10s ago
        localStorage.setItem('fitssai.training.session', JSON.stringify({
            version: 1,
            planId: 'plan-1',
            weekKey: 'Week 3',
            dayIndex: 5,
            startedAt,
        }));

        const { result } = renderHook(() => useTraining(), { wrapper });

        expect(result.current.isStarted).toBe(true);
        expect(result.current.duration).toBeGreaterThanOrEqual(10);
        // The exact plan day survives — it is not re-derived from "today".
        expect(result.current.session?.weekKey).toBe('Week 3');
        expect(result.current.session?.dayIndex).toBe(5);
    });

    it('does not resume from the legacy keys, which carried no plan binding', () => {
        // Pre-PR7 storage recorded only "started" + "start_time", so a resumed
        // session had to guess its day. Those keys are now cleared instead.
        localStorage.setItem('fitssai.training.session.started', 'true');
        localStorage.setItem('fitssai.training.session.start_time', String(Date.now() - 5000));

        const { result } = renderHook(() => useTraining(), { wrapper });

        expect(result.current.isStarted).toBe(false);
        expect(result.current.session).toBeNull();
        expect(localStorage.getItem('fitssai.training.session.started')).toBeNull();
        expect(localStorage.getItem('fitssai.training.session.start_time')).toBeNull();
    });

    it('discards a stale session instead of rebinding it to today', () => {
        localStorage.setItem('fitssai.training.session', JSON.stringify({
            version: 1,
            planId: 'old-plan',
            weekKey: 'Week 2',
            dayIndex: 1,
            startedAt: Date.now() - 5000,
        }));

        const { result } = renderHook(() => useTraining(), { wrapper });
        expect(result.current.isStarted).toBe(true);

        act(() => {
            // The loaded plan is a different one.
            result.current.validateSessionAgainstPlan({
                planId: 'current-plan',
                hasDay: () => true,
            });
        });

        expect(result.current.isStarted).toBe(false);
        expect(result.current.session).toBeNull();
        expect(result.current.rejectionNotice).toBeTruthy();
        expect(localStorage.getItem('fitssai.training.session')).toBeNull();
    });
});
