import { describe, it, expect } from "vitest";
import { completionOnlySetFields, readActualPerformance } from "./setPerformance";

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

  it("keeps explicitly recorded performance for a future input", () => {
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
