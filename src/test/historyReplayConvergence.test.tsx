import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dehydrate, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';

/*
  TRAINING-E2E-FIX-02: a set write queued offline can reach the server after
  its session was finished and already read into Session Detail. Once that
  replay succeeds, History must converge to the server's copy without a
  reload. Real offline queue, replay, handlers, set writer, History queries
  and Session Detail against the in-memory Firestore boundary; only account
  identity, telemetry and toasts are fixtures.
*/

const identity = vi.hoisted(() => ({ currentUser: { uid: 'u1' } as { uid: string } | null }));
vi.mock('@/lib/firebase', () => ({ auth: identity, db: {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: identity.currentUser, loading: false }) }));
vi.mock('firebase/firestore', async () => (await import('@/test/mocks/workoutFirestore')).firestore);
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/lib/toastWithIcon', () => ({
  toastWithIcon: vi.fn(), toastOffline: vi.fn(), toastError: vi.fn(),
  toastSuccess: vi.fn(), toastWarning: vi.fn(), toastInfo: vi.fn(),
}));

import { SessionDetail } from '@/components/trainingsplan/SessionDetail';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { firestoreSessionSource } from '@/hooks/queries/useWorkoutHistory';
import { accountStorageKey } from '@/lib/accountIdentity';
import { enqueue, loadQueue, updateEntry } from '@/lib/offlineQueue';
import { queryKeys } from '@/lib/queryKeys';
import { loadSessionRecord } from '@/lib/workoutHistory';
import { toastWithIcon } from '@/lib/toastWithIcon';
import { control, firestore, resetWorkoutFirestore, rows } from '@/test/mocks/workoutFirestore';

const PLAN_ID = 'plan-1';
const WORKOUT_DAY = '2026-09-08';
const SESSION = { planId: PLAN_ID, workoutDay: WORKOUT_DAY };
const POSITION = { planId: PLAN_ID, weekKey: 'Week 1', dayIndex: 1, exerciseIndex: 0, workoutDay: WORKOUT_DAY };
const exercise = (name: string) => ({ name, sets: 3, reps: '10', rest: '60s' });
const rest = (day: string) => ({ day, exercises: [] });
const WEEK = [
  { day: 'Ganzkörper A', exercises: [exercise('Kniebeugen')] },
  { day: 'Push A', exercises: [exercise('Schulterdrücken')] },
  rest('Mi'), rest('Do'), rest('Fr'), rest('Sa'), rest('So'),
];

/** Finished Tuesday on the server: the day record and one ticked set of its first exercise. */
const seedFinishedSession = () => {
  rows.set(`users/u1/workout_plans/${PLAN_ID}`, { content: { 'Week 1': WEEK } });
  rows.set('users/u1/workout_logs/day-tue', {
    planId: PLAN_ID, workoutDay: WORKOUT_DAY, weekKey: 'Week 1', dayIndex: 1, completed: true, durationSec: 1200,
  });
  rows.set('users/u1/workout_logs/ex-tue-0', { ...POSITION, completed: false });
  rows.set('users/u1/workout_logs/ex-tue-0/workout_set_logs/s1', {
    setNumber: 1, completed: true, performanceSource: 'completion-only',
  });
};

/** The second set, ticked offline and still waiting in the durable queue. */
const queueSecondSet = () => enqueue('TOGGLE_SET', { ...POSITION, setNumber: 2, completed: true }, 'u1').entry;
/** Reps and weight recorded offline for the set that was ticked online. */
const queueFirstSetValues = () => enqueue('UPDATE_SET_PERFORMANCE', { ...POSITION, setNumber: 1, reps: 10, weightKg: 50 }, 'u1').entry;

/*
  Holds every replayed transaction at its commit, so Session Detail can read
  the server first - the race the E2E audit reproduced after an immediate
  Finish on reconnect.
*/
let releaseCommit: () => void;
const holdReplayAtCommit = () => {
  const gate = new Promise<void>((resolve) => { releaseCommit = resolve; });
  control.beforeCommit = () => gate;
};

/** The running app: the queue that replays on reconnect, and the open Session Detail. */
const Screen = () => {
  useOfflineQueue();
  return <SessionDetail sessionKey={SESSION} today={WORKOUT_DAY} onBack={() => {}} fromHistory />;
};

const online = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  onlineManager.setOnline(value);
};
const reconnect = () => act(() => {
  online(true);
  window.dispatchEvent(new Event('online'));
});
const meta = (text: string) => screen.findByText(text, {}, { timeout: 3000 });
const setLines = () => screen.queryAllByRole('listitem').map((item) => item.getAttribute('aria-label')).filter(Boolean);
const sessionKey = (uid: string) => queryKeys.history.session(uid, PLAN_ID, WORKOUT_DAY);

let client: QueryClient;
const mountWith = (queryClient: QueryClient) => render(
  <QueryClientProvider client={queryClient}><Screen /></QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkoutFirestore();
  localStorage.clear();
  identity.currentUser = { uid: 'u1' };
  // Offline while the sets were ticked; the History read and reconnect follow.
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  seedFinishedSession();
});
afterEach(() => {
  releaseCommit?.();
  vi.restoreAllMocks();
  online(true);
  client.clear();
});

describe('History after a queued set write replays', () => {
  it('an open Session Detail read before a TOGGLE_SET replay converges to both sets, without a reload', async () => {
    // Other cached History of this account, and a foreign account's, as plain inactive entries.
    const stale = { pages: [], pageParams: [] };
    client.setQueryData(queryKeys.history.list('u1'), stale);
    client.setQueryData(queryKeys.history.latest('u1'), { entry: null, exhausted: false });
    client.setQueryData(queryKeys.history.list('u2'), stale);
    client.setQueryData(sessionKey('u2'), null);
    const entry = queueSecondSet();
    holdReplayAtCommit();

    mountWith(client);
    reconnect();
    // Replay has claimed the queued set but not committed it; the finished session is read now.
    await waitFor(() => expect(loadQueue().find((item) => item.id === entry.id)?.claimId).toBeTruthy());
    expect(await meta('20 Min · 1 Satz abgehakt')).toBeInTheDocument();
    expect(screen.getByText('1 Satz abgehakt · keine Werte erfasst')).toBeInTheDocument();
    // Fresh for five minutes: nothing but the replay can move it now.
    expect(client.getQueryState(sessionKey('u1'))?.isInvalidated).toBe(false);

    releaseCommit();
    expect(await meta('20 Min · 2 Sätze abgehakt')).toBeInTheDocument();
    expect(screen.getByText('2 Sätze abgehakt · keine Werte erfasst')).toBeInTheDocument();
    expect(loadQueue()).toEqual([]);
    const stored = [...rows.entries()].find(([path, data]) =>
      path.startsWith('users/u1/workout_logs/ex-tue-0/workout_set_logs/') && data.setNumber === 2);
    expect(stored?.[1]).toMatchObject({ setNumber: 2, completed: true, performanceSource: 'completion-only' });

    // The rest of this account's History family is stale too, and reads anew when shown.
    expect(client.getQueryState(queryKeys.history.list('u1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.history.latest('u1'))?.isInvalidated).toBe(true);
    // Another account's History is never touched.
    expect(client.getQueryState(queryKeys.history.list('u2'))?.isInvalidated).toBe(false);
    expect(client.getQueryState(sessionKey('u2'))?.isInvalidated).toBe(false);
    expect(toastWithIcon).toHaveBeenCalledWith(expect.objectContaining({ title: 'Synchronisiert' }));
  });

  it('shows trusted reps and weight from a replayed UPDATE_SET_PERFORMANCE in the open Session Detail', async () => {
    queueFirstSetValues();
    holdReplayAtCommit();

    mountWith(client);
    reconnect();
    expect(await meta('20 Min · 1 Satz abgehakt')).toBeInTheDocument();
    expect(screen.getByText('1 Satz abgehakt · keine Werte erfasst')).toBeInTheDocument();
    expect(setLines()).not.toContain('Satz 1 · 10 Wdh. · 50 kg');

    releaseCommit();
    await waitFor(() => expect(setLines()).toContain('Satz 1 · 10 Wdh. · 50 kg'), { timeout: 3000 });
    // Values only: the completion the set already had is neither added nor lost.
    expect(screen.getByText('20 Min · 1 Satz abgehakt')).toBeInTheDocument();
    expect(screen.queryByText('1 Satz abgehakt · keine Werte erfasst')).toBeNull();
    expect(loadQueue()).toEqual([]);
  });

  it('does not treat a failed replay as synchronized History, and converges once a retry succeeds', async () => {
    client.setQueryData(queryKeys.history.list('u1'), { pages: [], pageParams: [] });
    const entry = queueSecondSet();
    holdReplayAtCommit();

    mountWith(client);
    reconnect();
    expect(await meta('20 Min · 1 Satz abgehakt')).toBeInTheDocument();
    const reads = vi.mocked(firestore.getDocsFromServer).mock.calls.length;

    control.rejectNext = true;
    releaseCommit();
    await waitFor(() => expect(loadQueue()[0]?.status).toBe('failed'));
    expect(toastWithIcon).toHaveBeenCalledWith(expect.objectContaining({ title: 'Synchronisierung ausstehend' }));
    expect(toastWithIcon).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Synchronisiert' }));
    // Nothing reached the server, so nothing claims it did: History is left as read.
    expect(client.getQueryState(sessionKey('u1'))?.isInvalidated).toBe(false);
    expect(client.getQueryState(queryKeys.history.list('u1'))?.isInvalidated).toBe(false);
    expect(vi.mocked(firestore.getDocsFromServer).mock.calls.length).toBe(reads);
    expect(screen.getByText('20 Min · 1 Satz abgehakt')).toBeInTheDocument();

    // The durable entry is retried; this time the write lands and History follows.
    control.beforeCommit = undefined;
    updateEntry(entry.id, { nextAttemptAt: Date.now() - 1 });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(await meta('20 Min · 2 Sätze abgehakt')).toBeInTheDocument();
    expect(loadQueue()).toEqual([]);
  });

  it('converges from a partial Session Detail restored out of the persisted query cache', async () => {
    // A previous page load read the finished session and persisted that read.
    const earlier = new QueryClient();
    await earlier.fetchQuery({
      queryKey: sessionKey('u1'),
      queryFn: () => loadSessionRecord(firestoreSessionSource('u1'), SESSION),
    });
    localStorage.setItem(accountStorageKey('REACT_QUERY_OFFLINE_CACHE', 'u1'), JSON.stringify({
      buster: 'account-owned-v1', timestamp: Date.now(), clientState: dehydrate(earlier),
    }));
    earlier.clear();
    queueSecondSet();
    holdReplayAtCommit();
    vi.mocked(firestore.getDocsFromServer).mockClear();

    // The production provider: account-scoped client restored from that cache.
    render(<QueryProvider><Screen /></QueryProvider>);
    reconnect();
    expect(await meta('20 Min · 1 Satz abgehakt')).toBeInTheDocument();
    // Served from the restored cache, not read again.
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();

    releaseCommit();
    expect(await meta('20 Min · 2 Sätze abgehakt')).toBeInTheDocument();
    expect(firestore.getDocsFromServer).toHaveBeenCalled();
    expect(loadQueue()).toEqual([]);
  });
});
