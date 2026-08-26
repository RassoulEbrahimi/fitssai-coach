import { describe, it, expect, vi, beforeEach } from "vitest";

const addDoc = vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => ({ id: "log-1" }));
const getDocs = vi.fn(async (_query?: unknown) => ({ empty: true, docs: [] as { id: string }[] }));

vi.mock("firebase/firestore", () => ({
  collection: (...path: unknown[]) => ({ path }),
  doc: (...path: unknown[]) => ({ path }),
  query: (...args: unknown[]) => args,
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  addDoc: (ref: unknown, data: Record<string, unknown>) => addDoc(ref, data),
  deleteDoc: vi.fn(),
  updateDoc: vi.fn(),
  getDocs: (...args: unknown[]) => getDocs(args),
  Timestamp: { now: () => ({ __ts: true }) },
}));

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { uid: "u1" } },
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
  vi.clearAllMocks();
  getDocs.mockResolvedValue({ empty: true, docs: [] });
});

describe("offline replay — set logging", () => {
  it("dates a newly created parent log with the queued workout day", async () => {
    // A set queued offline on Tuesday and replayed on Thursday must still be
    // recorded against Tuesday.
    await handlers.TOGGLE_SET(setPayload());

    expect(parentLogPayload().workoutDay).toBe("2026-03-10");
  });

  it("keeps the plan position alongside the date", async () => {
    await handlers.TOGGLE_SET(setPayload());
    const payload = parentLogPayload();

    expect(payload.planId).toBe("plan-1");
    expect(payload.weekKey).toBe("Week 2");
    expect(payload.dayIndex).toBe(3);
    expect(payload.exerciseIndex).toBe(0);
  });

  it("still writes a valid log when an older queue entry has no date", async () => {
    // Entries queued before this change carry no workoutDay. They must replay
    // rather than fail, and must not invent a date.
    await handlers.TOGGLE_SET(setPayload({ workoutDay: undefined }));
    const payload = parentLogPayload();

    expect(payload.planId).toBe("plan-1");
    expect(payload).not.toHaveProperty("workoutDay");
  });

  it("does not accept a malformed date into the document", async () => {
    await handlers.TOGGLE_SET(setPayload({ workoutDay: "10.03.2026" }));

    expect(parentLogPayload()).not.toHaveProperty("workoutDay");
  });
});
