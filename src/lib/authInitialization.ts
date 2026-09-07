/**
 * Detecting a Firebase Auth initialization that will never resolve.
 *
 * `onAuthStateChanged` does not report initialization failure. Reading the SDK
 * (@firebase/auth, `AuthImpl.registerStateListener`), the observer is attached
 * as:
 *
 *     const promise = this._isInitialized ? Promise.resolve() : this._initializationPromise;
 *     promise.then(() => { if (isUnsubscribed) return; cb(this.currentUser); });
 *
 * There is no rejection handler on that `then`. `_initializeWithPersistence`
 * awaits `PersistenceUserManager.create` and `initializeCurrentUser` without
 * catching either, so a blocked or corrupt persistence store — or a persisted
 * user record that will not parse — rejects the promise and the callback is
 * simply never invoked. The `error` argument of `onAuthStateChanged` does not
 * fire either: it is wired to the subscription's observer list, not to that
 * promise. `authStateReady()` is built on the same call and hangs identically.
 *
 * So the rejection is read from the promise itself, which the SDK keeps on the
 * instance. That is an internal field, so its absence is tolerated and a
 * bounded wait backs it up. The fallback is not a way of guessing the auth
 * state: the only state it ever resolves to is "initialization did not
 * complete", which mounts no account-scoped anything and stays correctable by
 * the observer if it does eventually fire.
 */

/** How long initialization may take before it is treated as failed. */
export const AUTH_INIT_TIMEOUT_MS = 15_000;

type MaybeInitializingAuth = { _initializationPromise?: Promise<unknown> | null };

/**
 * Call `onFailure` if authentication never resolves. Returns an unsubscribe;
 * call it as soon as the auth observer reports, so a late failure signal cannot
 * displace a resolved identity.
 */
export const observeAuthInitializationFailure = (
  authInstance: unknown,
  onFailure: (reason: unknown) => void,
  timeoutMs: number = AUTH_INIT_TIMEOUT_MS,
): (() => void) => {
  let done = false;
  const fail = (reason: unknown) => {
    if (done) return;
    done = true;
    onFailure(reason);
  };

  const timer = setTimeout(
    () => fail(new Error(`Firebase Auth did not initialize within ${timeoutMs}ms.`)),
    timeoutMs,
  );

  const pending = (authInstance as MaybeInitializingAuth | null)?._initializationPromise;
  if (pending && typeof pending.then === 'function') {
    // Only the rejection matters. Success arrives through the auth observer,
    // which is the sole thing allowed to publish an identity.
    pending.then(undefined, fail);
  }

  return () => {
    done = true;
    clearTimeout(timer);
  };
};
