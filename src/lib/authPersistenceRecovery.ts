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
 * store is cleared first — and only the four records belonging to this one
 * Firebase app. Nothing here ever deletes a database or clears an object
 * store; both are shared by every Firebase app on the origin.
 *
 * The key format below is Firebase's, not ours. This is the only
 * Firebase-internal knowledge in the codebase, and it lives here so an SDK
 * upgrade has one place to check; the probe fails loudly if the version moves.
 */

/**
 * Every name `_persistenceKeyName` is called with in the pinned SDK:
 * `authUser` (PersistenceUserManager.create's default userKey), `persistence`
 * (its fullPersistenceKey), `redirectUser` (the redirect manager's userKey) and
 * `pendingRedirect` (_getPendingRedirectKey). Confirmed by reading every call
 * site; the probe asserts the pinned version so a new name cannot slip in
 * silently.
 */
export const FIREBASE_AUTH_PERSISTENCE_NAMES = [
  'authUser',
  'persistence',
  'redirectUser',
  'pendingRedirect',
] as const;

/** The database `indexedDBLocalPersistence` uses — shared across every app on the origin. */
const FIREBASE_AUTH_DB = 'firebaseLocalStorageDb';
const FIREBASE_AUTH_STORE = 'firebaseLocalStorage';

/** Enough of an Auth instance to name its own records. Both fields are public API. */
export interface AuthIdentity {
  name: string;
  config: { apiKey?: string };
}

/**
 * The exact keys this Firebase app owns.
 *
 * `_persistenceKeyName` interpolates literally — `firebase:<name>:<apiKey>:<appName>`,
 * no encoding — so these are compared by equality and never by prefix. A second
 * Firebase app on the same origin differs in apiKey or appName and is therefore
 * simply not in this list, which is what keeps its records out of the cleanup.
 */
export const firebaseAuthPersistenceKeys = (auth: AuthIdentity): string[] => {
  const apiKey = auth?.config?.apiKey;
  const appName = auth?.name;
  // Without both halves of the scope there is no way to name this app's records
  // without risking someone else's, so nothing is targeted at all.
  if (!apiKey || !appName) return [];
  return FIREBASE_AUTH_PERSISTENCE_NAMES.map(name => `firebase:${name}:${apiKey}:${appName}`);
};

/**
 * One automatic repair per tab, so a store that cannot be repaired reloads once
 * and then stops. Session-scoped on purpose: a later visit may well succeed,
 * and nothing should be permanently barred from trying again.
 */
export const AUTH_RECOVERY_MARKER = 'fitssai.auth.recoveryAttempted';

/** How long to wait on IndexedDB before giving up on it. */
const INDEXED_DB_TIMEOUT_MS = 2_000;

export type StorageOutcome = 'cleared' | 'unavailable' | 'failed';
export type IndexedDbOutcome =
  | 'cleared' | 'unavailable' | 'database-absent' | 'store-absent' | 'failed' | 'timed-out';

export interface AuthPersistenceCleanupReport {
  local: StorageOutcome;
  session: StorageOutcome;
  indexedDb: IndexedDbOutcome;
  /** The keys actually removed, for diagnostics. */
  removed: string[];
}

/**
 * Reaching a storage area can itself throw.
 *
 * `window.localStorage` is a getter, and it raises SecurityError outright when
 * the browser blocks site data — before any method is called on it. So the
 * lookup lives inside the boundary too, and the two failures are reported
 * apart: storage that is not there is not the same as storage that refused a
 * write, and a caller deciding whether a reload could help needs to tell them
 * apart.
 */
const reachStorage = (read: () => Storage | undefined): Storage | null => {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
};

const removeKeysFrom = (read: () => Storage | undefined, keys: string[], removed: string[]): StorageOutcome => {
  const store = reachStorage(read);
  if (!store) return 'unavailable';
  let failed = false;
  for (const key of keys) {
    try {
      // Only remove what is there, so the diagnostics say what was really found.
      if (store.getItem(key) !== null) {
        store.removeItem(key);
        removed.push(key);
      }
    } catch {
      failed = true;
    }
  }
  return failed ? 'failed' : 'cleared';
};

/**
 * Delete this app's records from the shared Auth object store, one key at a
 * time.
 *
 * `objectStore.delete(exactKey)` is the only destructive operation here. Never
 * `deleteDatabase`, never `store.clear()`: `firebaseLocalStorageDb` is one
 * database per *origin*, and every Firebase app on that origin keeps its
 * records in the same `firebaseLocalStorage` store under the same `fbase_key`
 * strings. Dropping the database would sign the user out of unrelated
 * applications that merely happen to share the host.
 *
 * That holds even when the database turns out to be absent. Opening it creates
 * one, and deleting the empty result afterwards is a race, not a cleanup:
 * between the close and the delete another consumer can create the store and
 * commit its own records, which the delete then destroys. Instead the
 * versionchange transaction is aborted from inside `upgradeneeded`, which rolls
 * the creation back before anything is committed — verified in Chromium, where
 * the open then fails with AbortError and `indexedDB.databases()` is left
 * empty, while a concurrently queued open still creates the store and commits
 * its record untouched.
 */
const removeIndexedDbRecords = (keys: string[], removed: string[]): Promise<IndexedDbOutcome> =>
  new Promise(resolve => {
    let factory: IDBFactory | null = null;
    try {
      factory = typeof indexedDB === 'undefined' ? null : indexedDB;
    } catch {
      factory = null;
    }
    if (!factory || keys.length === 0) return resolve('unavailable');

    /*
      Once this has settled the caller has its answer, so nothing after that
      point may touch a record or the diagnostics. Every asynchronous callback
      below checks it before doing any work, because a slow open can still
      succeed long after the timeout returned.
    */
    let settled = false;
    let liveDb: IDBDatabase | null = null;
    let liveTransaction: IDBTransaction | null = null;

    const closeQuietly = () => {
      try { liveTransaction?.abort(); } catch { /* already finishing */ }
      try { liveDb?.close(); } catch { /* already closing */ }
      liveTransaction = null;
      liveDb = null;
    };

    const finish = (outcome: IndexedDbOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    // A blocked open or a wedged transaction must not hold recovery open. The
    // in-flight work is abandoned rather than left to finish unobserved.
    const timer = setTimeout(() => {
      finish('timed-out');
      closeQuietly();
    }, INDEXED_DB_TIMEOUT_MS);

    try {
      // Opened without a version so an existing database is never forced
      // through an upgrade it did not ask for.
      const request = factory.open(FIREBASE_AUTH_DB);
      let creating = false;

      request.onupgradeneeded = () => {
        // Reached only when the database was absent and this open is creating
        // it. Roll that back rather than committing an empty database that
        // would later have to be deleted by shared name.
        creating = true;
        try { request.transaction?.abort(); } catch { /* nothing was committed */ }
      };

      request.onblocked = () => finish('failed');

      request.onerror = event => {
        // The AbortError below is this code's own rollback, not a fault.
        event.preventDefault?.();
        finish(creating ? 'database-absent' : 'failed');
      };

      request.onsuccess = () => {
        const db = request.result;
        // Timed out while the open was in flight: take nothing further.
        if (settled) {
          try { db.close(); } catch { /* already closing */ }
          return;
        }
        liveDb = db;
        try {
          if (!db.objectStoreNames.contains(FIREBASE_AUTH_STORE)) {
            // An existing database without the store. Nothing of this app's is
            // in it, and it belongs to the origin, so it is left exactly as is.
            closeQuietly();
            return finish('store-absent');
          }

          const transaction = db.transaction(FIREBASE_AUTH_STORE, 'readwrite');
          liveTransaction = transaction;
          const store = transaction.objectStore(FIREBASE_AUTH_STORE);
          /*
            Held back until the transaction commits. A delete request can
            succeed and still be rolled back with the rest of the transaction,
            so reporting one as removed at request time would claim a durability
            the store never granted.
          */
          const deletedInTransaction: string[] = [];
          for (const key of keys) {
            // `delete` on an absent key succeeds, so a get-first round trip
            // would only add failure modes.
            const deletion = store.delete(key);
            deletion.onsuccess = () => { deletedInTransaction.push(`idb:${key}`); };
          }
          transaction.oncomplete = () => {
            liveTransaction = null;
            closeQuietly();
            if (settled) return;
            removed.push(...deletedInTransaction);
            finish('cleared');
          };
          transaction.onerror = () => { liveTransaction = null; closeQuietly(); finish('failed'); };
          transaction.onabort = () => { liveTransaction = null; closeQuietly(); finish('failed'); };
        } catch {
          closeQuietly();
          finish('failed');
        }
      };
    } catch {
      finish('failed');
    }
  });

/**
 * Remove this Firebase app's persisted auth state, and nothing else.
 *
 * Explicitly untouched: another Firebase app's records in the same stores,
 * every `fitssai.*` key, the per-UID query caches, training sessions, training
 * caches and nudge history, the theme and the other device preferences, and
 * anything on this origin the app does not own.
 */
export const clearFirebaseAuthPersistence = async (
  auth: AuthIdentity,
): Promise<AuthPersistenceCleanupReport> => {
  const keys = firebaseAuthPersistenceKeys(auth);
  const removed: string[] = [];
  const local = removeKeysFrom(() => window.localStorage, keys, removed);
  const session = removeKeysFrom(() => window.sessionStorage, keys, removed);
  const indexedDb = await removeIndexedDbRecords(keys, removed);
  return { local, session, indexedDb, removed };
};

export type MarkerState = 'present' | 'absent' | 'unreadable';

export const readRecoveryMarker = (): MarkerState => {
  const store = reachStorage(() => window.sessionStorage);
  if (!store) return 'unreadable';
  try {
    return store.getItem(AUTH_RECOVERY_MARKER) === null ? 'absent' : 'present';
  } catch {
    return 'unreadable';
  }
};

/**
 * Write the loop guard and prove it stuck.
 *
 * The write is read back on purpose. A quota error is not the only way a
 * `setItem` can fail to persist, and an automatic reload on the strength of a
 * guard that is not really there is an automatic reload that repeats forever.
 */
export const persistRecoveryMarker = (): boolean => {
  const store = reachStorage(() => window.sessionStorage);
  if (!store) return false;
  try {
    store.setItem(AUTH_RECOVERY_MARKER, String(Date.now()));
    return store.getItem(AUTH_RECOVERY_MARKER) !== null;
  } catch {
    return false;
  }
};

export const clearAuthRecoveryMarker = (): void => {
  const store = reachStorage(() => window.sessionStorage);
  if (!store) return;
  try {
    store.removeItem(AUTH_RECOVERY_MARKER);
  } catch {
    /* Nothing to undo if it cannot be reached. */
  }
};

export type AuthRecoveryOutcome =
  /** State cleared and the page is being reloaded into a fresh Auth instance. */
  | { status: 'reloading'; report: AuthPersistenceCleanupReport }
  /** This tab already spent its one automatic repair. */
  | { status: 'already-attempted' }
  /** The loop guard could not be persisted, so no automatic reload is allowed. */
  | { status: 'guard-unavailable' }
  /** Nothing could be reached, so a reload could not change anything. */
  | { status: 'failed'; report: AuthPersistenceCleanupReport };

const reachedSomething = (report: AuthPersistenceCleanupReport): boolean =>
  report.local === 'cleared' || report.session === 'cleared' ||
  report.indexedDb === 'cleared' || report.indexedDb === 'store-absent' ||
  report.indexedDb === 'database-absent';

/**
 * Clear this app's failed auth state and reload into a fresh instance.
 *
 * `force` is the difference between the app deciding and the user deciding.
 * Automatic recovery must first prove it has a durable per-tab guard, because
 * a reload it cannot remember is a reload it will perform again on the next
 * load, and the one after that. A person pressing "try again" is their own
 * bound on repetition, so that path proceeds whether or not the guard sticks.
 *
 * Always resolves. The caller decides what the UI does next, and it cannot do
 * that from a rejection it has to guess the meaning of.
 */
export const attemptAuthPersistenceRecovery = async (
  { auth, force = false, reload = () => window.location.reload() }: {
    auth: AuthIdentity;
    force?: boolean;
    reload?: () => void;
  },
): Promise<AuthRecoveryOutcome> => {
  if (!force) {
    const marker = readRecoveryMarker();
    if (marker === 'present') return { status: 'already-attempted' };
    if (marker === 'unreadable' || !persistRecoveryMarker()) return { status: 'guard-unavailable' };
  } else {
    // Best effort: a manual retry is allowed without it, but recording it keeps
    // a later automatic attempt from spending a repair that just happened.
    persistRecoveryMarker();
  }

  const report = await clearFirebaseAuthPersistence(auth);
  // If not one store could be reached, the reload would land on exactly the
  // state that just failed. Say so instead, and leave the user in control.
  if (!reachedSomething(report)) return { status: 'failed', report };

  reload();
  return { status: 'reloading', report };
};
