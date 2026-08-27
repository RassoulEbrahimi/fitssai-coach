/**
 * A minimal in-memory stand-in for the Admin SDK's Firestore.
 *
 * It implements only what the generation pipeline actually uses: document
 * get/set/create, one transaction, and collection add. That is enough to test
 * the parts worth testing — quota arithmetic, idempotency, and the rule that
 * nothing is persisted before validation — without an emulator, so the whole
 * pipeline stays covered by plain unit tests.
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

  private readonly collectionRef = (path: string) => ({
    path,
    doc: (id?: string) => this.docRef(path + "/" + (id ?? "auto-" + (this.ids += 1))),
    add: async (value: Record<string, unknown>) => {
      const ref = this.docRef(path + "/auto-" + (this.ids += 1));
      await ref.create(value);
      return ref;
    },
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
