import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { uid: "A" } }, db: {} }));

import { enqueue, loadQueue, notifyEntryReplayed, removeEntry } from "./offlineQueue";
import {
  hasQueuedSetWrite,
  nextSetWriteSeq,
  readQueuedSetChange,
  resetSetWriteIntentsForTests,
  setChangesOverRead,
  trackSetWrite,
  whenSetWritesSettled,
} from "./setWriteIntents";

const DAY = { planId: "p", weekKey: "Week 1", dayIndex: 0 };
const SET = { ...DAY, exerciseIndex: 0, setNumber: 1 };
const reps = (value: number) => ({ kind: "performance" as const, reps: value });
const changesSince = (readSeq: number, owner = "A") =>
  setChangesOverRead(owner, DAY, readSeq).map(({ change }) => change);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  localStorage.clear();
  resetSetWriteIntentsForTests();
});

describe("tracked set writes", () => {
  it("show from the moment they are requested, in request order", () => {
    const read = nextSetWriteSeq();
    void trackSetWrite("A", SET, reps(10), () => new Promise(() => {}));
    void trackSetWrite("A", SET, reps(12), () => new Promise(() => {}));
    expect(changesSince(read)).toEqual([reps(10), reps(12)]);
  });

  it("drop only the failed change: a late failure of an older write cannot bring its value back", async () => {
    const read = nextSetWriteSeq();
    const older = deferred<{ success: boolean }>();
    const first = trackSetWrite("A", SET, reps(10), () => older.promise).catch((error: unknown) => error);
    await trackSetWrite("A", SET, reps(12), async () => ({ success: true }));

    older.reject(new Error("late failure"));
    await first;

    expect(changesSince(read)).toEqual([reps(12)]);
  });

  it("keep a committed change until a read that started after the commit arrives", async () => {
    const staleRead = nextSetWriteSeq();
    await trackSetWrite("A", SET, reps(12), async () => ({ success: true }));

    expect(changesSince(staleRead)).toEqual([reps(12)]);
    expect(changesSince(nextSetWriteSeq())).toEqual([]);
  });

  it("hand a queued change to its queue entry, and keep it through replay until a fresh read", async () => {
    await trackSetWrite("A", SET, reps(9), async () => {
      enqueue("UPDATE_SET_PERFORMANCE", { ...SET, reps: 9 }, "A");
      return { success: true, queued: true };
    });
    expect(changesSince(nextSetWriteSeq())).toEqual([reps(9)]);
    expect(hasQueuedSetWrite("A", SET)).toBe(true);

    const readBeforeReplay = nextSetWriteSeq();
    const [entry] = loadQueue();
    removeEntry(entry.id);
    notifyEntryReplayed(entry);

    expect(hasQueuedSetWrite("A", SET)).toBe(false);
    expect(changesSince(readBeforeReplay)).toEqual([reps(9)]);
    expect(changesSince(nextSetWriteSeq())).toEqual([]);
  });

  it("belong to the account that made them", async () => {
    void trackSetWrite("A", SET, reps(10), () => new Promise(() => {}));
    enqueue("TOGGLE_SET", { ...SET, completed: true }, "A");

    expect(changesSince(0, "B")).toEqual([]);
    expect(hasQueuedSetWrite("B", SET)).toBe(false);
  });

  it("report failures of writes still in flight to whoever waits for them", async () => {
    const pending = deferred<{ success: boolean }>();
    void trackSetWrite("A", SET, reps(1), () => pending.promise).catch(() => {});
    const waiting = whenSetWritesSettled("A");

    pending.reject(new Error("rejected"));

    await expect(waiting).resolves.toEqual({ failed: 1 });
    await expect(whenSetWritesSettled("A")).resolves.toEqual({ failed: 0 });
  });
});

describe("readQueuedSetChange", () => {
  it("reads an older TOGGLE_SET entry as completion only, ignoring copied reps and weight", () => {
    expect(readQueuedSetChange({
      type: "TOGGLE_SET", payload: { ...SET, completed: true, repsCompleted: 10, weightUsed: 60 },
    })).toEqual({ position: SET, change: { kind: "completion", completed: true } });
  });

  it("reads a performance entry field by field, with null as a clear", () => {
    expect(readQueuedSetChange({ type: "UPDATE_SET_PERFORMANCE", payload: { ...SET, reps: null } }))
      .toEqual({ position: SET, change: { kind: "performance", reps: null } });
  });

  it.each([
    ["an out-of-range value", { type: "UPDATE_SET_PERFORMANCE", payload: { ...SET, weightKg: 0 } }],
    ["no value", { type: "UPDATE_SET_PERFORMANCE", payload: { ...SET } }],
    ["no set number", { type: "TOGGLE_SET", payload: { ...DAY, exerciseIndex: 0, completed: true } }],
    ["another type", { type: "TOGGLE_DAY", payload: { ...SET, completed: true } }],
  ])("ignores an entry with %s", (_label, entry) => {
    expect(readQueuedSetChange(entry)).toBeNull();
  });
});
