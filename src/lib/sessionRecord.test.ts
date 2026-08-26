import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  Firestore is mocked so the write payload can be inspected directly. Nothing
  here touches a real project, and no credentials are needed.
*/
const addDoc = vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => ({ id: "new-log" }));
const updateDoc = vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => undefined);
const getDocs = vi.fn(async (_query?: unknown) => ({ empty: true, docs: [] as { id: string }[] }));

vi.mock("firebase/firestore", () => ({
  collection: (...path: unknown[]) => ({ path }),
  doc: (...path: unknown[]) => ({ path }),
  query: (...args: unknown[]) => args,
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  addDoc: (ref: unknown, data: Record<string, unknown>) => addDoc(ref, data),
  updateDoc: (ref: unknown, data: Record<string, unknown>) => updateDoc(ref, data),
  getDocs: (...args: unknown[]) => getDocs(args),
  Timestamp: { now: () => ({ __ts: true }) },
}));

import { recordSessionDuration } from "./sessionRecord";
import { MAX_SESSION_SEC } from "./workoutLog";

const AT = (iso: string) => new Date(iso).getTime();
const STARTED = AT("2026-03-10T18:00:00Z");

const input = (overrides: Partial<Parameters<typeof recordSessionDuration>[0]> = {}) => ({
  uid: "u1",
  planId: "plan-1",
  weekKey: "Week 2",
  dayIndex: 3,
  workoutDay: "2026-03-10",
  startedAt: STARTED,
  endedAt: AT("2026-03-10T18:45:00Z"),
  ...overrides,
});

const payloadOf = (mock: typeof addDoc | typeof updateDoc): Record<string, unknown> =>
  mock.mock.calls[0][1];

beforeEach(() => {
  vi.clearAllMocks();
  getDocs.mockResolvedValue({ empty: true, docs: [] });
});

describe("recordSessionDuration", () => {
  it("writes the real measured duration", async () => {
    const result = await recordSessionDuration(input());

    expect(result).toEqual({ status: "written", durationSec: 2700 });
    expect(payloadOf(addDoc).durationSec).toBe(2700);
  });

  it("writes the full joinable metadata", async () => {
    await recordSessionDuration(input());
    const payload = payloadOf(addDoc);

    expect(payload.planId).toBe("plan-1");
    expect(payload.weekKey).toBe("Week 2");
    expect(payload.dayIndex).toBe(3);
    expect(payload.workoutDay).toBe("2026-03-10");
  });

  it("records the explicitly selected day, not today", async () => {
    await recordSessionDuration(input({ workoutDay: "2025-12-31" }));

    expect(payloadOf(addDoc).workoutDay).toBe("2025-12-31");
  });

  it("never claims the workout was completed", async () => {
    // Ending a session says nothing about finishing the workout; completion
    // stays owned by the per-exercise logs.
    await recordSessionDuration(input());

    expect(payloadOf(addDoc)).not.toHaveProperty("completed");
    expect(payloadOf(addDoc)).not.toHaveProperty("completedAt");
  });

  it("updates the existing day log rather than adding a second one", async () => {
    getDocs.mockResolvedValue({ empty: false, docs: [{ id: "existing-log" }] });

    await recordSessionDuration(input());

    expect(addDoc).not.toHaveBeenCalled();
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(payloadOf(updateDoc).durationSec).toBe(2700);
    // The day's completion state on that document is left untouched.
    expect(payloadOf(updateDoc)).not.toHaveProperty("completed");
  });

  it("does not double-count when the end is replayed", async () => {
    await recordSessionDuration(input());
    getDocs.mockResolvedValue({ empty: false, docs: [{ id: "new-log" }] });
    await recordSessionDuration(input());

    // Absolute value, written twice — not accumulated.
    expect(payloadOf(addDoc).durationSec).toBe(2700);
    expect(payloadOf(updateDoc).durationSec).toBe(2700);
  });

  it("writes nothing when the start time is missing", async () => {
    const result = await recordSessionDuration(input({ startedAt: null }));

    expect(result).toEqual({ status: "skipped", reason: "no-duration" });
    expect(addDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("writes nothing when the start time is in the future", async () => {
    const result = await recordSessionDuration(
      input({ startedAt: AT("2026-03-10T20:00:00Z"), endedAt: AT("2026-03-10T18:00:00Z") })
    );

    expect(result).toEqual({ status: "skipped", reason: "no-duration" });
    expect(addDoc).not.toHaveBeenCalled();
  });

  it("writes nothing for an implausibly long session", async () => {
    const result = await recordSessionDuration(
      input({ endedAt: STARTED + (MAX_SESSION_SEC + 60) * 1000 })
    );

    expect(result).toEqual({ status: "skipped", reason: "no-duration" });
    expect(addDoc).not.toHaveBeenCalled();
  });

  it.each([
    ["uid", { uid: "" }],
    ["planId", { planId: "" }],
    ["weekKey", { weekKey: "" }],
    ["workoutDay", { workoutDay: "10.03.2026" }],
    ["dayIndex", { dayIndex: 9 }],
  ])("writes nothing when %s is unusable", async (_name, overrides) => {
    const result = await recordSessionDuration(input(overrides));

    expect(result).toEqual({ status: "skipped", reason: "incomplete-metadata" });
    expect(addDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
