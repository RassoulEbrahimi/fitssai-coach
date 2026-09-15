import { vi } from "vitest";

type Row = Record<string, unknown>;
type Ref = { path: string };
type Filter = { field: string; op: string; value: unknown };
type Limit = { __limit: number };
type Order = { __orderBy: string; __direction: "asc" | "desc" };
type Constraint = Filter | Limit | Order;
type Query = { source: Ref; filters: Filter[]; limit?: number; order?: Order };

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
/** Equality on any value; ranges on strings, which is all the app filters by range. */
const passes = (data: Row, filter: Filter): boolean => {
  const value = data[filter.field];
  if (filter.op === '==') return value === filter.value;
  if (typeof value !== 'string' || typeof filter.value !== 'string') return false;
  switch (filter.op) {
    case '<': return value < filter.value;
    case '<=': return value <= filter.value;
    case '>': return value > filter.value;
    case '>=': return value >= filter.value;
    default: return false;
  }
};

const sortValue = (value: unknown): string | number | undefined => {
  if (typeof value === 'string' || typeof value === 'number') return value;
  const millis = (value as { toMillis?: () => number } | null | undefined)?.toMillis;
  return typeof millis === 'function' ? millis.call(value) : undefined;
};

/** Documents without the ordered field sort last, so an ordered read never loses them here. */
const byOrder = (order: Order) => ([, a]: [string, Row], [, b]: [string, Row]): number => {
  const left = sortValue(a[order.__orderBy]);
  const right = sortValue(b[order.__orderBy]);
  if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1;
  const sign = order.__direction === 'desc' ? -1 : 1;
  return left < right ? -sign : left > right ? sign : 0;
};

const match = (target: Query | Ref) => {
  const { source, filters, limit, order } = isQuery(target)
    ? target
    : { source: target, filters: [] as Filter[], limit: undefined, order: undefined };
  const matched = [...rows.entries()].filter(([path, data]) =>
    path.startsWith(`${source.path}/`) && path.split("/").length === source.path.split("/").length + 1 &&
    filters.every(f => passes(data, f))
  );
  if (order) matched.sort(byOrder(order));
  const snapshots = matched.map(([path]) => snapshot(path));
  const docs = limit === undefined ? snapshots : snapshots.slice(0, limit);
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
  /** Server-authoritative single-document read: rejects instead of answering from cache. */
  getDocFromServer: vi.fn(async (target: Ref) => {
    if (!serverCanAnswer(target.path)) throw unavailable(target.path);
    return snapshot(target.path);
  }),
  where: (field: string, op: string, value: unknown): Filter => ({ field, op, value }),
  /** `limit(n)` is a constraint like `where`, distinguished by its own marker. */
  limit: (count: number): Limit => ({ __limit: count }),
  /*
    Applied before `limit`, as Firestore does, so a bounded "newest first" read
    returns the newest documents. The plan reads that pair it with `limit(1)`
    over a single document are unaffected.
  */
  orderBy: (field: string, direction: "asc" | "desc" = "asc"): Order => ({ __orderBy: field, __direction: direction }),
  query: (source: Ref, ...constraints: Constraint[]) => ({
    source,
    filters: constraints.filter(isFilter),
    limit: constraints.find(isLimit)?.__limit,
    order: constraints.find(isOrder),
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
    delete: (target: Ref) => void;
  }) => Promise<void>) => {
    const task = serial.then(async () => {
      if (control.beforeCommit) await control.beforeCommit();
      if (control.rejectNext) {
        control.rejectNext = false;
        throw new Error("Persistence rejected");
      }
      const pending: { path: string; data: Row | null; merge: boolean }[] = [];
      await callback({
        get: async target => snapshot(target.path),
        set: (target, data) => { pending.push({ path: target.path, data, merge: false }); },
        update: (target, data) => { pending.push({ path: target.path, data, merge: true }); },
        delete: target => { pending.push({ path: target.path, data: null, merge: false }); },
      });
      pending.forEach(({ path, data, merge }) => {
        if (data === null) {
          rows.delete(path);
          writes.push({ path, data: { __deleted: true } });
          return;
        }
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
