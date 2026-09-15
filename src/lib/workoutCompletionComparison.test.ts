import { describe, expect, it, vi } from "vitest";
import { buildWorkoutCompletionComparison } from "./workoutCompletionComparison";
import { buildRecordedPerformance } from "./workoutExecution";
import { readActualPerformance } from "./setPerformance";
import { readPreviousSets } from "./previousPerformance";

const exercise = { name: "Bankdrücken", sets: 3, reps: 99, weight: "999 kg" };
const compare = (today: { reps: number | null; weightKg: number | null }, previous: typeof today) =>
  buildWorkoutCompletionComparison(
    [{ exerciseIndex: 0, name: exercise.name, sets: [{ setNumber: 2, completed: false, ...today }] }],
    () => ({ workoutDay: "2026-09-08", sets: { 2: previous } }),
  );

describe("completion comparison: exact facts only", () => {
  it.each([
    [12, 10, 2], [8, 10, -2], [10, 10, 0], [0, 10, -10],
  ])("compares reps %s with %s as %s", (today, previous, delta) => {
    expect(compare({ reps: today, weightKg: null }, { reps: previous, weightKg: 50 })[0].sets[0].delta)
      .toEqual({ reps: delta, weightKg: null });
  });

  it.each([
    [52.5, 50, 2.5], [45, 50, -5], [50, 50, 0], [52.55, 52.5, 0.05], [52.5, 52.55, -0.05],
  ])("compares kg %s with %s as %s without floating point noise", (today, previous, delta) => {
    expect(compare({ reps: null, weightKg: today }, { reps: 10, weightKg: previous })[0].sets[0].delta)
      .toEqual({ reps: null, weightKg: delta });
  });

  it("keeps both factual deltas for mixed change, including an open set", () => {
    expect(compare({ reps: 8, weightKg: 55 }, { reps: 10, weightKg: 50 })).toEqual([{
      exerciseIndex: 0, name: "Bankdrücken", previousWorkoutDay: "2026-09-08",
      sets: [{ setNumber: 2, today: { setNumber: 2, completed: false, reps: 8, weightKg: 55 },
        previous: { reps: 10, weightKg: 50 }, delta: { reps: -2, weightKg: 5 } }],
    }]);
  });

  it("omits disjoint metrics and empty current values", () => {
    expect(compare({ reps: 10, weightKg: null }, { reps: null, weightKg: 50 })).toEqual([]);
    expect(compare({ reps: null, weightKg: null }, { reps: 10, weightKg: 50 })).toEqual([]);
  });

  it("matches set numbers, never positions, and leaves all inputs untouched", () => {
    const recorded = [{ exerciseIndex: 3, name: "Bankdrücken", sets: [
      { setNumber: 1, reps: 12, weightKg: null, completed: true },
      { setNumber: 3, reps: 6, weightKg: null, completed: false },
    ] }];
    const previous = { workoutDay: "2026-09-08", sets: { 2: { reps: 8, weightKg: null }, 3: { reps: 10, weightKg: null } } };
    const before = structuredClone({ recorded, previous });
    const reader = vi.fn(() => previous);
    const result = buildWorkoutCompletionComparison(recorded, reader);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith(3);
    expect(result[0].sets).toHaveLength(1);
    expect(result[0].sets[0]).toMatchObject({ setNumber: 3, delta: { reps: -4, weightKg: null } });
    expect({ recorded, previous }).toEqual(before);
    expect(buildWorkoutCompletionComparison(recorded, () => undefined)).toEqual([]);
  });

  it("consumes only explicit actual and trusted history, never ticks, legacy numbers or prescription", () => {
    const stored = [
      { performanceSource: "completion-only", repsCompleted: 99, weightUsed: 999 },
      { repsCompleted: 99, weightUsed: 999 },
      { performanceSource: "user-recorded", repsCompleted: 8 },
    ];
    const recorded = buildRecordedPerformance([exercise], () => true, (_, set) => readActualPerformance(stored[set - 1]));
    const sets = readPreviousSets([{ id: "last", docs: [
      { id: "1", data: { setNumber: 1, performanceSource: "user-recorded", repsCompleted: 10 } },
      { id: "2", data: { setNumber: 2, performanceSource: "user-recorded", repsCompleted: 10 } },
      { id: "3", data: { setNumber: 3, repsCompleted: 10, weightUsed: 50 } },
    ] }])!;
    expect(recorded[0].sets).toEqual([{ setNumber: 3, reps: 8, weightKg: null, completed: true }]);
    expect(buildWorkoutCompletionComparison(recorded, () => ({ workoutDay: "2026-09-08", sets }))).toEqual([]);
  });
});
