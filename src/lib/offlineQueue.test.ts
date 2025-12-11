import {
    OfflineMutationEntry,
    enqueue,
    updateEntry,
    removeEntry,
    loadQueue,
    saveQueue,
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
        let queue: OfflineMutationEntry[] = loadQueue();
        const payload = {
            planId: '1',
            weekKey: 'week1',
            dayIndex: 0,
            exerciseIndex: 0,
            completed: true
        };

        const result = enqueue(queue, 'TOGGLE_DAY_COMPLETION', payload);

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
        let queue: OfflineMutationEntry[] = [];
        const payload = {
            planId: '1',
            weekKey: 'week1',
            dayIndex: 0,
            exerciseIndex: 0,
            completed: true
        };

        const { queue: q1, entry } = enqueue(queue, 'TOGGLE_DAY_COMPLETION', payload);
        queue = q1;

        queue = updateEntry(queue, entry.id, { status: 'syncing', attempts: 1 });

        expect(queue[0].status).toBe('syncing');
        expect(queue[0].attempts).toBe(1);

        const loaded = loadQueue();
        expect(loaded[0].status).toBe('syncing');
    });

    it('should remove entry', () => {
        let queue: OfflineMutationEntry[] = [];
        const { queue: q1, entry } = enqueue(queue, 'TOGGLE_DAY_COMPLETION', {
            planId: '1',
            weekKey: 'week1',
            dayIndex: 0,
            exerciseIndex: 0,
            completed: true
        });
        queue = q1;

        expect(queue).toHaveLength(1);

        queue = removeEntry(queue, entry.id);

        expect(queue).toHaveLength(0);
        expect(loadQueue()).toHaveLength(0);
    });
});
