/**
 * Just enough IndexedDB to exercise record-scoped deletion.
 *
 * jsdom ships none and the project has no IndexedDB polyfill, so this models
 * the parts the recovery actually uses: named databases, an object store keyed
 * the way `firebaseLocalStorage` is keyed (`fbase_key`), and per-key deletes.
 * Records live in a real map so a test can assert that one app's rows went and
 * another app's rows stayed — something a `deleteDatabase` spy could never show.
 */

type Listener = (() => void) | null;

interface FakeRequest<T = unknown> {
  result: T;
  error: unknown;
  onsuccess: Listener;
  onerror: Listener;
  onupgradeneeded: Listener;
  onblocked: Listener;
}

const emit = (listener: Listener) => {
  // Asynchronous like the real thing, so handlers attached after the call still run.
  if (listener) queueMicrotask(listener);
};

const makeRequest = <T,>(): FakeRequest<T> => ({
  result: undefined as T,
  error: null,
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
  /** Make the next open fail, block, or make its transaction abort. */
  failOpen: boolean;
  blockOpen: boolean;
  failTransaction: boolean;
  /** Never settle the open request at all, to exercise the timeout. */
  hangOpen: boolean;
  deletedDatabases: string[];
}

export const createIndexedDbDouble = () => {
  const control: IndexedDbDoubleControl = {
    databases: new Map(),
    failOpen: false,
    blockOpen: false,
    failTransaction: false,
    hangOpen: false,
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

  const factory = {
    open(name: string) {
      const request = makeRequest<unknown>();
      if (control.hangOpen) return request;
      queueMicrotask(() => {
        if (control.failOpen) {
          request.error = new Error('open failed');
          return emit(request.onerror);
        }
        if (control.blockOpen) return emit(request.onblocked);

        const existed = control.databases.has(name);
        if (!existed) control.databases.set(name, { stores: new Map() });
        const data = control.databases.get(name)!;

        const db = {
          objectStoreNames: {
            contains: (storeName: string) => data.stores.has(storeName),
          },
          close: () => {},
          // The real API accepts a single store name or a sequence of them.
          transaction: (names: string | string[], _mode: string) => {
            const transaction: {
              oncomplete: Listener; onerror: Listener; onabort: Listener;
              objectStore: (storeName: string) => {
                delete: (key: string) => FakeRequest<undefined>;
              };
            } = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore: (storeName: string) => ({
                delete: (key: string) => {
                  const deletion = makeRequest<undefined>();
                  queueMicrotask(() => {
                    if (control.failTransaction) return;
                    // A delete of an absent key succeeds, as in the real API.
                    data.stores.get(storeName)?.delete(key);
                    emit(deletion.onsuccess);
                  });
                  return deletion;
                },
              }),
            };
            queueMicrotask(() => queueMicrotask(() => {
              if (control.failTransaction) emit(transaction.onabort);
              else emit(transaction.oncomplete);
            }));
            void names;
            return transaction;
          },
        };

        request.result = db;
        if (!existed) emit(request.onupgradeneeded);
        emit(request.onsuccess);
      });
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

  return { control, factory, seed, recordsIn };
};
