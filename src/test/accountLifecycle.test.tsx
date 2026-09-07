import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query';

const identity = vi.hoisted(() => ({ currentUser: null as { uid: string } | null }));
const delayAuth = vi.hoisted(() => ({ value: false }));
const authEvents = vi.hoisted(() => new Set<(user: { uid: string } | null) => void>());
const firebaseSignOut = vi.hoisted(() => vi.fn(async () => {
  identity.currentUser = null;
  authEvents.forEach(listener => listener(null));
}));
vi.mock('@/lib/firebase', () => ({ auth: identity, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string } | null) => void) => {
    authEvents.add(callback);
    if (!delayAuth.value) callback(identity.currentUser);
    return () => authEvents.delete(callback);
  },
  signOut: firebaseSignOut,
}));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({ toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn() }));

import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { TrainingProvider, useTraining } from '@/contexts/TrainingContext';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { useSupabaseAction } from '@/hooks/useSupabaseAction';
import { LogoutButton } from '@/components/LogoutButton';
import { enqueue, loadQueue, updateEntry, type OfflineMutationEntry } from '@/lib/offlineQueue';
import { handlers } from '@/lib/offlineHandlers';
import { SIGN_OUT_PRESERVED_KEYS } from '@/lib/storage';
import { accountStorageKey } from '@/lib/accountIdentity';
import { control, firestore, resetWorkoutFirestore, writes } from '@/test/mocks/workoutFirestore';

const payload = { planId: 'plan-A', weekKey: 'Week 1', dayIndex: 0, workoutDay: '2026-09-07', completed: true };
let current: {
  queue: ReturnType<typeof useOfflineQueue>;
  training: ReturnType<typeof useTraining>;
  client: ReturnType<typeof useQueryClient>;
  restoring: boolean;
  action: ReturnType<typeof useSupabaseAction>;
};
const observations: { uid: string | undefined; profile: unknown; session: unknown }[] = [];
const remoteAction = vi.fn<() => Promise<unknown>>();

function Probe() {
  const { user, signOut } = useAuth();
  const queue = useOfflineQueue();
  const training = useTraining();
  const client = useQueryClient();
  const restoring = useIsRestoring();
  const action = useSupabaseAction({ action: remoteAction, offlineActionType: 'TOGGLE_DAY',
    toOfflinePayload: () => payload, retryConfig: { retries: 0, initialDelay: 0 } });
  const profile = useQuery({ queryKey: ['profile'], queryFn: async () => null, enabled: false }).data;
  current = { queue, training, client, restoring, action };
  observations.push({ uid: user?.uid, profile, session: training.session });
  return <><span data-testid="uid">{user?.uid ?? 'signed-out'}</span>
    <span data-testid="profile">{String(profile ?? '')}</span>
    <button onClick={() => void signOut()}>Context sign out</button>
    <LogoutButton /></>;
}

function Harness() {
  return <AuthProvider><QueryProvider><TrainingProvider><MemoryRouter><Probe /></MemoryRouter></TrainingProvider></QueryProvider></AuthProvider>;
}

const switchAccount = (uid: string | null) => act(() => {
  identity.currentUser = uid ? { uid } : null;
  authEvents.forEach(listener => listener(identity.currentUser));
});
const settled = () => waitFor(() => expect(current.restoring).toBe(false));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  identity.currentUser = { uid: 'A' };
  delayAuth.value = false;
  observations.length = 0;
  vi.clearAllMocks();
  resetWorkoutFirestore();
  // Avoid timed automatic replay; tests invoke the real flush explicitly.
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});

describe('account lifecycle through real auth, query, training and replay providers', () => {
  it('mounts no account consumers until identity is resolved and ignores ownerless hydrated state', async () => {
    delayAuth.value = true;
    localStorage.setItem('REACT_QUERY_OFFLINE_CACHE', JSON.stringify({ timestamp: Date.now(), buster: '',
      clientState: { mutations: [], queries: [{ queryKey: ['profile'], queryHash: '["profile"]',
        state: { data: 'legacy-A', status: 'success', dataUpdatedAt: Date.now() } }] } }));
    localStorage.setItem('fitssai.training.session', JSON.stringify({ version: 1, planId: 'p', weekKey: 'Week 1', dayIndex: 0, startedAt: Date.now() }));
    localStorage.setItem('fitssai.training.cache', JSON.stringify([{ id: 'private-A' }]));
    render(<Harness />);
    expect(screen.queryByTestId('uid')).toBeNull();
    expect(observations).toEqual([]);
    switchAccount('B');
    await settled();
    expect(current.training.session).toBeNull();
    expect(current.training.todayWorkouts).toEqual([]);
    expect(current.client.getQueryData(['profile'])).toBeUndefined();
    expect(localStorage.getItem('REACT_QUERY_OFFLINE_CACHE')).toBeNull();
  });
  it('A queues, signs out, B cannot replay; A returns and replays only its own work', async () => {
    render(<Harness />);
    await settled();
    act(() => { current.queue.enqueue('TOGGLE_DAY', payload); });
    const original = loadQueue()[0];
    expect(original.ownerUid).toBe('A');
    fireEvent.click(screen.getByText('Context sign out'));
    await waitFor(() => expect(screen.getByTestId('uid')).toHaveTextContent('signed-out'));
    switchAccount('B');
    await settled();
    await act(() => current.queue.flush());
    expect(writes).toEqual([]);
    expect(current.queue.pendingCount).toBe(0);
    expect(loadQueue()[0]).toEqual(original);
    switchAccount('A');
    await settled();
    await act(() => current.queue.flush());
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toMatch(/^users\/A\/workout_logs\//);
    expect(loadQueue()).toEqual([]);
  });

  it('multiple entries survive browser recreation without acquiring B ownership', async () => {
    let view = render(<Harness />);
    await settled();
    act(() => {
      current.queue.enqueue('TOGGLE_DAY', payload);
      current.queue.enqueue('TOGGLE_DAY', { ...payload, workoutDay: '2026-09-06' });
    });
    view.unmount();
    identity.currentUser = { uid: 'B' };
    view = render(<Harness />);
    await settled();
    await act(() => current.queue.flush());
    expect(writes).toEqual([]);
    expect(loadQueue().map(entry => entry.ownerUid)).toEqual(['A', 'A']);
    view.unmount();
    identity.currentUser = { uid: 'A' };
    render(<Harness />);
    await settled();
    await act(() => current.queue.flush());
    expect(writes).toHaveLength(2);
    expect(writes.every(write => write.path.startsWith('users/A/'))).toBe(true);
  });

  it('quarantines legacy ownerless entries without changing their payload or inventing ownership', async () => {
    localStorage.setItem('FITSSAI_OFFLINE_QUEUE', JSON.stringify([
      { id: 'legacy', type: 'TOGGLE_DAY', payload, createdAt: 1, status: 'pending', attempts: 0 },
    ]));
    render(<Harness />);
    await settled();
    await act(() => current.queue.flush());
    switchAccount('B');
    await act(() => current.queue.flush());
    expect(writes).toEqual([]);
    expect(loadQueue()[0]).toMatchObject({ id: 'legacy', payload, status: 'quarantined' });
    expect(loadQueue()[0].ownerUid).toBeUndefined();
    expect(current.queue.hasPending).toBe(false);
  });

  it('never hydrates A cache or training into B, even with identical query/plan keys', async () => {
    const view = render(<Harness />);
    await settled();
    const oldClient = current.client;
    act(() => {
      current.client.setQueryData(['profile'], 'private-A');
      current.training.startSession({ planId: 'shared-plan-id', weekKey: 'Week 1', dayIndex: 0, workoutDay: '2026-09-07' });
      current.training.markFinishAttempt(Date.now());
      current.training.addWorkout({ id: 'exercise-A', name: 'Private A', sets: 1, reps: '1', weight: '', rest: '' });
    });
    const session = current.training.session;
    await waitFor(() => expect(localStorage.getItem(accountStorageKey('REACT_QUERY_OFFLINE_CACHE', 'A'))).toContain('private-A'), { timeout: 3000 });
    switchAccount('B');
    await settled();
    expect(current.client).not.toBe(oldClient);
    expect(current.training.session).toBeNull();
    expect(current.training.todayWorkouts).toEqual([]);
    act(() => { oldClient.setQueryData(['profile'], 'late-A-result'); });
    expect(screen.getByTestId('profile')).toBeEmptyDOMElement();
    expect(observations.filter(row => row.uid === 'B').every(row => !row.profile && !row.session)).toBe(true);
    view.unmount();
    identity.currentUser = { uid: 'A' };
    render(<Harness />);
    await settled();
    expect(current.training.session).toEqual(session);
    expect(current.training.todayWorkouts[0].id).toBe('exercise-A');
    expect(screen.getByTestId('profile').textContent).toMatch(/private-A|late-A-result/);
  });

  it('same UID auth events, rerenders and reload retain frozen finish recovery', async () => {
    const view = render(<Harness />);
    await settled();
    act(() => {
      current.training.startSession({ planId: 'p', weekKey: 'Week 1', dayIndex: 0 });
      current.training.markFinishAttempt(Date.now());
    });
    const original = current.training.session;
    const client = current.client;
    switchAccount('A');
    view.rerender(<Harness />);
    expect(current.training.session).toEqual(original);
    expect(current.client).toBe(client);
    view.unmount();
    render(<Harness />);
    await settled();
    expect(current.training.session).toEqual(original);
    expect(current.training.isStarted).toBe(true);
  });

  it.each(['context', 'logout-button', 'external'] as const)('%s sign-out shares cleanup and preserves device preferences', async path => {
    render(<Harness />);
    await settled();
    for (const key of SIGN_OUT_PRESERVED_KEYS) localStorage.setItem(key, 'keep');
    localStorage.setItem('unrelated', 'keep');
    for (const key of ['fitssai.training.session', 'fitssai.training.cache', 'REACT_QUERY_OFFLINE_CACHE', 'fitssai.nudges.v1']) localStorage.setItem(key, 'legacy-A');
    sessionStorage.setItem('fitssai.ai-nudge.old', 'private-A');
    act(() => current.client.setQueryData(['profile'], 'private-A'));
    if (path === 'external') switchAccount(null);
    else if (path === 'context') fireEvent.click(screen.getByText('Context sign out'));
    else {
      fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Abmelden' }));
    }
    await waitFor(() => expect(screen.getByTestId('uid')).toHaveTextContent('signed-out'));
    expect(current.client.getQueryData(['profile'])).toBeUndefined();
    expect(localStorage.getItem('REACT_QUERY_OFFLINE_CACHE')).toBeNull();
    expect(localStorage.getItem('fitssai.training.session')).toBeNull();
    expect(sessionStorage.getItem('fitssai.ai-nudge.old')).toBeNull();
    for (const key of SIGN_OUT_PRESERVED_KEYS) expect(localStorage.getItem(key)).toBe('keep');
    expect(localStorage.getItem('unrelated')).toBe('keep');
    if (path !== 'external') expect(firebaseSignOut).toHaveBeenCalledTimes(1);
  });

  it('does not assign a delayed A network failure to B', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    let reject!: (error: Error) => void;
    remoteAction.mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    render(<Harness />);
    await settled();
    let pending!: Promise<unknown>;
    act(() => { pending = current.action.mutateAsync(undefined).catch(error => error); });
    await waitFor(() => expect(remoteAction).toHaveBeenCalledTimes(1));
    switchAccount('B');
    await act(async () => { reject(new Error('Failed to fetch')); await pending; });
    expect(loadQueue()).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe('owner enforcement at the queue and Firestore boundaries', () => {
  it('refuses anonymous enqueue and prevents owner patches', () => {
    const { entry } = enqueue('TOGGLE_DAY', payload);
    updateEntry(entry.id, { ownerUid: 'B', status: 'pending' } as Partial<OfflineMutationEntry>);
    expect(loadQueue()[0].ownerUid).toBe('A');
    identity.currentUser = null;
    expect(() => enqueue('TOGGLE_DAY', payload)).toThrow(/account/);
    identity.currentUser = { uid: 'B' };
    expect(() => enqueue('TOGGLE_DAY', payload, 'A')).toThrow(/account/);
  });

  it.each(['TOGGLE_DAY', 'TOGGLE_SET', 'TOGGLE_DAY_COMPLETION'] as const)('%s rejects A under B before reading or writing', async type => {
    identity.currentUser = { uid: 'B' };
    const handler = handlers[type];
    await expect(handler({ ...payload, uid: 'B', ownerUid: 'B' } as never, 'A')).rejects.toThrow(/account/);
    await expect(handler(payload as never, undefined as unknown as string)).rejects.toThrow(/account/);
    expect(firestore.getDocs).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('ignores mutable payload UID fields and writes only to the stored owner path', async () => {
    await handlers.TOGGLE_DAY({ ...payload, uid: 'B', ownerUid: 'B' } as typeof payload, 'A');
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toMatch(/^users\/A\//);
    expect(writes[0].data).not.toHaveProperty('uid');
    expect(writes[0].data).not.toHaveProperty('ownerUid');
  });

  it('switching accounts after the day lookup stops the transaction write', async () => {
    control.beforeCommit = async () => { identity.currentUser = { uid: 'B' }; };
    await expect(handlers.TOGGLE_DAY(payload, 'A')).rejects.toThrow(/account/);
    expect(writes).toEqual([]);
  });
});
