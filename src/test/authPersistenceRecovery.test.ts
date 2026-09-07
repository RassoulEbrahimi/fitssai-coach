import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_RECOVERY_MARKER,
  FIREBASE_AUTH_PERSISTENCE_NAMES,
  attemptAuthPersistenceRecovery,
  clearFirebaseAuthPersistence,
  firebaseAuthPersistenceKeys,
  persistRecoveryMarker,
  readRecoveryMarker,
  type AuthIdentity,
} from '@/lib/authPersistenceRecovery';
import { createIndexedDbDouble } from '@/test/mocks/indexedDbDouble';

const DB = 'firebaseLocalStorageDb';
const STORE = 'firebaseLocalStorage';

/** This app. */
const fitssai: AuthIdentity = { name: '[DEFAULT]', config: { apiKey: 'fitssai-key' } };
/** A second Firebase app on the same origin: different key, different name. */
const otherApp: AuthIdentity = { name: 'analytics', config: { apiKey: 'other-key' } };
/** A third that shares this app's name but not its key. */
const sameNameOtherKey: AuthIdentity = { name: '[DEFAULT]', config: { apiKey: 'someone-elses-key' } };

const key = (name: string, identity: AuthIdentity) =>
  `firebase:${name}:${identity.config.apiKey}:${identity.name}`;

let idb: ReturnType<typeof createIndexedDbDouble>;
const realIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

/** Replace a storage area's getter, including with one that throws. */
const stubStorage = (which: 'localStorage' | 'sessionStorage', get: () => Storage) => {
  Object.defineProperty(window, which, { configurable: true, get });
};
const restoreStorage = (which: 'localStorage' | 'sessionStorage', value: Storage) => {
  Object.defineProperty(window, which, { configurable: true, value, writable: true });
};
const realLocal = window.localStorage;
const realSession = window.sessionStorage;

/** Everything a shared origin might be holding when recovery runs. */
const seedOrigin = () => {
  for (const name of FIREBASE_AUTH_PERSISTENCE_NAMES) {
    localStorage.setItem(key(name, fitssai), `fitssai-${name}`);
    sessionStorage.setItem(key(name, fitssai), `fitssai-${name}`);
    localStorage.setItem(key(name, otherApp), `other-${name}`);
    sessionStorage.setItem(key(name, otherApp), `other-${name}`);
    localStorage.setItem(key(name, sameNameOtherKey), `third-${name}`);
  }
  // Firebase-prefixed keys that belong to no Auth persistence name at all.
  localStorage.setItem('firebase:heartbeat:fitssai-key:[DEFAULT]', 'heartbeat');
  localStorage.setItem('firebaseLocalStorageDb', 'not-a-key');
  // This app's own state, and the origin's.
  localStorage.setItem('fitssai.training.session:A', 'plan-A');
  localStorage.setItem('fitssai.theme', 'dark');
  localStorage.setItem('unrelated', 'keep');

  idb.seed(DB, STORE, {
    ...Object.fromEntries(FIREBASE_AUTH_PERSISTENCE_NAMES.map(n => [key(n, fitssai), { uid: 'A' }])),
    ...Object.fromEntries(FIREBASE_AUTH_PERSISTENCE_NAMES.map(n => [key(n, otherApp), { uid: 'B' }])),
    [key('authUser', sameNameOtherKey)]: { uid: 'C' },
    'some:other:record': { kept: true },
  });
  idb.seed('unrelatedDb', 'unrelatedStore', { row: { kept: true } });
};

beforeEach(() => {
  restoreStorage('localStorage', realLocal);
  restoreStorage('sessionStorage', realSession);
  localStorage.clear();
  sessionStorage.clear();
  idb = createIndexedDbDouble();
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true, writable: true, value: idb.factory,
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  restoreStorage('localStorage', realLocal);
  restoreStorage('sessionStorage', realSession);
  if (realIndexedDb) Object.defineProperty(globalThis, 'indexedDB', realIndexedDb);
  else delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('the keys this app owns', () => {
  it('names exactly the four persistence records, scoped by apiKey and appName', () => {
    expect(firebaseAuthPersistenceKeys(fitssai)).toEqual([
      'firebase:authUser:fitssai-key:[DEFAULT]',
      'firebase:persistence:fitssai-key:[DEFAULT]',
      'firebase:redirectUser:fitssai-key:[DEFAULT]',
      'firebase:pendingRedirect:fitssai-key:[DEFAULT]',
    ]);
  });

  it('targets nothing at all when either half of the scope is missing', () => {
    expect(firebaseAuthPersistenceKeys({ name: '[DEFAULT]', config: {} })).toEqual([]);
    expect(firebaseAuthPersistenceKeys({ name: '', config: { apiKey: 'k' } })).toEqual([]);
  });
});

describe('cleanup is scoped to this Firebase app', () => {
  it('removes only this app\'s records and leaves every other app standing', async () => {
    seedOrigin();

    const report = await clearFirebaseAuthPersistence(fitssai);

    expect(report.local).toBe('cleared');
    expect(report.session).toBe('cleared');
    expect(report.indexedDb).toBe('cleared');

    for (const name of FIREBASE_AUTH_PERSISTENCE_NAMES) {
      // Gone: this app, in all three stores.
      expect(localStorage.getItem(key(name, fitssai))).toBeNull();
      expect(sessionStorage.getItem(key(name, fitssai))).toBeNull();
      expect(idb.recordsIn(DB, STORE).has(key(name, fitssai))).toBe(false);

      // Kept: a different apiKey and a different appName.
      expect(localStorage.getItem(key(name, otherApp))).toBe(`other-${name}`);
      expect(sessionStorage.getItem(key(name, otherApp))).toBe(`other-${name}`);
      expect(idb.recordsIn(DB, STORE).has(key(name, otherApp))).toBe(true);

      // Kept: the same appName under someone else's key.
      expect(localStorage.getItem(key(name, sameNameOtherKey))).toBe(`third-${name}`);
    }

    // Kept: firebase-prefixed keys that are not Auth persistence records.
    expect(localStorage.getItem('firebase:heartbeat:fitssai-key:[DEFAULT]')).toBe('heartbeat');
    expect(localStorage.getItem('firebaseLocalStorageDb')).toBe('not-a-key');
    // Kept: unrelated records in the shared store, and unrelated databases.
    expect(idb.recordsIn(DB, STORE).has('some:other:record')).toBe(true);
    expect(idb.recordsIn(DB, STORE).has(key('authUser', sameNameOtherKey))).toBe(true);
    expect(idb.recordsIn('unrelatedDb', 'unrelatedStore').has('row')).toBe(true);
    // Kept: this app's own state and the origin's.
    expect(localStorage.getItem('fitssai.training.session:A')).toBe('plan-A');
    expect(localStorage.getItem('fitssai.theme')).toBe('dark');
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('never deletes the shared database, which the old implementation did', async () => {
    seedOrigin();
    await clearFirebaseAuthPersistence(fitssai);

    expect(idb.control.deletedDatabases).toEqual([]);
    expect(idb.control.databases.has(DB)).toBe(true);
    // The store is still there with the other apps' rows in it.
    expect(idb.recordsIn(DB, STORE).size).toBeGreaterThan(0);
  });

  it('does not leave behind a storeless database it created while looking', async () => {
    // No firebaseLocalStorageDb on this origin yet.
    const report = await clearFirebaseAuthPersistence(fitssai);

    expect(report.indexedDb).toBe('database-absent');
    expect(idb.control.databases.has(DB)).toBe(false);
  });
});

describe('storage that cannot be reached', () => {
  it('reports each area separately when its getter throws SecurityError', async () => {
    stubStorage('localStorage', () => { throw new DOMException('blocked', 'SecurityError'); });
    stubStorage('sessionStorage', () => { throw new DOMException('blocked', 'SecurityError'); });

    const report = await clearFirebaseAuthPersistence(fitssai);

    expect(report.local).toBe('unavailable');
    expect(report.session).toBe('unavailable');
  });

  it('reports a write failure apart from an unreachable store', async () => {
    seedOrigin();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    const report = await clearFirebaseAuthPersistence(fitssai);

    expect(report.local).toBe('failed');
    expect(report.session).toBe('failed');
  });

  it('survives IndexedDB being absent, failing to open, blocked, or wedged', async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    expect((await clearFirebaseAuthPersistence(fitssai)).indexedDb).toBe('unavailable');

    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: idb.factory });
    idb.control.failOpen = true;
    expect((await clearFirebaseAuthPersistence(fitssai)).indexedDb).toBe('failed');

    idb.control.failOpen = false;
    idb.control.blockOpen = true;
    expect((await clearFirebaseAuthPersistence(fitssai)).indexedDb).toBe('failed');

    idb.control.blockOpen = false;
    seedOrigin();
    idb.control.failTransaction = true;
    expect((await clearFirebaseAuthPersistence(fitssai)).indexedDb).toBe('failed');
    // An aborted transaction changed nothing.
    expect(idb.recordsIn(DB, STORE).has(key('authUser', fitssai))).toBe(true);
  });

  it('gives up on a hanging open rather than waiting forever', async () => {
    vi.useFakeTimers();
    idb.control.hangOpen = true;
    const pending = clearFirebaseAuthPersistence(fitssai);
    await vi.advanceTimersByTimeAsync(2_500);

    expect((await pending).indexedDb).toBe('failed');
    vi.useRealTimers();
  });
});

describe('the automatic loop guard', () => {
  const reload = vi.fn();
  beforeEach(() => reload.mockClear());

  it('requires a marker that provably persisted before reloading', async () => {
    seedOrigin();
    const outcome = await attemptAuthPersistenceRecovery({ auth: fitssai, reload });

    expect(outcome.status).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(readRecoveryMarker()).toBe('present');
  });

  it('refuses to reload when the marker write throws QuotaExceededError', async () => {
    seedOrigin();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('exceeded', 'QuotaExceededError');
    });

    const outcome = await attemptAuthPersistenceRecovery({ auth: fitssai, reload });

    expect(outcome).toEqual({ status: 'guard-unavailable' });
    expect(reload).not.toHaveBeenCalled();
    // Nothing was cleared either: a repair that cannot be remembered is not started.
    expect(localStorage.getItem(key('authUser', fitssai))).toBe('fitssai-authUser');
  });

  it('refuses to reload when the write silently does not stick', async () => {
    seedOrigin();
    // No throw, no persistence — the case a try/catch alone would miss.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});

    const outcome = await attemptAuthPersistenceRecovery({ auth: fitssai, reload });

    expect(outcome).toEqual({ status: 'guard-unavailable' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('refuses to reload when the guard cannot even be read', async () => {
    stubStorage('sessionStorage', () => { throw new DOMException('blocked', 'SecurityError'); });

    const outcome = await attemptAuthPersistenceRecovery({ auth: fitssai, reload });

    expect(outcome).toEqual({ status: 'guard-unavailable' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('never reloads more than once automatically, however many failures arrive', async () => {
    seedOrigin();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await attemptAuthPersistenceRecovery({ auth: fitssai, reload });
    }

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

/*
  `failed` belongs to the manual path in practice: automatic recovery needs
  sessionStorage for its guard, and sessionStorage being reachable means at
  least one store was cleared. Manual retry has no such prerequisite.
*/
describe('manual retry', () => {
  const reload = vi.fn();
  beforeEach(() => reload.mockClear());

  it('proceeds even when the loop guard cannot be stored', async () => {
    seedOrigin();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('exceeded', 'QuotaExceededError');
    });

    const outcome = await attemptAuthPersistenceRecovery({ auth: fitssai, force: true, reload });

    expect(outcome.status).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key('authUser', fitssai))).toBeNull();
  });

  it('proceeds after the one automatic repair has been spent', async () => {
    seedOrigin();
    persistRecoveryMarker();
    expect((await attemptAuthPersistenceRecovery({ auth: fitssai, reload })).status)
      .toBe('already-attempted');

    const outcome = await attemptAuthPersistenceRecovery({ auth: fitssai, force: true, reload });

    expect(outcome.status).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports failure rather than reloading into the same broken state', async () => {
    stubStorage('localStorage', () => { throw new DOMException('blocked', 'SecurityError'); });
    stubStorage('sessionStorage', () => { throw new DOMException('blocked', 'SecurityError'); });
    delete (globalThis as { indexedDB?: unknown }).indexedDB;

    const outcome = await attemptAuthPersistenceRecovery({ auth: fitssai, force: true, reload });

    expect(outcome.status).toBe('failed');
    expect(reload).not.toHaveBeenCalled();
  });
});
