import { describe, it, expect, vi, beforeEach } from "vitest";
import { rows, writes, control, resetWorkoutFirestore, logPath } from "@/test/mocks/workoutFirestore";

vi.mock("firebase/firestore", async () => (await import("@/test/mocks/workoutFirestore")).firestore);
import { recordSessionDuration } from "./sessionRecord";
import { isCompletedDayLog } from "./workoutCompletion";
import { MAX_SESSION_SEC } from "./workoutLog";

const STARTED = Date.parse("2026-03-10T18:00:00Z");
const identity = { planId: "plan-1", weekKey: "Week 2", dayIndex: 1, workoutDay: "2026-03-10" };
const input = (overrides: Partial<Parameters<typeof recordSessionDuration>[0]> = {}) => ({
  uid: "u1", ...identity, startedAt: STARTED, endedAt: STARTED + 2700_000, ...overrides,
});
const exercise = { ...identity, exerciseIndex: 0, completed: true };
beforeEach(resetWorkoutFirestore);

describe("recordSessionDuration with real mixed-row selection", () => {
  it("creates a day session when an exercise row exists first, without touching its sets", async () => {
    rows.set(logPath("first-exercise"), exercise);
    rows.set(logPath("first-exercise/workout_set_logs/set-1"), { repsCompleted: 10 });
    expect(await recordSessionDuration(input())).toEqual({ status: "written", durationSec: 2700 });
    expect(rows.get(logPath("first-exercise"))).toEqual(exercise);
    expect(rows.get(logPath("first-exercise/workout_set_logs/set-1"))).toEqual({ repsCompleted: 10 });
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toMatchObject({ ...identity, durationSec: 2700 });
    expect(writes[0].data).not.toHaveProperty("completed");
    expect([...rows.values()].some(isCompletedDayLog)).toBe(false);
  });

  it("updates only an existing day session and preserves its explicit completion", async () => {
    rows.set(logPath("a-exercise"), exercise);
    rows.set(logPath("z-day"), { ...identity, completed: true });
    await recordSessionDuration(input());
    expect(writes.map(w => w.path)).toEqual([logPath("z-day")]);
    expect(rows.get(logPath("a-exercise"))).toEqual(exercise);
    expect(rows.get(logPath("z-day"))).toMatchObject({ completed: true, durationSec: 2700 });
    expect(writes[0].data).not.toHaveProperty("completed");
  });

  it.each(["0", -1, {}, false])("does not upgrade malformed exerciseIndex %j", async exerciseIndex => {
    const legacy = { ...identity, exerciseIndex, completed: true };
    rows.set(logPath("legacy"), legacy);
    await recordSessionDuration(input());
    expect(rows.get(logPath("legacy"))).toEqual(legacy);
    expect(writes[0].path).not.toBe(logPath("legacy"));
    expect([...rows.values()].some(isCompletedDayLog)).toBe(false);
  });

  it("leaves unidentified legacy rows alone", async () => {
    rows.set(logPath("junk"), { planId: identity.planId, completed: true });
    await recordSessionDuration(input());
    expect(rows.get(logPath("junk"))).toEqual({ planId: identity.planId, completed: true });
  });

  it("converges concurrent first saves and repeated retries on one day record", async () => {
    await Promise.all([recordSessionDuration(input()), recordSessionDuration(input())]);
    await recordSessionDuration(input());
    expect(rows.size).toBe(1);
    expect([...rows.values()][0]).toMatchObject({ ...identity, durationSec: 2700 });
    expect(new Set(writes.map(w => w.path)).size).toBe(1);
    expect([...rows.values()].some(isCompletedDayLog)).toBe(false);
  });

  it("refuses an occupied deterministic address instead of overwriting an exercise", async () => {
    const path = logPath("day-session_plan-1_2026-03-10");
    rows.set(path, exercise);
    await expect(recordSessionDuration(input())).rejects.toThrow("identity conflict");
    expect(rows.get(path)).toEqual(exercise);
    expect(writes).toHaveLength(0);
  });

  it("rechecks identity at commit if a selected day row changes after lookup", async () => {
    rows.set(logPath("day"), identity);
    control.beforeCommit = async () => { rows.set(logPath("day"), exercise); };
    await expect(recordSessionDuration(input())).rejects.toThrow("identity conflict");
    expect(rows.get(logPath("day"))).toEqual(exercise);
    expect(writes).toHaveLength(0);
  });

  it("propagates persistence failure and can retry without duplicate corruption", async () => {
    rows.set(logPath("exercise"), exercise);
    control.rejectNext = true;
    await expect(recordSessionDuration(input())).rejects.toThrow("Persistence rejected");
    expect(writes).toHaveLength(0);
    await recordSessionDuration(input());
    expect(writes).toHaveLength(1);
    expect(rows.get(logPath("exercise"))).toEqual(exercise);
  });

  it.each([null, STARTED + 3000_000, STARTED - MAX_SESSION_SEC * 1000])(
    "does not fabricate missing or implausible duration for start %s", async startedAt => {
      expect(await recordSessionDuration(input({ startedAt }))).toEqual({ status: "skipped", reason: "no-duration" });
      expect(writes).toHaveLength(0);
    },
  );
  it.each([{ uid: "" }, { planId: "" }, { weekKey: "" }, { workoutDay: "10.03.2026" }, { dayIndex: 9 }])(
    "rejects incomplete metadata %j", async overrides => {
      expect(await recordSessionDuration(input(overrides))).toEqual({ status: "skipped", reason: "incomplete-metadata" });
      expect(writes).toHaveLength(0);
    },
  );
});
