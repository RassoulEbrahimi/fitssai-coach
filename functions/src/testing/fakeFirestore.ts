/**
 * A minimal in-memory stand-in for the Admin SDK's Firestore.
 *
 * It implements only what the callables actually use: document get/set/create,
 * one transaction, collection add, and the small query the weekly review needs
 * (`where`, `orderBy`, `limit`). That is enough to test the parts worth
 * testing — quota arithmetic, idempotency, the rule that nothing is persisted
 * before validation, and the rule that a review writes nothing at all —
 * without an emulator, so the pipelines stay covered by plain unit tests.
 *
 * `runTransaction` is serialised rather than optimistic. Real contention is
 * the emulator's business; what these tests need is that a read and its write
 * happen together, which is what makes the concurrency test meaningful.
 */

export interface FakeFirestoreOptions {
  /** Make writes to a matching path fail, to exercise failure paths. */
  failWrites?: (path: string) => boolean;
}

interface Doc {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

/** A query result document, with the two accessors the readers use. */
interface QueryDoc {
  id: string;
  data(): Record<string, unknown>;
  get(field: string): unknown;
}

type Comparison = [field: string, op: string, value: unknown];

/** Sorts undefined last, then by the natural order of the two values. */
const compareValues = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const left = a instanceof Date ? a.getTime() : (a as number | string);
  const right = b instanceof Date ? b.getTime() : (b as number | string);
  return left < right ? -1 : left > right ? 1 : 0;
};

export class FakeFirestore {
  readonly docs = new Map<string, Record<string, unknown>>();
  private lock: Promise<unknown> = Promise.resolve();
  private ids = 0;

  constructor(private readonly options: FakeFirestoreOptions = {}) {}

  private snapshot(path: string): Doc {
    const data = this.docs.get(path);
    return { exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
  }

  private writeAt(path: string, value: Record<string, unknown>, merge: boolean): void {
    if (this.options.failWrites?.(path)) throw new Error("write refused");
    const existing = merge ? (this.docs.get(path) ?? {}) : {};
    this.docs.set(path, { ...existing, ...value });
  }

  /** Arrow properties so `this` is lexical — no aliasing needed. */
  private readonly docRef = (path: string) => ({
    path,
    id: path.split("/").pop() as string,
    get: async () => this.snapshot(path),
    set: async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
      this.writeAt(path, value, options?.merge === true);
    },
    create: async (value: Record<string, unknown>) => {
      if (this.docs.has(path)) throw new Error("already exists");
      this.writeAt(path, value, false);
    },
    collection: (name: string) => this.collectionRef(path + "/" + name),
  });

  /** Documents that sit directly under a collection path, in insertion order. */
  private readonly childrenOf = (path: string): Array<[string, Record<string, unknown>]> =>
    [...this.docs.entries()].filter(
      ([docPath]) =>
        docPath.startsWith(path + "/") && !docPath.slice(path.length + 1).includes("/")
    );

  private readonly queryRef = (
    path: string,
    filters: Comparison[],
    order: { field: string; descending: boolean } | null,
    take: number | null
  ) => ({
    where: (field: string, op: string, value: unknown) =>
      this.queryRef(path, [...filters, [field, op, value]], order, take),
    orderBy: (field: string, direction?: string) =>
      this.queryRef(path, filters, { field, descending: direction === "desc" }, take),
    limit: (count: number) => this.queryRef(path, filters, order, count),
    get: async () => {
      let rows = this.childrenOf(path).filter(([, data]) =>
        filters.every(([field, op, value]) => {
          if (op !== "==") throw new Error("the fake supports only == filters");
          return data[field] === value;
        })
      );

      if (order) {
        const { field, descending } = order;
        rows = [...rows].sort(
          ([, a], [, b]) => compareValues(a[field], b[field]) * (descending ? -1 : 1)
        );
      }
      if (take !== null) rows = rows.slice(0, take);

      const docs: QueryDoc[] = rows.map(([docPath, data]) => ({
        id: docPath.split("/").pop() as string,
        data: () => ({ ...data }),
        get: (field: string) => data[field],
      }));

      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });

  private readonly collectionRef = (path: string) => ({
    path,
    doc: (id?: string) => this.docRef(path + "/" + (id ?? "auto-" + (this.ids += 1))),
    add: async (value: Record<string, unknown>) => {
      const ref = this.docRef(path + "/auto-" + (this.ids += 1));
      await ref.create(value);
      return ref;
    },
    where: (field: string, op: string, value: unknown) =>
      this.queryRef(path, [[field, op, value]], null, null),
    orderBy: (field: string, direction?: string) =>
      this.queryRef(path, [], { field, descending: direction === "desc" }, null),
    limit: (count: number) => this.queryRef(path, [], null, count),
    get: async () => this.queryRef(path, [], null, null).get(),
  });

  collection(name: string) {
    return this.collectionRef(name);
  }

  async runTransaction<T>(
    body: (tx: {
      get: (ref: { path: string }) => Promise<Doc>;
      set: (
        ref: { path: string },
        value: Record<string, unknown>,
        options?: { merge?: boolean }
      ) => void;
    }) => Promise<T>
  ): Promise<T> {
    const run = this.lock.then(() =>
      body({
        get: async (ref) => this.snapshot(ref.path),
        set: (ref, value, options) => this.writeAt(ref.path, value, options?.merge === true),
      })
    );
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Documents whose path starts with the given prefix. */
  under(prefix: string): Array<[string, Record<string, unknown>]> {
    return [...this.docs.entries()].filter(([path]) => path.startsWith(prefix));
  }
}

type AdminFirestore = import("firebase-admin/firestore").Firestore;

export const fakeFirestore = (options?: FakeFirestoreOptions) =>
  new FakeFirestore(options) as unknown as AdminFirestore & FakeFirestore;
