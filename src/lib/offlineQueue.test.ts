import { describe, it, expect, beforeEach } from 'vitest';
import {
    OfflineMutationEntry,
    enqueue,
    updateEntry,
    removeEntry,
    loadQueue,
    clearAll
} from './offlineQueue';

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

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock
});

describe('offlineQueue', () => {
    beforeEach(() => {
        window.localStorage.clear();
        clearAll();
    });

    it('should enqueue items correctly', () => {
        const payload = {
            planId: '1',
            weekKey: 'week1',
            dayIndex: 0,
            exerciseIndex: 0,
            completed: true
        };

        const result = enqueue('TOGGLE_DAY_COMPLETION', payload);

        expect(result.queue).toHaveLength(1);
        expect(result.entry.type).toBe('TOGGLE_DAY_COMPLETION');
        expect(result.entry.payload).toEqual(payload);
        expect(result.entry.status).toBe('pending');

        // Check persistence
        const loaded = loadQueue();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].id).toBe(result.entry.id);
    });

    it('should update entry status', () => {
        const payload = {
            planId: '1',
            weekKey: 'week1',
            dayIndex: 0,
            exerciseIndex: 0,
            completed: true
        };

        const { entry } = enqueue('TOGGLE_DAY_COMPLETION', payload);

        const updatedQueue = updateEntry(entry.id, { status: 'syncing', attempts: 1 });

        expect(updatedQueue[0].status).toBe('syncing');
        expect(updatedQueue[0].attempts).toBe(1);

        const loaded = loadQueue();
        expect(loaded[0].status).toBe('syncing');
    });

    it('should remove entry', () => {
        const { entry } = enqueue('TOGGLE_DAY_COMPLETION', {
            planId: '1',
            weekKey: 'week1',
            dayIndex: 0,
            exerciseIndex: 0,
            completed: true
        });

        let queue = loadQueue();
        expect(queue).toHaveLength(1);

        const updatedQueue = removeEntry(entry.id);

        expect(updatedQueue).toHaveLength(0);
        expect(loadQueue()).toHaveLength(0);
    });
});
