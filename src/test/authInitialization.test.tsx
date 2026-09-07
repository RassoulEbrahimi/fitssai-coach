import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query';

/*
  The Firebase boundary here reproduces the pinned SDK's lifecycle rather than
  approximating it, because the previous version of this file proved the wrong
  thing: it hand-delivered an observer callback after a rejected initialization,
  which @firebase/auth 1.7.9 never emits. `src/test/firebaseAuthLifecycle.probe.test.ts`
  establishes the real behaviour against the real SDK; this mock obeys it:

    - the observer is attached to `_initializationPromise` with a fulfillment
      handler only, so a rejection reaches neither `next` nor `error`;
    - `_isInitialized` is set only when initialization completes;
    - `notifyAuthListeners` drops every publication while it is false, so
      signing in on a failed instance cannot restore identity.

  `signIn` below therefore does exactly what the SDK does, and the app has to
  earn its way back through recovery rather than through a callback that only a
  mock would produce.
*/
const identity = vi.hoisted(() => {
  const state = {
    currentUser: null as { uid: string } | null,
    _isInitialized: false,
    _initializationPromise: null as Promise<void> | null,
    listeners: new Set<(user: { uid: string } | null) => void>(),
    settle: null as ((user: { uid: string } | null) => void) | null,
    fail: null as ((reason: unknown) => void) | null,
    /** The SDK's own gate: nothing is published before initialization lands. */
    notifyAuthListeners() {
      if (!state._isInitialized) return;
      state.listeners.forEach(listener => listener(state.currentUser));
    },
    /** Stands in for signInWithEmailAndPassword: sets the user, then publishes. */
    signIn(uid: string) {
      state.currentUser = { uid };
      state.notifyAuthListeners();
    },
  };
  return state;
});
const reloads = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/lib/firebase', () => ({ auth: identity, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (
    authInstance: typeof identity,
    callback: (user: { uid: string } | null) => void,
  ) => {
    authInstance.listeners.add(callback);
    void authInstance._initializationPromise?.then(
      () => { callback(authInstance.currentUser); },
      () => {}, // The rejection reaches no callback. This is the defect.
    );
    return () => authInstance.listeners.delete(callback);
  },
  signOut: vi.fn(async () => {
    identity.currentUser = null;
    identity.notifyAuthListeners();
  }),
}));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({ toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/authPersistenceRecovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authPersistenceRecovery')>();
  return {
    ...actual,
    // Everything real except the navigation, which jsdom cannot perform.
    attemptAuthPersistenceRecovery: (options: { force?: boolean } = {}) =>
      actual.attemptAuthPersistenceRecovery({ ...options, reload: () => { reloads.count += 1; } }),
  };
});

import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { TrainingProvider, useTraining } from '@/contexts/TrainingContext';
import { AUTH_INIT_TIMEOUT_MS } from '@/lib/authInitialization';
import { AUTH_RECOVERY_MARKER } from '@/lib/authPersistenceRecovery';
import { accountStorageKey } from '@/lib/accountIdentity';
import { SIGN_OUT_PRESERVED_KEYS } from '@/lib/storage';

let current: {
  client: ReturnType<typeof useQueryClient>;
  training: ReturnType<typeof useTraining>;
  restoring: boolean;
  authUnavailable: boolean;
};
const mounts: (string | undefined)[] = [];

function Probe() {
  const { user, authUnavailable } = useAuth();
  const client = useQueryClient();
  const training = useTraining();
  const restoring = useIsRestoring();
  const profile = useQuery({ queryKey: ['profile'], queryFn: async () => null, enabled: false }).data;
  current = { client, training, restoring, authUnavailable };
  React.useEffect(() => { mounts.push(user?.uid); }, [user?.uid]);
  return <>
    <span data-testid="uid">{user?.uid ?? 'signed-out'}</span>
    <span data-testid="profile">{String(profile ?? '')}</span>
  </>;
}

function Harness() {
  return <AuthProvider>
    <QueryProvider><TrainingProvider><Probe /></TrainingProvider></QueryProvider>
  </AuthProvider>;
}

/** Initialization whose fate the test decides, exactly once. */
const pendingInitialization = () => {
  identity._isInitialized = false;
  identity._initializationPromise = new Promise<void>((resolve, reject) => {
    identity.settle = (user) => {
      identity.currentUser = user;
      identity._isInitialized = true;
      resolve();
    };
    identity.fail = reject;
  });
  identity._initializationPromise.catch(() => {});
};

/** What a Firebase Auth store looks like on disk, plus this app's own state. */
const seedStorage = () => {
  localStorage.setItem('firebase:authUser:probe-api-key:[DEFAULT]', '{"uid":"A","corrupt":');
  localStorage.setItem('firebase:persistence:probe-api-key:[DEFAULT]', 'local');
  localStorage.setItem(accountStorageKey('fitssai.training.session', 'A'), JSON.stringify({
    version: 1, planId: 'plan-A', weekKey: 'Week 1', dayIndex: 0, startedAt: Date.now(),
  }));
  localStorage.setItem(accountStorageKey('fitssai.training.cache', 'A'),
    JSON.stringify([{ id: 'exercise-A', name: 'Private A', sets: 1, reps: '1', weight: '', rest: '' }]));
  localStorage.setItem(accountStorageKey('REACT_QUERY_OFFLINE_CACHE', 'A'), JSON.stringify({
    timestamp: Date.now(), buster: 'account-owned-v1', clientState: { mutations: [], queries: [
      { queryKey: ['profile'], queryHash: '["profile"]',
        state: { data: 'private-A', status: 'success', dataUpdatedAt: Date.now() } }] },
  }));
  for (const key of SIGN_OUT_PRESERVED_KEYS) localStorage.setItem(key, 'keep');
  localStorage.setItem('unrelated', 'keep');
};

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
  identity.listeners.clear();
  identity.currentUser = null;
  mounts.length = 0;
  reloads.count = 0;
  vi.clearAllMocks();
  pendingInitialization();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});

afterEach(() => { vi.useRealTimers(); });

const settled = () => waitFor(() => expect(current.restoring).toBe(false));
const recoveryScreen = () => screen.queryByText(/Anmeldung (nicht verfügbar|wird wiederhergestellt)/);

describe('normal authentication restore is unchanged', () => {
  it('mounts the account subtree once a signed-in identity resolves', async () => {
    render(<Harness />);
    expect(screen.queryByTestId('uid')).toBeNull();

    await act(async () => { identity.settle!({ uid: 'A' }); });
    await settled();

    expect(screen.getByTestId('uid')).toHaveTextContent('A');
    expect(current.authUnavailable).toBe(false);
    expect(recoveryScreen()).toBeNull();
    expect(reloads.count).toBe(0);
  });

  it('mounts the signed-out app once a resolved absence of identity arrives', async () => {
    render(<Harness />);

    await act(async () => { identity.settle!(null); });
    await settled();

    expect(screen.getByTestId('uid')).toHaveTextContent('signed-out');
    expect(current.authUnavailable).toBe(false);
    expect(recoveryScreen()).toBeNull();
    expect(reloads.count).toBe(0);
  });
});

describe('initialization rejects', () => {
  it('leaves the gate for a recovery state instead of staying blank', async () => {
    render(<Harness />);
    expect(screen.queryByTestId('uid')).toBeNull();

    await act(async () => { identity.fail!(new Error('IndexedDB is unavailable')); });

    await waitFor(() => expect(recoveryScreen()).toBeInTheDocument());
    // No account consumer was ever mounted.
    expect(screen.queryByTestId('uid')).toBeNull();
    expect(mounts).toEqual([]);
  });

  it('does not treat a sign-in on the broken instance as recovery', async () => {
    render(<Harness />);
    await act(async () => { identity.fail!(new Error('initialization failure')); });
    await waitFor(() => expect(recoveryScreen()).toBeInTheDocument());

    // Exactly what signInWithEmailAndPassword does: sets currentUser, publishes.
    await act(async () => { identity.signIn('A'); await Promise.resolve(); });

    // The SDK dropped the publication, so the app must not claim an identity.
    expect(identity.currentUser).toEqual({ uid: 'A' });
    expect(screen.queryByTestId('uid')).toBeNull();
    expect(mounts).toEqual([]);
    expect(recoveryScreen()).toBeInTheDocument();
  });

  it('clears only Firebase auth persistence and reloads into a fresh instance', async () => {
    seedStorage();
    render(<Harness />);

    await act(async () => { identity.fail!(new SyntaxError('Unexpected token in persisted user')); });
    await waitFor(() => expect(reloads.count).toBe(1));

    // Firebase's own store is gone.
    expect(localStorage.getItem('firebase:authUser:probe-api-key:[DEFAULT]')).toBeNull();
    expect(localStorage.getItem('firebase:persistence:probe-api-key:[DEFAULT]')).toBeNull();
    // Everything this app owns survives, so the same user gets it back.
    expect(localStorage.getItem(accountStorageKey('fitssai.training.session', 'A'))).toContain('plan-A');
    expect(localStorage.getItem(accountStorageKey('fitssai.training.cache', 'A'))).toContain('exercise-A');
    expect(localStorage.getItem(accountStorageKey('REACT_QUERY_OFFLINE_CACHE', 'A'))).toContain('private-A');
    for (const key of SIGN_OUT_PRESERVED_KEYS) expect(localStorage.getItem(key)).toBe('keep');
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('repairs automatically at most once per tab, however many times it fails', async () => {
    let view = render(<Harness />);
    await act(async () => { identity.fail!(new Error('initialization failure')); });
    await waitFor(() => expect(reloads.count).toBe(1));
    expect(sessionStorage.getItem(AUTH_RECOVERY_MARKER)).not.toBeNull();

    // The reload lands on a store that is still broken, twice over.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      view.unmount();
      pendingInitialization();
      view = render(<Harness />);
      await act(async () => { identity.fail!(new Error('still broken')); });
      await waitFor(() => expect(recoveryScreen()).toBeInTheDocument());
      expect(reloads.count).toBe(1);
    }

    // And it says so, rather than spinning on a repair it already spent.
    expect(screen.getByText('Anmeldung nicht verfügbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });

  it('honours a repair the user asks for by hand after the automatic one', async () => {
    render(<Harness />);
    sessionStorage.setItem(AUTH_RECOVERY_MARKER, '1');
    await act(async () => { identity.fail!(new Error('initialization failure')); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument());
    expect(reloads.count).toBe(0);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' })); });

    await waitFor(() => expect(reloads.count).toBe(1));
  });
});

describe('after recovery', () => {
  it('completes a signed-out initialization and then signs in normally', async () => {
    // The reload has happened; the fresh instance initializes cleanly.
    render(<Harness />);
    await act(async () => { identity.settle!(null); });
    await settled();

    expect(screen.getByTestId('uid')).toHaveTextContent('signed-out');
    expect(current.authUnavailable).toBe(false);

    // A real sign-in on a healthy instance: publication now reaches the app.
    await act(async () => { identity.signIn('A'); });
    await settled();

    expect(screen.getByTestId('uid')).toHaveTextContent('A');
    expect(mounts).toContain('A');
    // The repair is no longer owed, so a later genuine failure may try again.
    expect(sessionStorage.getItem(AUTH_RECOVERY_MARKER)).toBeNull();
  });

  it("returns the same user's UID-scoped state only once identity resolves", async () => {
    seedStorage();
    render(<Harness />);
    await act(async () => { identity.settle!(null); });
    await settled();

    // Signed out: nothing of A's is mounted.
    expect(current.training.session).toBeNull();
    expect(current.training.todayWorkouts).toEqual([]);
    expect(current.client.getQueryData(['profile'])).toBeUndefined();

    await act(async () => { identity.signIn('A'); });
    await settled();

    // Signed in as A: A's own namespaces come back, untouched by the repair.
    expect(current.training.session?.planId).toBe('plan-A');
    expect(current.training.todayWorkouts[0]?.id).toBe('exercise-A');
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('private-A'));
  });
});

describe('initialization that never answers', () => {
  it('resolves to the recovery state on the bounded wait, destroying nothing', async () => {
    vi.useFakeTimers();
    seedStorage();
    // A promise that neither resolves nor rejects.
    identity._initializationPromise = new Promise<void>(() => {});
    render(<Harness />);
    expect(screen.queryByTestId('uid')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_INIT_TIMEOUT_MS + 1); });

    expect(screen.getByText('Anmeldung nicht verfügbar')).toBeInTheDocument();
    // Unproven, so nothing was cleared and nothing was reloaded.
    expect(reloads.count).toBe(0);
    expect(localStorage.getItem('firebase:authUser:probe-api-key:[DEFAULT]')).not.toBeNull();
    expect(sessionStorage.getItem(AUTH_RECOVERY_MARKER)).toBeNull();
    vi.useRealTimers();
  });

  it('does not declare failure while the wait is still running', async () => {
    vi.useFakeTimers();
    identity._initializationPromise = new Promise<void>(() => {});
    render(<Harness />);

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_INIT_TIMEOUT_MS - 1000); });

    expect(screen.queryByTestId('uid')).toBeNull();
    expect(recoveryScreen()).toBeNull();
    vi.useRealTimers();
  });

  it('disarms the wait once an identity has resolved', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    await act(async () => { identity.settle!({ uid: 'A' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_INIT_TIMEOUT_MS * 2); });

    expect(screen.getByTestId('uid')).toHaveTextContent('A');
    expect(current.authUnavailable).toBe(false);
    expect(reloads.count).toBe(0);
    vi.useRealTimers();
  });

  it('lets a slow restore that eventually lands take over the recovery state', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_INIT_TIMEOUT_MS + 1); });
    expect(screen.getByText('Anmeldung nicht verfügbar')).toBeInTheDocument();

    // The observer is still subscribed and still authoritative.
    await act(async () => { identity.settle!({ uid: 'A' }); await vi.advanceTimersByTimeAsync(0); });

    expect(screen.getByTestId('uid')).toHaveTextContent('A');
    expect(current.authUnavailable).toBe(false);
    expect(recoveryScreen()).toBeNull();
    vi.useRealTimers();
  });
});
