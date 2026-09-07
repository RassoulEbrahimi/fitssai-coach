import { vi } from "vitest";

type Row = Record<string, unknown>;
type Ref = { path: string };
type Filter = { field: string; value: unknown };

/** In-memory Firestore boundary: production queries and writers remain real. */
export const rows = new Map<string, Row>();
export const writes: { path: string; data: Row }[] = [];
export const control = { rejectNext: false, beforeCommit: undefined as (() => Promise<void>) | undefined };
let serial = Promise.resolve();

export const resetWorkoutFirestore = () => {
  rows.clear();
  writes.length = 0;
  control.rejectNext = false;
  control.beforeCommit = undefined;
  serial = Promise.resolve();
};

const ref = (...parts: (Ref | string)[]): Ref => ({
  path: parts.map(p => typeof p === "string" ? p : p.path).filter(Boolean).join("/"),
});
const snapshot = (path: string) => ({
  id: path.split("/").at(-1)!,
  exists: () => rows.has(path),
  data: () => ({ ...rows.get(path) }),
});

export const firestore = {
  collection: ref,
  doc: ref,
  where: (field: string, _op: string, value: unknown): Filter => ({ field, value }),
  query: (source: Ref, ...filters: Filter[]) => ({ source, filters }),
  getDocs: vi.fn(async ({ source, filters }: { source: Ref; filters: Filter[] }) => {
    const docs = [...rows.entries()].filter(([path, data]) =>
      path.startsWith(`${source.path}/`) && path.split("/").length === source.path.split("/").length + 1 &&
      filters.every(f => data[f.field] === f.value)
    ).map(([path]) => snapshot(path));
    return { docs, empty: docs.length === 0 };
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
    static now() { return new this(); }
    toDate() { return new Date(); }
  },
};

export const logPath = (id: string) => `users/u1/workout_logs/${id}`;
