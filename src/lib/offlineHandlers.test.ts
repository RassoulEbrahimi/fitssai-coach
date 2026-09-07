import { describe, it, expect, vi, beforeEach } from "vitest";
const identity = vi.hoisted(() => ({ currentUser: { uid: 'u1' } }));

const addDoc = vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => ({ id: "log-1" }));
const updateDoc = vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => undefined);
const getDocs = vi.fn(async (_query?: unknown) => ({ empty: true, docs: [] as { id: string; data: () => Record<string, unknown> }[] }));

vi.mock("firebase/firestore", () => ({
  collection: (...path: unknown[]) => ({ path }),
  doc: (...path: unknown[]) => ({ path }),
  query: (...args: unknown[]) => args,
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  addDoc: (ref: unknown, data: Record<string, unknown>) => addDoc(ref, data),
  deleteDoc: vi.fn(),
  updateDoc: (ref: unknown, data: Record<string, unknown>) => updateDoc(ref, data),
  getDocs: (...args: unknown[]) => getDocs(args),
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<void>) => {
    const result = await getDocs();
    const row = result.docs[0];
    return callback({
      get: async () => ({ exists: () => !!row, data: () => row?.data() }),
      update: updateDoc,
      set: addDoc,
    });
  },
  Timestamp: { now: () => ({ __ts: true }) },
}));

vi.mock("@/lib/firebase", () => ({
  auth: identity,
  db: {},
}));

import { handlers } from "./offlineHandlers";

const setPayload = (overrides: Record<string, unknown> = {}) => ({
  planId: "plan-1",
  weekKey: "Week 2",
  dayIndex: 3,
  exerciseIndex: 0,
  setNumber: 1,
  repsCompleted: 10,
  weightUsed: 40,
  completed: true,
  workoutDay: "2026-03-10",
  ...overrides,
});

/** The payload of the addDoc that created the parent log, not a set doc. */
const parentLogPayload = (): Record<string, unknown> => addDoc.mock.calls[0][1];

beforeEach(() => {
  identity.currentUser = { uid: 'u1' };
  vi.clearAllMocks();
  getDocs.mockResolvedValue({ empty: true, docs: [] });
});

describe('account changes during an awaited handler read', () => {
  it.each(['TOGGLE_SET', 'TOGGLE_DAY_COMPLETION'] as const)('%s stops before its first write', async type => {
    getDocs.mockImplementationOnce(async () => {
      identity.currentUser = { uid: 'other-account' };
      return { empty: true, docs: [] };
    });
    await expect(handlers[type](setPayload(), 'u1')).rejects.toThrow(/account/);
    expect(addDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('stops before changing a set when identity changes during the second read', async () => {
    getDocs.mockResolvedValueOnce({ empty: false, docs: [{ id: 'existing', data: () => ({}) }] });
    getDocs.mockImplementationOnce(async () => {
      identity.currentUser = { uid: 'other-account' };
      return { empty: true, docs: [] };
    });
    await expect(handlers.TOGGLE_SET(setPayload(), 'u1')).rejects.toThrow(/account/);
    expect(addDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});

describe("offline replay — set logging", () => {
  it("dates a newly created parent log with the queued workout day", async () => {
    // A set queued offline on Tuesday and replayed on Thursday must still be
    // recorded against Tuesday.
    await handlers.TOGGLE_SET(setPayload(), "u1");

    expect(parentLogPayload().workoutDay).toBe("2026-03-10");
  });

  it("keeps the plan position alongside the date", async () => {
    await handlers.TOGGLE_SET(setPayload(), "u1");
    const payload = parentLogPayload();

    expect(payload.planId).toBe("plan-1");
    expect(payload.weekKey).toBe("Week 2");
    expect(payload.dayIndex).toBe(3);
    expect(payload.exerciseIndex).toBe(0);
  });

  it("still writes a valid log when an older queue entry has no date", async () => {
    // Entries queued before this change carry no workoutDay. They must replay
    // rather than fail, and must not invent a date.
    await handlers.TOGGLE_SET(setPayload({ workoutDay: undefined }), "u1");
    const payload = parentLogPayload();

    expect(payload.planId).toBe("plan-1");
    expect(payload).not.toHaveProperty("workoutDay");
  });

  it("does not accept a malformed date into the document", async () => {
    await handlers.TOGGLE_SET(setPayload({ workoutDay: "10.03.2026" }), "u1");

    expect(parentLogPayload()).not.toHaveProperty("workoutDay");
  });
});

describe("offline replay — day completion", () => {
  const dayPayload = (overrides: Record<string, unknown> = {}) => ({
    planId: "plan-1",
    weekKey: "Week 2",
    dayIndex: 3,
    workoutDay: "2026-03-10",
    completed: true,
    ...overrides,
  });

  it("writes the same semantic document as the online day write", async () => {
    await handlers.TOGGLE_DAY(dayPayload() as never, "u1");
    const payload = addDoc.mock.calls[0][1];

    // Matches useWorkoutLogs.toggleDay: identified by planId + workoutDay,
    // carrying the plan position and the completion state.
    expect(payload.planId).toBe("plan-1");
    expect(payload.workoutDay).toBe("2026-03-10");
    expect(payload.weekKey).toBe("Week 2");
    expect(payload.dayIndex).toBe(3);
    expect(payload.completed).toBe(true);
  });

  it("carries no exerciseIndex — a day is not an exercise", async () => {
    await handlers.TOGGLE_DAY(dayPayload() as never, "u1");

    expect(addDoc.mock.calls[0][1]).not.toHaveProperty("exerciseIndex");
  });

  it("preserves the queued day when replayed on a later day", async () => {
    // Queued Tuesday, replayed Thursday: still Tuesday. The date travels in
    // the payload and nothing here reads a clock.
    await handlers.TOGGLE_DAY(dayPayload({ workoutDay: "2026-03-10" }) as never, "u1");

    expect(addDoc.mock.calls[0][1].workoutDay).toBe("2026-03-10");
  });

  it("keeps a December date across the year boundary", async () => {
    await handlers.TOGGLE_DAY(dayPayload({ workoutDay: "2025-12-31" }) as never, "u1");

    expect(addDoc.mock.calls[0][1].workoutDay).toBe("2025-12-31");
  });

  it("updates an existing day log instead of duplicating it", async () => {
    getDocs.mockResolvedValue({ empty: false, docs: [{ id: "existing", data: () => ({ planId: "plan-1", workoutDay: "2026-03-10" }) }] });

    await handlers.TOGGLE_DAY(dayPayload() as never, "u1");

    expect(addDoc).not.toHaveBeenCalled();
    expect(updateDoc.mock.calls[0][1].completed).toBe(true);
  });

  it("writes nothing when the metadata is unusable", async () => {
    await handlers.TOGGLE_DAY(dayPayload({ workoutDay: "10.03.2026" }) as never, "u1");
    await handlers.TOGGLE_DAY(dayPayload({ planId: "" }) as never, "u1");

    expect(addDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});

describe("offline replay — legacy day-completion entries", () => {
  it("drops a pre-PR48 entry rather than inventing plan metadata", async () => {
    // `{workoutDateStr, completed}` was queued under TOGGLE_DAY_COMPLETION.
    // It has a date but no plan position, and there is no way to recover one.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const keys = await handlers.TOGGLE_DAY_COMPLETION({
      workoutDateStr: "2026-03-10",
      completed: true,
    } as never, "u1");

    expect(addDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(keys).toEqual([]);
    // Dropped loudly, so it is visible in development rather than silent.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still replays a real exercise-completion entry", async () => {
    // Regression: the legacy guard must not swallow the shape this action
    // legitimately serves.
    await handlers.TOGGLE_DAY_COMPLETION({
      planId: "plan-1",
      weekKey: "Week 2",
      dayIndex: 3,
      exerciseIndex: 1,
      completed: true,
    } as never, "u1");

    const payload = addDoc.mock.calls[0][1];
    expect(payload.planId).toBe("plan-1");
    expect(payload.exerciseIndex).toBe(1);
  });
});
