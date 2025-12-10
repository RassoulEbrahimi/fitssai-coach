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
            result.current.startSession();
        });

        expect(result.current.isStarted).toBe(true);
        expect(localStorage.getItem('fitssai.training.session.started')).toBe('true');
        expect(localStorage.getItem('fitssai.training.session.start_time')).toBeTruthy();

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
            result.current.startSession();
            vi.advanceTimersByTime(2000); // 2 seconds
            result.current.endSession();
        });

        expect(result.current.isStarted).toBe(false);
        expect(result.current.duration).toBe(0);
        expect(localStorage.getItem('fitssai.training.session.started')).toBeNull();
        expect(localStorage.getItem('fitssai.training.session.start_time')).toBeNull();
    });

    it('persists session across reloads (simulated)', () => {
        const startTime = Date.now() - 10000; // Started 10s ago
        localStorage.setItem('fitssai.training.session.started', 'true');
        localStorage.setItem('fitssai.training.session.start_time', startTime.toString());

        const { result } = renderHook(() => useTraining(), { wrapper });

        expect(result.current.isStarted).toBe(true);
        // Duration should calculate immediately
        expect(result.current.duration).toBeGreaterThanOrEqual(10);
    });
});
