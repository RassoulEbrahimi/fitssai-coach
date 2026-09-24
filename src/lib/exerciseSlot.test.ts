import { describe, expect, it } from "vitest";
import { exerciseSlotKey, isExpectedExercise } from "./exerciseSlot";

/* TRAINING-PLAN-V2-02: which plan slot an exercise entry is. */
describe("plan slot identity", () => {
  const heavy = { name: "Bankdrücken", sets: 3, reps: "5", rest: "150s" };

  it("tells same-name entries apart by any stored plan field", () => {
    for (const change of [{ sets: 4 }, { reps: "12" }, { rest: "60s" }, { weight: "80kg" }, { description: "Pause" }, { notes: "eng" }]) {
      expect(isExpectedExercise({ ...heavy, ...change }, heavy)).toBe(false);
    }
    expect(isExpectedExercise({ ...heavy, name: "Rudern" }, heavy)).toBe(false);
  });

  it("reads trimming, a missing field and an empty one alike, and a set count as text", () => {
    expect(exerciseSlotKey({ ...heavy, name: " Bankdrücken ", weight: "" })).toBe(exerciseSlotKey(heavy));
    expect(exerciseSlotKey({ ...heavy, sets: "3" as never })).toBe(exerciseSlotKey(heavy));
    // `completed` and other non-plan fields do not change the slot.
    expect(exerciseSlotKey({ ...heavy, completed: true })).toBe(exerciseSlotKey(heavy));
  });

  it("prefers a stored id over the fields", () => {
    expect(isExpectedExercise({ ...heavy, id: "a" }, { ...heavy, reps: "12", id: "a" })).toBe(true);
    expect(isExpectedExercise({ ...heavy, id: "a" }, { ...heavy, id: "b" })).toBe(false);
    expect(isExpectedExercise({ ...heavy, id: "a" }, heavy)).toBe(false);
  });

  it("never matches a missing entry", () => {
    expect(isExpectedExercise(undefined, heavy)).toBe(false);
    expect(isExpectedExercise(heavy, undefined)).toBe(false);
  });
});
