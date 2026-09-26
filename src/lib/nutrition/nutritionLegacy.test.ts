import { describe, it, expect } from "vitest";
import {
  countLegacyNutritionMeals,
  readLegacyNutritionBuckets,
  toLegacyNutritionPlan,
} from "./legacy";

/*
  NUT-04. The legacy `nutrition_plans` schema was never inventoried, so the
  adapter takes unknown input, keeps what the compatibility display can show,
  ignores the rest and never throws.
*/

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

describe("legacy Nutrition adapter", () => {
  it("keeps a known legacy meal as display text", () => {
    const plan = toLegacyNutritionPlan("p1", {
      content: { breakfast: [{ meal: "Porridge", description: "Haferflocken mit Beeren", calories: 420 }] },
    });

    expect(plan).toEqual({
      id: "p1",
      buckets: [
        {
          key: "breakfast",
          meals: [{ meal: "Porridge", description: "Haferflocken mit Beeren", caloriesText: "420" }],
        },
      ],
    });
  });

  it("tolerates arbitrary bucket names and keeps them untouched, in stored order", () => {
    const plan = toLegacyNutritionPlan("p1", {
      content: {
        Montag: [{ meal: "A", description: "a" }],
        "  Pre-Workout ": [{ meal: "B", description: "b" }],
        breakfast: [{ meal: "C", description: "c" }],
      },
    });

    expect(plan.buckets.map((b) => b.key)).toEqual(["Montag", "  Pre-Workout ", "breakfast"]);
  });

  it("ignores a malformed bucket", () => {
    const buckets = readLegacyNutritionBuckets({
      breakfast: "Porridge",
      lunch: { meal: "Salat" },
      dinner: null,
      snack: 42,
      empty: [],
      valid: [{ meal: "Suppe", description: "" }],
    });

    expect(buckets).toEqual([{ key: "valid", meals: [{ meal: "Suppe", description: "", caloriesText: null }] }]);
  });

  it("ignores a malformed meal item", () => {
    const buckets = readLegacyNutritionBuckets({
      lunch: [
        null,
        undefined,
        "Salat",
        7,
        ["Salat"],
        {},
        { calories: 300 },
        { meal: { name: "Salat" }, description: ["grün"] },
        { meal: "   ", description: "" },
        { meal: "Salat", description: "grün", calories: 300 },
      ],
    });

    expect(buckets).toEqual([
      { key: "lunch", meals: [{ meal: "Salat", description: "grün", caloriesText: "300" }] },
    ]);
  });

  it("does not throw for missing content", () => {
    expect(toLegacyNutritionPlan("p1", {})).toEqual({ id: "p1", buckets: [] });
    expect(toLegacyNutritionPlan("p1", { createdAt: "2024-01-01" })).toEqual({ id: "p1", buckets: [] });
    expect(toLegacyNutritionPlan("p1", undefined)).toEqual({ id: "p1", buckets: [] });
  });

  it("does not throw for null content or a non-object document", () => {
    for (const data of [{ content: null }, { content: "text" }, { content: [[{ meal: "A" }]] }, null, 3, "doc"]) {
      expect(toLegacyNutritionPlan("p1", data)).toEqual({ id: "p1", buckets: [] });
    }
  });

  it("never turns an unexpected calorie type into a number", () => {
    const calories = [{ kcal: 400 }, [400], true, null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "", "   "];
    const buckets = readLegacyNutritionBuckets({
      lunch: calories.map((value, i) => ({ meal: `M${i}`, description: "", calories: value })),
    });

    for (const meal of buckets[0].meals) {
      expect(meal.caloriesText).toBeNull();
    }
  });

  it("keeps a displayable calorie value as text, never as a number", () => {
    const [bucket] = readLegacyNutritionBuckets({
      lunch: [
        { meal: "A", description: "", calories: 420 },
        { meal: "B", description: "", calories: " 350-400 " },
        { meal: "C", description: "", calories: "ca. 500" },
      ],
    });

    expect(bucket.meals.map((m) => m.caloriesText)).toEqual(["420", "350-400", "ca. 500"]);
    for (const meal of bucket.meals) {
      expect(typeof meal.caloriesText).toBe("string");
    }
  });

  it("does not mutate the raw source object", () => {
    const raw = {
      content: {
        breakfast: [{ meal: "Porridge", description: "Haferflocken", calories: 420 }, null, "x"],
        lunch: "not a list",
      },
      createdAt: "2024-01-01",
    };
    const snapshot = structuredClone(raw);
    deepFreeze(raw);

    const plan = toLegacyNutritionPlan("p1", raw);

    expect(raw).toEqual(snapshot);
    // The result shares no object with the stored document.
    expect(plan.buckets[0].meals[0]).not.toBe(raw.content.breakfast[0]);
  });

  it("adds no V2 identity, slot, schema version or totals", () => {
    const plan = toLegacyNutritionPlan("p1", {
      content: { breakfast: [{ meal: "Porridge", description: "Hafer", calories: 420, protein: 20 }] },
    });

    expect(Object.keys(plan).sort()).toEqual(["buckets", "id"]);
    expect(Object.keys(plan.buckets[0]).sort()).toEqual(["key", "meals"]);
    expect(Object.keys(plan.buckets[0].meals[0]).sort()).toEqual(["caloriesText", "description", "meal"]);
    expect(JSON.stringify(plan)).not.toMatch(/schemaVersion|slotId|mealId|totals|kcal|protein/);
  });

  it("counts displayable meals only", () => {
    const plan = toLegacyNutritionPlan("p1", {
      content: {
        breakfast: [{ meal: "A", description: "" }, null],
        lunch: "x",
        dinner: [{ meal: "B", description: "" }, { meal: "C", description: "" }],
      },
    });

    expect(countLegacyNutritionMeals(plan)).toBe(3);
  });
});
