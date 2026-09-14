import { describe, it, expect } from "vitest";
import {
  applySetLogChangeToState,
  completionOnlySetFields,
  InvalidSetPerformanceError,
  isRecordedReps,
  isRecordedWeightKg,
  planSetLogWrite,
  readActualPerformance,
  readSetCompletion,
  readSetLogState,
} from "./setPerformance";

const NOW = "ts-now";
const now = () => NOW;

describe("readActualPerformance", () => {
  it("reads a completion-only set as carrying no reps and no load", () => {
    expect(readActualPerformance({ setNumber: 1, ...completionOnlySetFields() } as never)).toEqual({
      source: "completion-only",
      reps: null,
      weightKg: null,
    });
  });

  it("treats legacy numbers without a marker as unverified, not measured", () => {
    // What the old checkbox wrote: the prescription, copied.
    expect(readActualPerformance({ repsCompleted: 10, weightUsed: 60 })).toEqual({
      source: "unverified",
      reps: null,
      weightKg: null,
    });
  });

  it("does not trust an unknown marker either", () => {
    expect(readActualPerformance({ performanceSource: "plan", repsCompleted: 10, weightUsed: 60 }).reps).toBeNull();
  });

  it("does not trust numbers on a completion-only set", () => {
    const actual = readActualPerformance({ performanceSource: "completion-only", repsCompleted: 10, weightUsed: 60 });
    expect(actual.reps).toBeNull();
    expect(actual.weightKg).toBeNull();
  });

  it("keeps explicitly recorded performance", () => {
    expect(readActualPerformance({ performanceSource: "user-recorded", repsCompleted: 10, weightUsed: 57.5 })).toEqual({
      source: "user-recorded",
      reps: 10,
      weightKg: 57.5,
    });
  });

  it("reports a recorded set without a usable load as unloaded, never 0 kg", () => {
    const actual = readActualPerformance({ performanceSource: "user-recorded", repsCompleted: 8, weightUsed: 0 });
    expect(actual.reps).toBe(8);
    expect(actual.weightKg).toBeNull();
  });

  it("rejects non-numeric recorded values", () => {
    const actual = readActualPerformance({ performanceSource: "user-recorded", repsCompleted: "10", weightUsed: Number.NaN });
    expect(actual).toEqual({ source: "user-recorded", reps: null, weightKg: null });
  });
});

describe("readSetCompletion — the compatibility rule", () => {
  it("keeps every older shape of set document completed, with no backfill", () => {
    // Prescription-copying Firebase writer, completion-only marker, bare document.
    expect(readSetCompletion({ repsCompleted: 10, weightUsed: 60, completedAt: "ts" })).toBe(true);
    expect(readSetCompletion({ performanceSource: "completion-only", completedAt: "ts" })).toBe(true);
    expect(readSetCompletion({})).toBe(true);
  });

  it("reads a performance-only document as open", () => {
    expect(readSetCompletion({ completed: false, performanceSource: "user-recorded", repsCompleted: 8 })).toBe(false);
  });

  it("reads a completed document with recorded performance as completed", () => {
    expect(readSetCompletion({ completed: true, performanceSource: "user-recorded", repsCompleted: 8 })).toBe(true);
  });

  it("does not let an unmarked `completed: false` hide a ticked set", () => {
    expect(readSetCompletion({ completed: false, repsCompleted: 10, weightUsed: 60 })).toBe(true);
    expect(readSetCompletion({ completed: "false", performanceSource: "user-recorded" })).toBe(true);
  });
});

describe("planSetLogWrite", () => {
  const recordedOpen = { setNumber: 1, completed: false, performanceSource: "user-recorded", repsCompleted: 10, weightUsed: 52.5 };
  const recordedDone = { ...recordedOpen, completed: true, completedAt: "ts-then" };

  it("records reps without completing the set", () => {
    expect(planSetLogWrite(undefined, 1, { kind: "performance", reps: 12 }, now)).toEqual({
      type: "write",
      data: { setNumber: 1, completed: false, performanceSource: "user-recorded", repsCompleted: 12 },
    });
  });

  it("records weight only, as a number of kilograms", () => {
    expect(planSetLogWrite(undefined, 2, { kind: "performance", weightKg: 52.5 }, now)).toEqual({
      type: "write",
      data: { setNumber: 2, completed: false, performanceSource: "user-recorded", weightUsed: 52.5 },
    });
  });

  it("completes a set without copying anything into performance", () => {
    expect(planSetLogWrite(undefined, 1, { kind: "completion", completed: true }, now)).toEqual({
      type: "write",
      data: { setNumber: 1, completed: true, completedAt: NOW, performanceSource: "completion-only" },
    });
  });

  it("keeps recorded performance when the set is completed", () => {
    expect(planSetLogWrite(recordedOpen, 1, { kind: "completion", completed: true }, now)).toEqual({
      type: "write",
      data: { ...recordedOpen, completed: true, completedAt: NOW },
    });
  });

  it("keeps recorded performance when the set is un-ticked", () => {
    expect(planSetLogWrite(recordedDone, 1, { kind: "completion", completed: false }, now)).toEqual({
      type: "write",
      data: recordedOpen,
    });
  });

  it("changes one value without touching the other, or the completion time", () => {
    expect(planSetLogWrite(recordedDone, 1, { kind: "performance", reps: 12 }, now)).toEqual({
      type: "write",
      data: { ...recordedDone, repsCompleted: 12 },
    });
  });

  it("returns a completed set to completion-only when both values are cleared", () => {
    expect(planSetLogWrite(recordedDone, 1, { kind: "performance", reps: null, weightKg: null }, now)).toEqual({
      type: "write",
      data: { setNumber: 1, completed: true, completedAt: "ts-then", performanceSource: "completion-only" },
    });
  });

  it("removes an open set once nothing is recorded on it", () => {
    expect(planSetLogWrite(recordedOpen, 1, { kind: "performance", reps: null, weightKg: null }, now)).toEqual({ type: "delete" });
  });

  it("keeps the remaining value when only one is cleared", () => {
    expect(planSetLogWrite(recordedOpen, 1, { kind: "performance", reps: null }, now)).toEqual({
      type: "write",
      data: { setNumber: 1, completed: false, performanceSource: "user-recorded", weightUsed: 52.5 },
    });
  });

  it("writes nothing for a change that changes nothing", () => {
    expect(planSetLogWrite(recordedDone, 1, { kind: "completion", completed: true }, now)).toEqual({ type: "unchanged" });
    expect(planSetLogWrite(recordedOpen, 1, { kind: "performance", reps: 10 }, now)).toEqual({ type: "unchanged" });
    expect(planSetLogWrite(undefined, 1, { kind: "completion", completed: false }, now)).toEqual({ type: "unchanged" });
    expect(planSetLogWrite(undefined, 1, { kind: "performance", reps: null }, now)).toEqual({ type: "unchanged" });
  });

  it("leaves a legacy set with copied numbers alone unless the user changes it", () => {
    const legacy = { setNumber: 1, repsCompleted: 10, weightUsed: 60, completedAt: "ts-old" };
    expect(planSetLogWrite(legacy, 1, { kind: "completion", completed: true }, now)).toEqual({ type: "unchanged" });
    expect(planSetLogWrite(legacy, 1, { kind: "performance", weightKg: null }, now)).toEqual({ type: "unchanged" });
    // Un-ticking removes it, exactly as before; the copied numbers are never revived.
    expect(planSetLogWrite(legacy, 1, { kind: "completion", completed: false }, now)).toEqual({ type: "delete" });
    // What the user records replaces the copies, and only that is stored.
    expect(planSetLogWrite(legacy, 1, { kind: "performance", reps: 8 }, now)).toEqual({
      type: "write",
      data: { setNumber: 1, completed: true, completedAt: "ts-old", performanceSource: "user-recorded", repsCompleted: 8 },
    });
  });

  it.each([
    ["negative reps", { reps: -1 }],
    ["fractional reps", { reps: 8.5 }],
    ["zero weight", { weightKg: 0 }],
    ["negative weight", { weightKg: -2.5 }],
    ["NaN", { weightKg: Number.NaN }],
    ["Infinity", { reps: Number.POSITIVE_INFINITY }],
    ["too many decimals", { weightKg: 52.555 }],
    ["no values at all", {}],
  ])("refuses %s", (_label, values) => {
    expect(() => planSetLogWrite(undefined, 1, { kind: "performance", ...values }, now)).toThrow(InvalidSetPerformanceError);
  });
});

describe("recorded value bounds", () => {
  it("accepts whole reps from 0 to 999", () => {
    expect([0, 1, 999].every(isRecordedReps)).toBe(true);
    expect([-1, 1000, 1.5, Number.NaN, "8", null].some(isRecordedReps)).toBe(false);
  });

  it("accepts positive kilograms with up to two decimals, up to 1000", () => {
    expect([0.5, 52.5, 52.25, 1000].every(isRecordedWeightKg)).toBe(true);
    expect([0, -1, 1000.01, 52.555, Number.POSITIVE_INFINITY, "52.5"].some(isRecordedWeightKg)).toBe(false);
  });
});

describe("applySetLogChangeToState", () => {
  it("applies the document rules to the optimistic view", () => {
    const open = applySetLogChangeToState(undefined, 1, { kind: "performance", weightKg: 52.5 }, now);
    expect(open).toEqual({ completed: false, actual: { source: "user-recorded", reps: null, weightKg: 52.5 } });

    const done = applySetLogChangeToState(open, 1, { kind: "completion", completed: true }, now);
    expect(done).toEqual({ completed: true, actual: { source: "user-recorded", reps: null, weightKg: 52.5 }, completedAt: NOW });

    expect(applySetLogChangeToState(done, 1, { kind: "completion", completed: false }, now))
      .toEqual({ completed: false, actual: { source: "user-recorded", reps: null, weightKg: 52.5 } });
  });

  it("keeps a legacy set unverified and returns it unchanged when nothing changes", () => {
    const legacy = readSetLogState({ repsCompleted: 10, weightUsed: 60 });
    expect(legacy).toEqual({ completed: true, actual: { source: "unverified", reps: null, weightKg: null } });
    expect(applySetLogChangeToState(legacy, 1, { kind: "completion", completed: true }, now)).toBe(legacy);
    expect(applySetLogChangeToState(legacy, 1, { kind: "completion", completed: false }, now)).toBeUndefined();
  });
});
