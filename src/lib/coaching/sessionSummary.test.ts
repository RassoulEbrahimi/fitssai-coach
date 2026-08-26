import { describe, it, expect } from "vitest";
import { summariseSession } from "./sessionSummary";

const bench = {
  name: "Bankdrücken",
  prescribedSets: 3,
  sets: [
    { setNumber: 1, repsCompleted: 10, weightUsed: 60 },
    { setNumber: 2, repsCompleted: 10, weightUsed: 60 },
    { setNumber: 3, repsCompleted: 10, weightUsed: 60 },
  ],
};

describe("summariseSession", () => {
  it("aggregates what was actually logged", () => {
    const summary = summariseSession({ exercises: [bench], durationSec: 2700 });

    expect(summary.completedSets).toBe(3);
    expect(summary.totalReps).toBe(30);
    expect(summary.prescribedSets).toBe(3);
    expect(summary.isFullyCompleted).toBe(true);
    expect(summary.measuredDurationSec).toBe(2700);
  });

  it("reports an unfinished session as unfinished", () => {
    const summary = summariseSession({
      exercises: [{ ...bench, sets: bench.sets.slice(0, 1) }],
    });

    expect(summary.completedSets).toBe(1);
    expect(summary.isFullyCompleted).toBe(false);
  });

  it("returns null duration rather than estimating from exercise count", () => {
    const summary = summariseSession({ exercises: [bench] });

    expect(summary.measuredDurationSec).toBeNull();
    expect(summary.measuredDurationSec).not.toBe(0);
  });

  it("rejects an implausible duration instead of storing it", () => {
    const summary = summariseSession({ exercises: [bench], durationSec: 20 * 60 * 60 });

    expect(summary.measuredDurationSec).toBeNull();
  });

  it("withholds a prescribed total when any exercise declared none", () => {
    // Summing a partial set of prescriptions would flatter completion.
    const summary = summariseSession({
      exercises: [bench, { name: "Klimmzüge", sets: [{ setNumber: 1, repsCompleted: 8 }] }],
    });

    expect(summary.prescribedSets).toBeNull();
    expect(summary.isFullyCompleted).toBe(false);
  });

  it("produces progression facts only when a comparable session exists", () => {
    const heavier = {
      ...bench,
      sets: bench.sets.map((set) => ({ ...set, weightUsed: 65 })),
    };

    expect(summariseSession({ exercises: [heavier] }).progression).toEqual([]);
    expect(
      summariseSession({ exercises: [heavier], previousExercises: [bench] }).progression
    ).toMatchObject([{ kind: "weight-increase", exerciseName: "Bankdrücken" }]);
  });

  it("handles an empty session without throwing", () => {
    const summary = summariseSession({ exercises: [] });

    expect(summary.completedSets).toBe(0);
    expect(summary.isFullyCompleted).toBe(false);
    expect(summary.prescribedSets).toBeNull();
  });

  it("does not mutate its input", () => {
    const input = { exercises: [bench], durationSec: 2700 };
    const before = JSON.stringify(input);

    summariseSession(input);

    expect(JSON.stringify(input)).toBe(before);
  });
});
