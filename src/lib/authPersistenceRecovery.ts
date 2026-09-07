/**
 * Repairing a Firebase Auth instance that failed to initialize.
 *
 * Verified against firebase 10.14.1 / @firebase/auth 1.7.9 by
 * `src/test/firebaseAuthLifecycle.probe.test.ts`, which drives the real SDK:
 *
 *   - `_initializeWithPersistence` sets `_isInitialized = true` in exactly one
 *     place, at the tail of its queued task, and catches nothing along the way;
 *   - `notifyAuthListeners()` opens with `if (!this._isInitialized) { return; }`.
 *
 * So once initialization rejects, the instance is permanently deaf. Signing in
 * still sets `auth.currentUser`, and every publication of it is dropped —
 * observers registered before or after alike. No public API sets
 * `_isInitialized`, and `getAuth(app)` hands back the same broken object. The
 * instance cannot be repaired in place; a new one has to be constructed, which
 * means a reload.
 *
 * A reload alone would rejoin the same corrupt persisted state, so the Auth
 * store is cleared first — and only the Auth store. Everything this app owns is
 * left alone, so the same user gets their own workout state back the moment
 * they sign in again.
 *
 * The key format below is Firebase's, not ours: `_persistenceKeyName` builds
 * `firebase:<name>:<apiKey>:<appName>`, and `firebaseLocalStorageDb` is the
 * IndexedDB database `indexedDBLocalPersistence` keeps. That is the only
 * Firebase-internal knowledge in this codebase, and it lives here so an SDK
 * upgrade has one place to check. The probe fails loudly if the version moves.
 */

/** `firebase:<authUser|persistence|pendingRedirect>:<apiKey>:<appName>` */
const FIREBASE_AUTH_KEY = /^firebase:(authUser|persistence|pendingRedirect):/;

/** The database `indexedDBLocalPersistence` owns outright. */
const FIREBASE_AUTH_DB = 'firebaseLocalStorageDb';

/**
 * One automatic repair per tab, so a store that cannot be repaired reloads once
 * and then stops. Session-scoped on purpose: a later visit may well succeed,
 * and nothing should be permanently barred from trying again.
 */
export const AUTH_RECOVERY_MARKER = 'fitssai.auth.recoveryAttempted';

/** How long to wait on IndexedDB before reloading anyway. */
const DELETE_DB_TIMEOUT_MS = 2_000;

const safely = (operation: () => void): void => {
  try {
    operation();
  } catch {
    /* Blocked storage must not stop the rest of the repair. */
  }
};

export const hasAttemptedAuthRecovery = (): boolean => {
  try {
    return sessionStorage.getItem(AUTH_RECOVERY_MARKER) !== null;
  } catch {
    // Without readable session storage there is no loop guard, so treat the
    // repair as already spent rather than risk reloading forever.
    return true;
  }
};

export const clearAuthRecoveryMarker = (): void => {
  safely(() => sessionStorage.removeItem(AUTH_RECOVERY_MARKER));
};

const purgeKeysFrom = (store: Storage): void => {
  safely(() => {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && FIREBASE_AUTH_KEY.test(key)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  });
};

const deleteAuthDatabase = (): Promise<void> => new Promise(resolve => {
  if (typeof indexedDB === 'undefined') return resolve();
  let settled = false;
  const finish = () => { if (!settled) { settled = true; resolve(); } };
  // A delete blocked by the failed instance's own open connection still ends
  // with a reload, which closes it; waiting forever would help nobody.
  const timer = setTimeout(finish, DELETE_DB_TIMEOUT_MS);
  const done = () => { clearTimeout(timer); finish(); };
  try {
    const request = indexedDB.deleteDatabase(FIREBASE_AUTH_DB);
    request.onsuccess = done;
    request.onerror = done;
    request.onblocked = done;
  } catch {
    done();
  }
});

/**
 * Remove Firebase Auth's persisted state, and nothing else.
 *
 * Explicitly untouched: every `fitssai.*` key, the per-UID query caches,
 * training sessions, training caches and nudge history, the theme and the other
 * device preferences, and anything on this origin the app does not own.
 */
export const clearFirebaseAuthPersistence = async (): Promise<void> => {
  purgeKeysFrom(localStorage);
  purgeKeysFrom(sessionStorage);
  await deleteAuthDatabase();
};

export type AuthRecoveryResult = 'reloading' | 'already-attempted';

/**
 * Clear the failed instance's persisted state and reload into a fresh one.
 *
 * `force` is the difference between the app deciding and the user deciding:
 * automatic recovery runs at most once per tab, while a person pressing "try
 * again" is a deliberate act and is always honoured.
 */
export const attemptAuthPersistenceRecovery = async (
  { force = false, reload = () => window.location.reload() }: {
    force?: boolean;
    reload?: () => void;
  } = {},
): Promise<AuthRecoveryResult> => {
  if (!force && hasAttemptedAuthRecovery()) return 'already-attempted';

  safely(() => sessionStorage.setItem(AUTH_RECOVERY_MARKER, String(Date.now())));
  await clearFirebaseAuthPersistence();
  reload();
  return 'reloading';
};
