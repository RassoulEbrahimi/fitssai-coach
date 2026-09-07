import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query';

/*
  The Firebase boundary is reproduced from the SDK's own lifecycle rather than
  approximated: `registerStateListener` attaches the observer to
  `_initializationPromise` with a fulfillment handler only, so a rejected
  initialization calls neither the next callback nor the error callback. The
  mock below does exactly that, which is what makes the blank-forever failure
  reproducible here at all.
*/
const identity = vi.hoisted(() => ({
  currentUser: null as { uid: string } | null,
  _initializationPromise: null as Promise<void> | null,
  settle: null as ((user: { uid: string } | null) => void) | null,
  fail: null as ((reason: unknown) => void) | null,
}));
const listeners = vi.hoisted(() => new Set<(user: { uid: string } | null) => void>());

vi.mock('@/lib/firebase', () => ({
  auth: identity,
  get db() { return {}; },
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (
    authInstance: typeof identity,
    callback: (user: { uid: string } | null) => void,
  ) => {
    listeners.add(callback);
    // Only ever resolves. A rejection is never routed anywhere — the defect.
    void authInstance._initializationPromise?.then(() => { callback(authInstance.currentUser); }, () => {});
    return () => listeners.delete(callback);
  },
  signOut: vi.fn(async () => {
    identity.currentUser = null;
    listeners.forEach(listener => listener(null));
  }),
}));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({ toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn() }));

import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { AuthUnavailableBanner } from '@/components/AuthUnavailableBanner';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { TrainingProvider, useTraining } from '@/contexts/TrainingContext';
import { AUTH_INIT_TIMEOUT_MS } from '@/lib/authInitialization';
import { accountStorageKey } from '@/lib/accountIdentity';

let current: {
  client: ReturnType<typeof useQueryClient>;
  training: ReturnType<typeof useTraining>;
  restoring: boolean;
  authUnavailable: boolean;
};
const mounts: (string | undefined)[] = [];

/** Stands in for the sign-in and reset routes: proof the router got to render. */
function AuthRoutes() {
  return <span data-testid="auth-routes">sign-in / reset</span>;
}

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
    {!user && <AuthRoutes />}
  </>;
}

function Harness() {
  return <AuthProvider>
    <AuthUnavailableBanner />
    <QueryProvider><TrainingProvider><Probe /></TrainingProvider></QueryProvider>
  </AuthProvider>;
}

/** Initialization that the test decides the fate of, exactly once. */
const pendingInitialization = () => {
  identity._initializationPromise = new Promise<void>((resolve, reject) => {
    identity.settle = (user) => { identity.currentUser = user; resolve(); };
    identity.fail = reject;
  });
  // The provider attaches its own rejection handler; this keeps Node quiet
  // about the copy nothing else observes.
  identity._initializationPromise.catch(() => {});
};

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
  listeners.clear();
  mounts.length = 0;
  identity.currentUser = null;
  vi.clearAllMocks();
  pendingInitialization();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});

afterEach(() => { vi.useRealTimers(); });

const settled = () => waitFor(() => expect(current.restoring).toBe(false));

describe('normal authentication restore', () => {
  it('mounts the account subtree once a signed-in identity resolves', async () => {
    render(<Harness />);
    expect(screen.queryByTestId('uid')).toBeNull();

    await act(async () => { identity.settle!({ uid: 'A' }); });
    await settled();

    expect(screen.getByTestId('uid')).toHaveTextContent('A');
    expect(current.authUnavailable).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('auth-routes')).toBeNull();
  });

  it('mounts the signed-out routes once a resolved absence of identity arrives', async () => {
    render(<Harness />);

    await act(async () => { identity.settle!(null); });
    await settled();

    expect(screen.getByTestId('uid')).toHaveTextContent('signed-out');
    expect(screen.getByTestId('auth-routes')).toBeInTheDocument();
    expect(current.authUnavailable).toBe(false);
  });
});

describe('authentication that fails to initialize', () => {
  it('leaves the gate for a recoverable signed-out state instead of staying blank', async () => {
    render(<Harness />);
    expect(screen.queryByTestId('uid')).toBeNull();

    await act(async () => { identity.fail!(new Error('IndexedDB is unavailable')); });

    await waitFor(() => expect(screen.getByTestId('uid')).toHaveTextContent('signed-out'));
    expect(screen.getByTestId('auth-routes')).toBeInTheDocument();
    expect(current.authUnavailable).toBe(true);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('hydrates no previous account from a malformed persisted user', async () => {
    // Everything a previous session left on this device, as it would be found.
    localStorage.setItem(accountStorageKey('fitssai.training.session', 'A'), JSON.stringify({
      version: 1, planId: 'plan-A', weekKey: 'Week 1', dayIndex: 0, startedAt: Date.now(),
    }));
    localStorage.setItem(accountStorageKey('fitssai.training.cache', 'A'),
      JSON.stringify([{ id: 'private-A', name: 'Private A' }]));
    localStorage.setItem(accountStorageKey('REACT_QUERY_OFFLINE_CACHE', 'A'), JSON.stringify({
      timestamp: Date.now(), buster: 'account-owned-v1', clientState: { mutations: [], queries: [
        { queryKey: ['profile'], queryHash: '["profile"]',
          state: { data: 'private-A', status: 'success', dataUpdatedAt: Date.now() } }] },
    }));

    render(<Harness />);
    // The persisted user will not parse, so initialization rejects.
    await act(async () => { identity.fail!(new SyntaxError('Unexpected token in persisted user')); });
    await waitFor(() => expect(screen.getByTestId('uid')).toHaveTextContent('signed-out'));

    expect(current.training.session).toBeNull();
    expect(current.training.todayWorkouts).toEqual([]);
    expect(current.client.getQueryData(['profile'])).toBeUndefined();
    expect(screen.getByTestId('profile')).toBeEmptyDOMElement();
    expect(mounts).not.toContain('A');
    // A's namespaces are not adopted, and the recovery route is reachable.
    expect(screen.getByTestId('auth-routes')).toBeInTheDocument();
  });

  it('recovers into the real account if authentication resolves after the failure', async () => {
    render(<Harness />);
    await act(async () => { identity.fail!(new Error('transient initialization failure')); });
    await waitFor(() => expect(current.authUnavailable).toBe(true));

    // The observer is still the authority and still subscribed.
    await act(async () => {
      identity.currentUser = { uid: 'A' };
      listeners.forEach(listener => listener(identity.currentUser));
    });
    await settled();

    expect(screen.getByTestId('uid')).toHaveTextContent('A');
    expect(current.authUnavailable).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('settles once, without remounting or retrying in a loop', async () => {
    render(<Harness />);
    await act(async () => { identity.fail!(new Error('initialization failure')); });
    await waitFor(() => expect(current.authUnavailable).toBe(true));

    const seen = [...mounts];
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });

    expect(mounts).toEqual(seen);
    expect(screen.getAllByTestId('uid')).toHaveLength(1);
  });
});

describe('authentication that never answers at all', () => {
  it('resolves to signed-out on the bounded wait rather than blanking forever', async () => {
    vi.useFakeTimers();
    // A promise that neither resolves nor rejects: the SDK simply never calls back.
    identity._initializationPromise = new Promise<void>(() => {});
    render(<Harness />);
    expect(screen.queryByTestId('uid')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_INIT_TIMEOUT_MS + 1); });

    expect(screen.getByTestId('uid')).toHaveTextContent('signed-out');
    expect(current.authUnavailable).toBe(true);
    vi.useRealTimers();
  });

  it('does not declare failure while the wait is still running', async () => {
    vi.useFakeTimers();
    identity._initializationPromise = new Promise<void>(() => {});
    render(<Harness />);

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_INIT_TIMEOUT_MS - 1000); });

    expect(screen.queryByTestId('uid')).toBeNull();
    vi.useRealTimers();
  });

  it('disarms the wait once an identity has resolved', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    await act(async () => { identity.settle!({ uid: 'A' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_INIT_TIMEOUT_MS * 2); });

    expect(screen.getByTestId('uid')).toHaveTextContent('A');
    expect(current.authUnavailable).toBe(false);
    vi.useRealTimers();
  });
});

describe('isolation survives the failure path', () => {
  it('keeps per-account query, session and cache namespaces after recovery', async () => {
    render(<Harness />);
    await act(async () => { identity.fail!(new Error('initialization failure')); });
    await waitFor(() => expect(current.authUnavailable).toBe(true));

    // Signed out, nothing account-scoped may be written at all.
    act(() => { current.client.setQueryData(['profile'], 'while-unavailable'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(localStorage.getItem('REACT_QUERY_OFFLINE_CACHE')).toBeNull();

    await act(async () => {
      identity.currentUser = { uid: 'A' };
      listeners.forEach(listener => listener(identity.currentUser));
    });
    await settled();

    // A fresh, A-scoped client: nothing from the unavailable phase carried over.
    expect(current.client.getQueryData(['profile'])).toBeUndefined();
    act(() => {
      current.training.startSession({ planId: 'plan-A', weekKey: 'Week 1', dayIndex: 0 });
    });
    expect(localStorage.getItem(accountStorageKey('fitssai.training.session', 'A'))).toContain('plan-A');
    expect(localStorage.getItem('fitssai.training.session')).toBeNull();
  });
});
