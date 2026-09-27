import { describe, it, expect } from "vitest";
import { NUTRITION_SLOT_IDS, nutritionPlanContentSchema, type NutritionSlotId } from "../../../../shared/nutrition";
import { fixtureMealIds, fixtureVertexReply } from "../../testing/fakeGoogleGenAiClient";
import type { NutritionGenerationInput } from "../generationInput";
import {
  NutritionPlanAssemblyError,
  assembleNutritionPlanContent,
  interpretNutritionProviderReply,
  nutritionProviderResponseJsonSchema,
  nutritionProviderResponseSchema,
} from "./responseContract";

/*
  NUT-12B: the provider transport shape is smaller than the canonical plan,
  and the server's assembly of it always yields canonical content. The
  structured-output JSON Schema and the strict zod schema describe the same
  shape.
*/

/** A JSON Schema node, walked by key; only what these assertions read. */
type SchemaNode = { readonly [key: string]: SchemaNode };

/** Every non-empty subset of the canonical slots, in canonical order. */
const SLOT_SETS: NutritionSlotId[][] = Array.from({ length: 2 ** NUTRITION_SLOT_IDS.length - 1 }, (_, mask) =>
  NUTRITION_SLOT_IDS.filter((_slot, index) => ((mask + 1) >> index) & 1)
);

const inputFor = (slotOrder: NutritionSlotId[], startDate = "2026-12-28"): NutritionGenerationInput => ({
  startDate,
  dayCount: 7,
  target: { kcal: 2000, proteinG: 120, carbsG: 220, fatG: 65 },
  slotOrder,
  dietaryPreference: null,
});

describe("parity: transport reply → server assembly → canonical plan content", () => {
  it.each(SLOT_SETS.map((slots) => [slots.join(",")]))("slots %s", (joined) => {
    const slots = joined.split(",") as NutritionSlotId[];
    const input = inputFor(slots);
    const reply = fixtureVertexReply(slots);

    expect(nutritionProviderResponseSchema(slots).safeParse(reply).success).toBe(true);
    const interpreted = interpretNutritionProviderReply({ input, reply, newMealId: fixtureMealIds() });
    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;
    expect(nutritionPlanContentSchema.safeParse(interpreted.content).success).toBe(true);
    expect(interpreted.content.slotOrder).toEqual(slots);
    // Across a month and a year boundary: the server's calendar, never the model's.
    expect(interpreted.content.days.map((day) => day.date)).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  it("covers every slot combination", () => {
    expect(SLOT_SETS).toHaveLength(31);
  });

  it("describes the same shape in the structured-output schema and the strict schema", () => {
    for (const slots of SLOT_SETS) {
      const json = nutritionProviderResponseJsonSchema(slots) as unknown as SchemaNode;
      const zodShape = nutritionProviderResponseSchema(slots).shape;
      expect(Object.keys(json.properties)).toEqual(Object.keys(zodShape));
      const meal = json.properties.days.items.properties.meals.items;
      expect(meal.required).toEqual(["slotId", "name", "values"]);
      expect(meal.properties.slotId.enum).toEqual(slots);
      expect(meal.properties.values.required).toEqual(["kcal", "proteinG", "carbsG", "fatG"]);
      for (const node of [json, json.properties.days.items, meal, meal.properties.values]) expect(node.additionalProperties).toBe(false);
    }
  });

  it("the transport shape names no server-owned field", () => {
    const text = JSON.stringify(nutritionProviderResponseJsonSchema([...NUTRITION_SLOT_IDS]));
    for (const field of ["mealId", "planId", "date", "startDate", "endDate", "slotOrder", "targetVersionId", "source", "generationRequestId", "validation", "createdAt", "lifecycle", "requestId"]) {
      expect(text, field).not.toContain(`"${field}"`);
    }
  });
});

describe("assembly is the server's", () => {
  it("refuses content it cannot vouch for: a meal id generator that repeats itself", () => {
    const slots: NutritionSlotId[] = ["breakfast", "dinner"];
    const input = inputFor(slots);
    const response = nutritionProviderResponseSchema(slots).parse(fixtureVertexReply(slots));
    expect(() => assembleNutritionPlanContent({ input, response, newMealId: () => "same-id" })).toThrow(NutritionPlanAssemblyError);
    expect(() => assembleNutritionPlanContent({ input, response, newMealId: () => "not a valid id!" })).toThrow(NutritionPlanAssemblyError);
  });

  it("copies the four values field by field and trims names", () => {
    const slots: NutritionSlotId[] = ["lunch"];
    const reply = fixtureVertexReply(slots, (slotId) => ({ slotId, name: "  Käsespätzle  ", values: { kcal: 650.5, proteinG: 24, carbsG: 70, fatG: 28.25 } }));
    const interpreted = interpretNutritionProviderReply({ input: inputFor(slots), reply, newMealId: fixtureMealIds() });
    expect(interpreted.ok && interpreted.content.days[0].meals[0]).toEqual({
      mealId: "meal-1",
      slotId: "lunch",
      name: "Käsespätzle",
      values: { kcal: 650.5, proteinG: 24, carbsG: 70, fatG: 28.25 },
    });
  });

  it("reports issues without quoting the reply's own keys or values", () => {
    const interpreted = interpretNutritionProviderReply({
      input: inputFor(["dinner"]),
      reply: { days: [{ meals: [{ slotId: "leaked-slot-value", name: 1, values: {}, "leaked-key-name": true }] }] },
      newMealId: fixtureMealIds(),
    });
    expect(interpreted.ok).toBe(false);
    const text = JSON.stringify(interpreted);
    expect(text).not.toContain("leaked-slot-value");
    expect(text).not.toContain("leaked-key-name");
  });
});
