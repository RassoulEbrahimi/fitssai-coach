import { describe, it, expect } from "vitest";
import {
  EXERCISE_CATEGORIES,
  classifyExercise,
  isInCategory,
  type ClassifiableExercise,
} from "./exerciseCategories";

/** A representative slice of the catalogue, using the shapes Firestore returns. */
const CATALOGUE: ClassifiableExercise[] = [
  { name: "Bankdrücken", target_muscle: "Chest", category: "Grundübung" },
  { name: "Schrägbankdrücken", target_muscle: "Chest", category: "Grundübung" },
  { name: "Liegestütze", target_muscle: "Chest", category: "Eigengewicht" },
  { name: "Butterfly", target_muscle: "Chest", category: "Isolation" },
  { name: "Schulterdrücken", target_muscle: "Shoulders", category: "Grundübung" },
  { name: "Seitheben", target_muscle: "Shoulders", category: "Isolation" },
  { name: "Trizepsdrücken", target_muscle: "Triceps", category: "Isolation" },
  { name: "Dips", target_muscle: "Triceps", category: "Eigengewicht" },
  { name: "Klimmzüge", target_muscle: "Back", category: "Eigengewicht" },
  { name: "Latzug", target_muscle: "Back", category: "Maschine" },
  { name: "Rudern", target_muscle: "Back", category: "Grundübung" },
  { name: "Überzüge", target_muscle: "Back", category: "Isolation" },
  { name: "Bizepscurls", target_muscle: "Biceps", category: "Isolation" },
  { name: "Hammercurls", target_muscle: "Biceps", category: "Isolation" },
  { name: "Kniebeuge", target_muscle: "Legs", category: "Grundübung" },
  { name: "Beinpresse", target_muscle: "Legs", category: "Maschine" },
  { name: "Ausfallschritte", target_muscle: "Legs", category: "Eigengewicht" },
  { name: "Beinstrecker", target_muscle: "Legs", category: "Maschine" },
  { name: "Wadenheben", target_muscle: "Legs", category: "Isolation" },
  { name: "Beinbeuger", target_muscle: "Legs", category: "Maschine" },
  { name: "Kreuzheben", target_muscle: "Legs", category: "Grundübung" },
  { name: "Rumänisches Kreuzheben", target_muscle: "Legs", category: "Grundübung" },
  { name: "Hip Thrust", target_muscle: "Legs", category: "Grundübung" },
  { name: "Crunches", target_muscle: "Abs", category: "Eigengewicht" },
  { name: "Plank", target_muscle: "Abs", category: "Eigengewicht" },
  { name: "Beinheben", target_muscle: "Abs", category: "Eigengewicht" },
  { name: "Russian Twist", target_muscle: "Abs", category: "Eigengewicht" },
  { name: "Rückenstrecker", target_muscle: "Abs", category: "Eigengewicht" },
];

describe("exercise categories", () => {
  it("exposes exactly Push and Pull, in that order", () => {
    expect(EXERCISE_CATEGORIES.map((c) => c.id)).toEqual(["push", "pull"]);
    expect(EXERCISE_CATEGORIES.map((c) => c.label)).toEqual(["Push", "Pull"]);
  });
});

describe("classifyExercise — push", () => {
  it.each([
    "Bankdrücken",
    "Schrägbankdrücken",
    "Liegestütze",
    "Butterfly",
    "Schulterdrücken",
    "Trizepsdrücken",
    "Dips",
    "Push-ups",
    "Overhead Press",
  ])("classifies %s as push", (name) => {
    expect(classifyExercise({ name })).toBe("push");
  });

  it("puts quad-dominant and calf leg work in push", () => {
    for (const name of [
      "Kniebeuge",
      "Beinpresse",
      "Ausfallschritte",
      "Beinstrecker",
      "Wadenheben",
      "Bulgarian Split Squat",
    ]) {
      expect(classifyExercise({ name, target_muscle: "Legs" })).toBe("push");
    }
  });

  it("puts anterior core in push", () => {
    for (const name of ["Crunches", "Plank", "Beinheben", "Russian Twist", "Sit-ups"]) {
      expect(classifyExercise({ name, target_muscle: "Abs" })).toBe("push");
    }
  });
});

describe("classifyExercise — pull", () => {
  it.each([
    "Klimmzüge",
    "Latzug",
    "Rudern",
    "Bizepscurls",
    "Hammercurls",
    "Face Pull",
    "Reverse Butterfly",
    "Pull-up",
    "Barbell Row",
  ])("classifies %s as pull", (name) => {
    expect(classifyExercise({ name })).toBe("pull");
  });

  it("puts hinge, hamstring and glute work in pull", () => {
    for (const name of [
      "Kreuzheben",
      "Rumänisches Kreuzheben",
      "Beinbeuger",
      "Leg Curl",
      "Hip Thrust",
      "Good Morning",
      "Gesäßbrücke",
    ]) {
      expect(classifyExercise({ name, target_muscle: "Legs" })).toBe("pull");
    }
  });

  it("puts posterior core in pull", () => {
    for (const name of ["Rückenstrecker", "Back Extension", "Superman"]) {
      expect(classifyExercise({ name, target_muscle: "Abs" })).toBe("pull");
    }
  });
});

describe("totality — no exercise can be lost", () => {
  it("gives every catalogue entry exactly one category", () => {
    for (const exercise of CATALOGUE) {
      const category = classifyExercise(exercise);
      expect(["push", "pull"]).toContain(category);
      // Exactly one: in one filter, not the other.
      expect(isInCategory(exercise, "push")).toBe(category === "push");
      expect(isInCategory(exercise, "pull")).toBe(category === "pull");
    }
  });

  it("covers the whole catalogue across the two filters", () => {
    const push = CATALOGUE.filter((e) => isInCategory(e, "push"));
    const pull = CATALOGUE.filter((e) => isInCategory(e, "pull"));
    expect(push.length + pull.length).toBe(CATALOGUE.length);
    expect(push.length).toBeGreaterThan(0);
    expect(pull.length).toBeGreaterThan(0);
  });

  it("still classifies an exercise with an unknown muscle group", () => {
    // Regression: the old tabs filtered on a fixed muscle list, so anything
    // outside it was reachable only through search.
    expect(classifyExercise({ name: "Farmers Walk", target_muscle: "Grip" })).toBe("push");
    expect(classifyExercise({ name: "Etwas Unbekanntes", target_muscle: "Mystery" })).toBe("push");
  });

  it("never returns undefined for degenerate input", () => {
    for (const input of [
      {},
      { name: "" },
      { name: null, target_muscle: null, category: null },
      { name: "   " },
      { name: undefined, target_muscle: "Chest" },
    ] as ClassifiableExercise[]) {
      expect(["push", "pull"]).toContain(classifyExercise(input));
    }
  });

  it("falls back on the muscle group when the name says nothing", () => {
    expect(classifyExercise({ name: "Maschine A", target_muscle: "Chest" })).toBe("push");
    expect(classifyExercise({ name: "Maschine B", target_muscle: "Back" })).toBe("pull");
    expect(classifyExercise({ name: "Maschine C", target_muscle: "Biceps" })).toBe("pull");
  });
});
