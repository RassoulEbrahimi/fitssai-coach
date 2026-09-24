import { describe, expect, it } from "vitest";
import {
  buildNewExercise,
  buildReplacement,
  exerciseRowKeys,
  findMove,
  isDayLockedBySession,
  moveItem,
  primaryMuscle,
  searchCatalogue,
  similarCatalogueEntries,
  validatePrescription,
} from "./trainingsplanEdit";

/* TRAINING-PLAN-V2-02: the Edit Mode's rules as data. */
describe("moving an exercise", () => {
  const list = ["A", "B", "C", "D"];

  it("moves one item and keeps the others in order, without touching the input", () => {
    expect(moveItem(list, 2, 0)).toEqual(["C", "A", "B", "D"]);
    expect(moveItem(list, 0, 3)).toEqual(["B", "C", "D", "A"]);
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(list).toEqual(["A", "B", "C", "D"]);
  });

  it("refuses an index outside the list instead of losing or duplicating an item", () => {
    expect(() => moveItem(list, 4, 0)).toThrow(RangeError);
    expect(() => moveItem(list, 0, -1)).toThrow(RangeError);
    expect(() => moveItem(list, 0.5, 1)).toThrow(RangeError);
  });

  it("keys rows by name and occurrence, so duplicates stay distinct and keys follow a move", () => {
    const keys = exerciseRowKeys([{ name: "Rudern" }, { name: "Curl" }, { name: "Rudern" }]);
    expect(keys).toEqual(["Rudern#0", "Curl#0", "Rudern#1"]);
    expect(new Set(keys).size).toBe(3);
  });

  it("reads the single move a drag produced", () => {
    const before = ["a", "b", "c", "d"];
    expect(findMove(before, ["a", "d", "b", "c"], "d")).toEqual({ from: 3, to: 1 });
    expect(findMove(before, before, "b")).toBeNull();
    expect(findMove(before, ["a", "b", "c"], "b")).toBeNull();
  });
});

describe("replacing an exercise", () => {
  it("keeps the slot's prescription and clears what belonged to the old movement", () => {
    const current = { name: "Kreuzheben", sets: 3, reps: "5", rest: "150s", weight: "100kg", notes: "Gurt", id: "x1" };
    expect(buildReplacement(current, " Latziehen ")).toEqual({
      name: "Latziehen", sets: 3, reps: "5", rest: "150s", weight: "", notes: "", id: "x1",
    });
  });

  it("adds no fields the slot did not have", () => {
    expect(buildReplacement({ name: "Rudern", sets: 3, reps: "10" }, "Latziehen")).toEqual({ name: "Latziehen", sets: 3, reps: "10" });
  });

  it("suggests only catalogue entries with the same main muscle group, from reviewed data", () => {
    const catalogue = ["Latziehen", "Klimmzüge", "Rudern", "Bankdrücken", "Unbekannte Übung"].map((name, index) => ({ id: `e${index}`, name }));
    expect(primaryMuscle("Kreuzheben")).toBe("Rücken");
    expect(similarCatalogueEntries("Kreuzheben", catalogue, ["Klimmzüge"]).map((entry) => entry.name)).toEqual(["Latziehen", "Rudern"]);
    // An exercise the repository does not know gets no guess.
    expect(similarCatalogueEntries("Unbekannte Übung", catalogue)).toEqual([]);
  });

  it("searches the catalogue by name, ignoring case", () => {
    const catalogue = [{ id: "1", name: "Latziehen" }, { id: "2", name: "Rudern" }];
    expect(searchCatalogue(catalogue, "LAT").map((entry) => entry.name)).toEqual(["Latziehen"]);
    expect(searchCatalogue(catalogue, "  ")).toHaveLength(2);
  });
});

describe("adding an exercise", () => {
  it("validates the confirmed prescription", () => {
    expect(validatePrescription({ sets: "3", reps: "10", rest: "90s" })).toBeNull();
    expect(validatePrescription({ sets: "0", reps: "10", rest: "" })).toMatch(/Sätze/);
    expect(validatePrescription({ sets: "2.5", reps: "10", rest: "" })).toMatch(/Sätze/);
    expect(validatePrescription({ sets: "3", reps: " ", rest: "" })).toMatch(/Wiederholungen/);
  });

  it("writes only confirmed values and never an undefined field", () => {
    expect(buildNewExercise("Rudern", { sets: " 4 ", reps: "8-10", rest: "" })).toEqual({ name: "Rudern", sets: 4, reps: "8-10" });
    expect(buildNewExercise("Rudern", { sets: "3", reps: "10", rest: "90s" })).toEqual({ name: "Rudern", sets: 3, reps: "10", rest: "90s" });
  });
});

describe("the running workout's day", () => {
  const week = [{ day: "Montag", exercises: [] }, { day: "Dienstag", exercises: [] }];
  const content = { "Week 1": week, "Week 2": week } as never;
  const session = { planId: "p1", weekKey: "Week 1", dayIndex: 1 };

  it("locks exactly the day the session executes", () => {
    expect(isDayLockedBySession(session, "p1", content, { weekKey: "Week 1", dayIndex: 1 })).toBe(true);
    expect(isDayLockedBySession(session, "p1", content, { weekKey: "Week 1", dayIndex: 0 })).toBe(false);
    expect(isDayLockedBySession(session, "p1", content, { weekKey: "Week 2", dayIndex: 1 })).toBe(false);
    expect(isDayLockedBySession(null, "p1", content, { weekKey: "Week 1", dayIndex: 1 })).toBe(false);
    expect(isDayLockedBySession({ ...session, planId: "other" }, "p1", content, { weekKey: "Week 1", dayIndex: 1 })).toBe(false);
  });

  it("locks the source week of a mirrored week the session runs on", () => {
    const mirrored = { "Week 1": week } as never;
    expect(isDayLockedBySession({ ...session, weekKey: "Week 3" }, "p1", mirrored, { weekKey: "Week 1", dayIndex: 1 })).toBe(true);
  });
});
