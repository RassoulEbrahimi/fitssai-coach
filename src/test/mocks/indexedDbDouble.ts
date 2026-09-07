/**
 * Just enough IndexedDB to exercise record-scoped deletion.
 *
 * jsdom ships none and the project has no IndexedDB polyfill, so this models
 * the parts the recovery actually uses. Records live in a real map, so a test
 * can assert that one app's rows went and another app's rows stayed —
 * something a `deleteDatabase` spy could never show.
 *
 * The three behaviours the recovery leans on are modelled from what Chromium
 * actually does, measured by the probe in `docs/PR64-account-lifecycle.md`:
 *
 *   - opening an absent database fires `upgradeneeded` with `request.transaction`
 *     set to the versionchange transaction;
 *   - aborting that transaction rolls the creation back, leaving no database,
 *     and the open request then fails with `AbortError`;
 *   - a concurrently queued open is unaffected and still creates and commits.
 *
 * What it cannot model is real cross-connection scheduling, so the true
 * concurrency guarantee is established by the browser probe rather than here.
 * This proves what *our* code does; the probe proves what the platform does.
 */

type Listener = ((event: { preventDefault?: () => void }) => void) | null;

interface FakeRequest<T = unknown> {
  result: T;
  error: { name: string } | null;
  transaction: { abort: () => void } | null;
  onsuccess: Listener;
  onerror: Listener;
  onupgradeneeded: Listener;
  onblocked: Listener;
}

const emit = (listener: Listener) => {
  // Asynchronous like the real thing, so handlers attached after the call still run.
  if (listener) queueMicrotask(() => listener({ preventDefault: () => {} }));
};

const makeRequest = <T,>(): FakeRequest<T> => ({
  result: undefined as T,
  error: null,
  transaction: null,
  onsuccess: null,
  onerror: null,
  onupgradeneeded: null,
  onblocked: null,
});

export interface FakeDatabase {
  stores: Map<string, Map<string, unknown>>;
}

export interface IndexedDbDoubleControl {
  /** name → database */
  databases: Map<string, FakeDatabase>;
  failOpen: boolean;
  blockOpen: boolean;
  /** Let the delete requests succeed, then abort before commit. */
  abortTransactionAfterDeletes: boolean;
  /** Never settle the open request, to exercise the timeout. */
  hangOpen: boolean;
  /** Release a hung open later, to prove nothing happens after settlement. */
  releaseHungOpen: (() => void) | null;
  /** Anything that called deleteDatabase, which production code must never do. */
  deletedDatabases: string[];
}

export const createIndexedDbDouble = () => {
  const control: IndexedDbDoubleControl = {
    databases: new Map(),
    failOpen: false,
    blockOpen: false,
    abortTransactionAfterDeletes: false,
    hangOpen: false,
    releaseHungOpen: null,
    deletedDatabases: [],
  };

  const seed = (dbName: string, storeName: string, records: Record<string, unknown>) => {
    const db = control.databases.get(dbName) ?? { stores: new Map() };
    const store = db.stores.get(storeName) ?? new Map<string, unknown>();
    for (const [key, value] of Object.entries(records)) store.set(key, value);
    db.stores.set(storeName, store);
    control.databases.set(dbName, db);
  };

  const recordsIn = (dbName: string, storeName: string): Map<string, unknown> =>
    control.databases.get(dbName)?.stores.get(storeName) ?? new Map();

  const buildDb = (name: string, data: FakeDatabase) => ({
    objectStoreNames: { contains: (storeName: string) => data.stores.has(storeName) },
    close: () => {},
    createObjectStore: (storeName: string) => {
      data.stores.set(storeName, new Map());
      return { put: (row: { fbase_key: string; value: unknown }) => {
        data.stores.get(storeName)!.set(row.fbase_key, row.value);
      } };
    },
    // The real API accepts a single store name or a sequence of them.
    transaction: (names: string | string[], _mode?: string) => {
      void names;
      let aborted = false;
      const transaction: {
        oncomplete: Listener; onerror: Listener; onabort: Listener;
        abort: () => void;
        objectStore: (storeName: string) => {
          delete: (key: string) => FakeRequest<undefined>;
          put: (row: { fbase_key: string; value: unknown }) => FakeRequest<undefined>;
        };
      } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort: () => { aborted = true; },
        objectStore: (storeName: string) => ({
          delete: (key: string) => {
            const deletion = makeRequest<undefined>();
            queueMicrotask(() => {
              if (aborted) return;
              // Requests succeed against the pending view of the store; the
              // rollback below is what decides whether it lasted.
              pending.push(() => data.stores.get(storeName)?.delete(key));
              emit(deletion.onsuccess);
            });
            return deletion;
          },
          put: (row: { fbase_key: string; value: unknown }) => {
            const write = makeRequest<undefined>();
            queueMicrotask(() => {
              if (aborted) return;
              pending.push(() => data.stores.get(storeName)?.set(row.fbase_key, row.value));
              emit(write.onsuccess);
            });
            return write;
          },
        }),
      };
      const pending: (() => void)[] = [];
      // Two microtask hops so every request queued in this turn resolves first.
      queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => {
        if (aborted || control.abortTransactionAfterDeletes) {
          // Rolled back: nothing the requests asked for is applied.
          return emit(transaction.onabort);
        }
        for (const apply of pending) apply();
        emit(transaction.oncomplete);
      })));
      return transaction;
    },
  });

  const factory = {
    open(name: string, version?: number) {
      const request = makeRequest<ReturnType<typeof buildDb>>();
      const settle = () => {
        if (control.failOpen) {
          request.error = { name: 'UnknownError' };
          return emit(request.onerror);
        }
        if (control.blockOpen) return emit(request.onblocked);

        const existed = control.databases.has(name);
        const data = control.databases.get(name) ?? { stores: new Map() };
        const db = buildDb(name, data);
        request.result = db;

        if (!existed) {
          // The versionchange transaction the creation runs in. Aborting it
          // rolls the whole creation back, exactly as Chromium does.
          let rolledBack = false;
          request.transaction = { abort: () => { rolledBack = true; } };
          if (request.onupgradeneeded) {
            request.onupgradeneeded({ preventDefault: () => {} });
          }
          if (rolledBack) {
            request.error = { name: 'AbortError' };
            return emit(request.onerror);
          }
          // Committed only because nothing aborted it.
          control.databases.set(name, data);
          void version;
          return emit(request.onsuccess);
        }
        emit(request.onsuccess);
      };

      if (control.hangOpen) control.releaseHungOpen = () => queueMicrotask(settle);
      else queueMicrotask(settle);
      return request;
    },
    deleteDatabase(name: string) {
      const request = makeRequest<undefined>();
      queueMicrotask(() => {
        control.databases.delete(name);
        control.deletedDatabases.push(name);
        emit(request.onsuccess);
      });
      return request;
    },
  };

  return { control, factory, seed, recordsIn, buildDb };
};
