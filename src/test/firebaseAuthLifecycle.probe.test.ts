import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import { initializeAuth, onAuthStateChanged, type Auth, type Persistence } from 'firebase/auth';
import { version as firebaseVersion } from 'firebase/package.json';
import { version as authVersion } from '@firebase/auth/package.json';

/**
 * What the installed Firebase Auth actually does when initialization rejects.
 *
 * This drives the real SDK, not a mock, because the recovery design turns on
 * one question the mocks cannot answer: whether a failed Auth instance can be
 * brought back to life. Everything asserted here is behaviour the pinned
 * version exhibits; if an upgrade changes it, this fails and the recovery in
 * `authInitialization.ts` should be revisited.
 */

const CONFIG = {
  apiKey: 'probe-api-key',
  authDomain: 'probe.firebaseapp.com',
  projectId: 'probe',
  appId: '1:1:web:1',
};

/** Reaches the fields the SDK keeps internally, for observation only. */
type AuthInternals = Auth & { _isInitialized: boolean; _initializationPromise: Promise<void> | null };

/*
  `initializeAuth` takes the persistence *class* — `_getInstance` asserts
  `cls instanceof Function` and constructs it — so these are classes, one per
  instance, since instances are cached by class identity.
*/
const brokenPersistence = () => (class BrokenPersistence {
  readonly type = 'LOCAL';
  // Rejects outside PersistenceUserManager.create's try/catch, so the whole
  // initialization promise rejects.
  async _isAvailable(): Promise<boolean> { throw new Error('Persistence store unavailable'); }
  async _set(): Promise<void> {}
  async _get(): Promise<null> { return null; }
  async _remove(): Promise<void> {}
  _addListener(): void {}
  _removeListener(): void {}
  readonly _shouldAllowMigration = false;
} as unknown as Persistence);

const healthyPersistence = () => (class HealthyPersistence {
  readonly type = 'NONE';
  async _isAvailable(): Promise<boolean> { return true; }
  async _set(): Promise<void> {}
  async _get(): Promise<null> { return null; }
  async _remove(): Promise<void> {}
  _addListener(): void {}
  _removeListener(): void {}
  readonly _shouldAllowMigration = false;
} as unknown as Persistence);

/*
  Driving the SDK into this failure leaks unhandled rejections, and that leak is
  itself part of the finding: `registerStateListener` does
  `promise.then(() => cb(...))` with no rejection handler, so every subscriber
  on a failing instance leaves a derived promise nothing will ever settle for.
  The runner's listeners are set aside for this file so those leaks can be
  collected and asserted rather than silently swallowed or crashing the run.
*/
const sdkLeaks: unknown[] = [];
let runnerListeners: ((reason: unknown, promise: Promise<unknown>) => void)[] = [];

beforeAll(() => {
  runnerListeners = process.listeners('unhandledRejection') as typeof runnerListeners;
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', reason => { sdkLeaks.push(reason); });
});

afterAll(() => {
  process.removeAllListeners('unhandledRejection');
  for (const listener of runnerListeners) process.on('unhandledRejection', listener);
});

let appCount = 0;
let auth: AuthInternals;
let app: ReturnType<typeof initializeApp>;

const freshBrokenAuth = () => {
  appCount += 1;
  app = initializeApp(CONFIG, `probe-${appCount}`);
  auth = initializeAuth(app, { persistence: brokenPersistence() }) as AuthInternals;
  // The SDK floats this promise. Each test observes it deliberately; this keeps
  // the copy nobody awaits from surfacing as an unhandled rejection.
  auth._initializationPromise?.catch(() => {});
  return auth;
};

beforeEach(() => { vi.clearAllMocks(); });

describe(`firebase ${firebaseVersion} / @firebase/auth ${authVersion} initialization failure`, () => {
  it('pins the versions this recovery design was verified against', () => {
    expect(firebaseVersion).toBe('10.14.1');
    expect(authVersion).toBe('1.7.9');
  });

  it('rejects the initialization promise and never sets _isInitialized', async () => {
    freshBrokenAuth();

    await expect(auth._initializationPromise).rejects.toThrow(/unavailable/);
    expect(auth._isInitialized).toBe(false);

    // Nothing later flips it: `_isInitialized = true` is assigned in exactly one
    // place, the tail of the queued initialization task that just threw.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(auth._isInitialized).toBe(false);

    await deleteApp(app);
  });

  it('never calls the observer — neither its next nor its error callback', async () => {
    freshBrokenAuth();
    const next = vi.fn();
    const onError = vi.fn();
    onAuthStateChanged(auth, next, onError);

    await auth._initializationPromise!.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(next).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    await deleteApp(app);
  });

  it('drops every publication afterwards, so signing in cannot restore identity', async () => {
    freshBrokenAuth();
    const next = vi.fn();
    onAuthStateChanged(auth, next);
    await auth._initializationPromise!.catch(() => {});

    /*
      Stands in for a successful signInWithEmailAndPassword without needing a
      network: that call ends in _updateCurrentUser, which sets currentUser and
      then asks notifyAuthListeners to publish. notifyAuthListeners begins
      `if (!this._isInitialized) { return; }`, so the publication is dropped and
      no observer — this one or any registered later — ever hears about it.
    */
    (auth as unknown as { currentUser: unknown }).currentUser = { uid: 'A' };
    (auth as unknown as { notifyAuthListeners: () => void }).notifyAuthListeners();
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(next).not.toHaveBeenCalled();
    expect(auth.currentUser).toEqual({ uid: 'A' });

    // A listener registered after the fact fares no better: it attaches to the
    // same rejected promise with a fulfillment handler only.
    const late = vi.fn();
    onAuthStateChanged(auth, late);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(late).not.toHaveBeenCalled();

    await deleteApp(app);
  });

  it('leaves each subscriber on a failed instance with an unhandled rejection', async () => {
    // Three observers were registered on broken instances above; each one's
    // derived promise rejected with nothing attached to it. Nothing routes an
    // initialization failure anywhere a caller can see it.
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(sdkLeaks.length).toBeGreaterThan(0);
    expect(sdkLeaks.every(reason => reason instanceof Error
      && /Persistence store unavailable/.test(reason.message))).toBe(true);
  });

  it('leaves a healthy instance publishing normally, so the failure is the persistence', async () => {
    appCount += 1;
    const healthyApp = initializeApp(CONFIG, `probe-${appCount}`);
    const healthy = initializeAuth(healthyApp, {
      persistence: healthyPersistence(),
    }) as AuthInternals;

    const next = vi.fn();
    onAuthStateChanged(healthy, next);
    await healthy._initializationPromise;

    expect(healthy._isInitialized).toBe(true);
    expect(next).toHaveBeenCalledWith(null);

    await deleteApp(healthyApp);
  });
});
