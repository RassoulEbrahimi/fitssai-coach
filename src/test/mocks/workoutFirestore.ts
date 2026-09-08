import { vi } from "vitest";

type Row = Record<string, unknown>;
type Ref = { path: string };
type Filter = { field: string; op: string; value: unknown };
type Limit = { __limit: number };
type Order = { __orderBy: string };
type Constraint = Filter | Limit | Order;
type Query = { source: Ref; filters: Filter[]; limit?: number };

const isLimit = (constraint: Constraint): constraint is Limit =>
  typeof (constraint as Limit).__limit === "number";
const isOrder = (constraint: Constraint): constraint is Order =>
  typeof (constraint as Order).__orderBy === "string";
const isFilter = (constraint: Constraint): constraint is Filter =>
  !isLimit(constraint) && !isOrder(constraint);
const isQuery = (target: Query | Ref): target is Query =>
  (target as Query).source !== undefined;

/** In-memory Firestore boundary: production queries and writers remain real. */
export const rows = new Map<string, Row>();
export const writes: { path: string; data: Row }[] = [];
export const control = {
  rejectNext: false,
  beforeCommit: undefined as (() => Promise<void>) | undefined,
  /**
   * Collection paths the server cannot currently answer for, as path prefixes.
   *
   * This models the state the guard exists to survive: the SDK has decided it
   * is offline while the device still reports a connection. In it the two read
   * primitives disagree, which is the whole point of preferring one of them -
   * `getDocsFromServer` rejects, and `getDocs` resolves out of the local cache,
   * which without persistence is empty on every page load. A test that sets
   * this and still sees an edit go through has found a cache-served false
   * negative.
   */
  serverUnavailablePaths: [] as string[],
};
let serial = Promise.resolve();
let autoId = 0;

export const resetWorkoutFirestore = () => {
  rows.clear();
  writes.length = 0;
  autoId = 0;
  control.rejectNext = false;
  control.beforeCommit = undefined;
  control.serverUnavailablePaths = [];
  serial = Promise.resolve();
};

/** The SDK's own shape for "the backend could not be reached". */
const unavailable = (path: string) =>
  Object.assign(new Error(`Failed to get documents from server. (${path})`), {
    name: "FirebaseError",
    code: "unavailable",
  });

const serverCanAnswer = (path: string) =>
  !control.serverUnavailablePaths.some(prefix => path === prefix || path.startsWith(`${prefix}/`));

const ref = (...parts: (Ref | string)[]): Ref => ({
  path: parts.map(p => typeof p === "string" ? p : p.path).filter(Boolean).join("/"),
});
const snapshot = (path: string) => ({
  id: path.split("/").at(-1)!,
  exists: () => rows.has(path),
  data: () => ({ ...rows.get(path) }),
});

/*
  Shared matcher behind both read primitives. Accepts a query and a bare
  collection reference alike: `useSetTracking` reads a set subcollection with
  `getDocs(setsRef)` and no constraints, so a query-only double would leave
  that production read untestable.
*/
const match = (target: Query | Ref) => {
  const { source, filters, limit } = isQuery(target)
    ? target
    : { source: target, filters: [] as Filter[], limit: undefined };
  const matched = [...rows.entries()].filter(([path, data]) =>
    path.startsWith(`${source.path}/`) && path.split("/").length === source.path.split("/").length + 1 &&
    filters.every(f => f.op === '==' ? data[f.field] === f.value :
      typeof data[f.field] === 'string' && typeof f.value === 'string' &&
      (f.op === '>=' ? (data[f.field] as string) >= f.value :
        f.op === '<=' && (data[f.field] as string) <= f.value))
  ).map(([path]) => snapshot(path));
  const docs = limit === undefined ? matched : matched.slice(0, limit);
  return { docs, empty: docs.length === 0 };
};

export const firestore = {
  collection: ref,
  doc: ref,
  /*
    The direct document writers, alongside the transactional one below. The
    online set/exercise writers reach Firestore through these, so leaving them
    off the boundary would make those paths untestable rather than safe.
  */
  addDoc: vi.fn(async (target: Ref, data: Row) => {
    autoId += 1;
    const path = `${target.path}/auto-${autoId}`;
    rows.set(path, { ...data });
    writes.push({ path, data });
    return { id: `auto-${autoId}`, path };
  }),
  setDoc: vi.fn(async (target: Ref, data: Row) => {
    rows.set(target.path, { ...data });
    writes.push({ path: target.path, data });
  }),
  updateDoc: vi.fn(async (target: Ref, data: Row) => {
    rows.set(target.path, { ...rows.get(target.path), ...data });
    writes.push({ path: target.path, data });
  }),
  deleteDoc: vi.fn(async (target: Ref) => {
    rows.delete(target.path);
    writes.push({ path: target.path, data: { __deleted: true } });
  }),
  /** Single-document read, used by every workout-plan editing path. */
  getDoc: vi.fn(async (target: Ref) => snapshot(target.path)),
  where: (field: string, op: string, value: unknown): Filter => ({ field, op, value }),
  /** `limit(n)` is a constraint like `where`, distinguished by its own marker. */
  limit: (count: number): Limit => ({ __limit: count }),
  /*
    Ordering is recorded but not applied: every caller here pairs it with
    `limit(1)` over a single plan document, so a sort would change nothing. It
    exists so the plan read in `AddWorkoutModal` reaches the boundary at all -
    without it that production path could not be tested.
  */
  orderBy: (field: string): Order => ({ __orderBy: field }),
  query: (source: Ref, ...constraints: Constraint[]) => ({
    source,
    filters: constraints.filter(isFilter),
    limit: constraints.find(isLimit)?.__limit,
  }),
  /** Cache-eligible read, as every reader outside the history guard uses. */
  getDocs: vi.fn(async (target: Query | Ref) => {
    const source = isQuery(target) ? target.source : target;
    // Cache semantics: an unreachable server does not fail this read, it
    // silently narrows it to whatever the local cache holds - nothing.
    if (!serverCanAnswer(source.path)) return { docs: [], empty: true };
    return match(target);
  }),
  /**
   * Server-authoritative read. Rejects rather than falling back to the cache,
   * which is why the history guard uses it.
   */
  getDocsFromServer: vi.fn(async (target: Query | Ref) => {
    const source = isQuery(target) ? target.source : target;
    if (!serverCanAnswer(source.path)) throw unavailable(source.path);
    return match(target);
  }),
  runTransaction: vi.fn(async (_db: unknown, callback: (transaction: {
    get: (target: Ref) => Promise<ReturnType<typeof snapshot>>;
    set: (target: Ref, data: Row) => void;
    update: (target: Ref, data: Row) => void;
  }) => Promise<void>) => {
    const task = serial.then(async () => {
      if (control.beforeCommit) await control.beforeCommit();
      if (control.rejectNext) {
        control.rejectNext = false;
        throw new Error("Persistence rejected");
      }
      const pending: { path: string; data: Row; merge: boolean }[] = [];
      await callback({
        get: async target => snapshot(target.path),
        set: (target, data) => { pending.push({ path: target.path, data, merge: false }); },
        update: (target, data) => { pending.push({ path: target.path, data, merge: true }); },
      });
      pending.forEach(({ path, data, merge }) => {
        rows.set(path, { ...(merge ? rows.get(path) : {}), ...data });
        writes.push({ path, data });
      });
    });
    serial = task.catch(() => {});
    await task;
  }),
  Timestamp: class {
    constructor(private millis: number = Date.now()) {}
    static now() { return new this(Date.now()); }
    static fromMillis(millis: number) { return new this(millis); }
    toDate() { return new Date(this.millis); }
    toMillis() { return this.millis; }
  },
};

export const logPath = (id: string) => `users/u1/workout_logs/${id}`;
