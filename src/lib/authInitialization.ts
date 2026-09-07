/**
 * Detecting a Firebase Auth initialization that will never resolve.
 *
 * `onAuthStateChanged` does not report initialization failure. Reading the SDK
 * (@firebase/auth 1.7.9, `AuthImpl.registerStateListener`), the observer is
 * attached as:
 *
 *     const promise = this._isInitialized ? Promise.resolve() : this._initializationPromise;
 *     promise.then(() => { if (isUnsubscribed) return; cb(this.currentUser); });
 *
 * There is no rejection handler on that `then`. `_initializeWithPersistence`
 * awaits `PersistenceUserManager.create` and `initializeCurrentUser` without
 * catching either, so a blocked or corrupt persistence store rejects the
 * promise and the callback is simply never invoked. The `error` argument of
 * `onAuthStateChanged` does not fire either: it is wired to the subscription's
 * observer list, not to that promise. `authStateReady()` is built on the same
 * call and hangs identically.
 *
 * So the rejection is read from the promise itself, which the SDK keeps on the
 * instance. `src/test/firebaseAuthLifecycle.probe.test.ts` verifies all of this
 * against the real SDK.
 */

/** How long initialization may take before it is treated as unresponsive. */
export const AUTH_INIT_TIMEOUT_MS = 15_000;

/**
 * Why authentication never resolved, which decides what may be done about it.
 *
 * `initialization-failed` is proof: the promise rejected, so `_isInitialized`
 * will never be set and the instance can no longer publish anything. Clearing
 * its persisted state and reloading is the only way forward, and is safe to do
 * automatically.
 *
 * `unresponsive` is not proof — only that nothing arrived in time. It may still
 * be a slow restore that succeeds a moment later, so it resolves the gate
 * without destroying anything, and repair is left to the user to ask for.
 */
export type AuthInitFailure = 'initialization-failed' | 'unresponsive';

type MaybeInitializingAuth = { _initializationPromise?: Promise<unknown> | null };

/**
 * Call `onFailure` if authentication never resolves. Returns an unsubscribe;
 * call it as soon as the auth observer reports, so a late failure signal cannot
 * displace a resolved identity.
 */
export const observeAuthInitializationFailure = (
  authInstance: unknown,
  onFailure: (failure: AuthInitFailure, reason?: unknown) => void,
  timeoutMs: number = AUTH_INIT_TIMEOUT_MS,
): (() => void) => {
  let done = false;
  const fail = (failure: AuthInitFailure, reason?: unknown) => {
    if (done) return;
    done = true;
    onFailure(failure, reason);
  };

  const timer = setTimeout(
    () => fail('unresponsive', new Error(`Firebase Auth did not initialize within ${timeoutMs}ms.`)),
    timeoutMs,
  );

  const pending = (authInstance as MaybeInitializingAuth | null)?._initializationPromise;
  if (pending && typeof pending.then === 'function') {
    // Only the rejection matters. Success arrives through the auth observer,
    // which is the sole thing allowed to publish an identity.
    pending.then(undefined, (reason: unknown) => fail('initialization-failed', reason));
  }

  return () => {
    done = true;
    clearTimeout(timer);
  };
};
