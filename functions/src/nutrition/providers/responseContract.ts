import { z } from "zod";
import {
  NUTRITION_PLAN_DAY_COUNT,
  addNutritionDays,
  nutritionPlanContentSchema,
  nutritionValuesSchema,
  type NutritionPlanContent,
  type NutritionSlotId,
} from "../../../../shared/nutrition";
import type { NutritionGenerationInput } from "../generationInput";

/**
 * What the Nutrition model may answer, and how the server turns it into plan
 * content (NUT-12B).
 *
 * The model owns meal CONTENT only — for each of the seven days, one meal per
 * requested slot: the slot it fills, a display name and its four nutrient
 * values:
 *
 *   { days: [ { meals: [ { slotId, name, values: { kcal, proteinG, carbsG, fatG } } ] } ] }
 *
 * Everything else is the server's and is never read from a reply: the start
 * and end dates, each day's date, the slot order, every meal id, and every
 * plan, request, target, validation, source, lifecycle or timestamp field.
 * The transport schema is strict, so a reply that carries any of them — a
 * `mealId`, a `planId`, a `uid`, a `date` — is refused, not stripped, before
 * anything is assembled.
 *
 * The shared plan-content schema stays authoritative: assembled content is
 * parsed by it here, and again by the candidate step, before a policy sees it.
 */

/** One issue as a repair is told it: a path in the reply and a message that quotes nothing of it. */
export interface NutritionProviderIssue {
  path: string;
  message: string;
}

/** The requested slots as a zod enum. The generation input guarantees at least one. */
const slotEnum = (slotOrder: readonly NutritionSlotId[]) => z.enum([...slotOrder] as [NutritionSlotId, ...NutritionSlotId[]]);

/**
 * The strict transport schema for one request: exactly seven days, exactly one
 * meal for each requested slot per day (any order), a non-empty name and four
 * non-negative finite values — and no other field anywhere.
 */
export const nutritionProviderResponseSchema = (slotOrder: readonly NutritionSlotId[]) => {
  const meal = z
    .object({
      slotId: slotEnum(slotOrder),
      name: z.string().trim().min(1, "must not be empty"),
      values: nutritionValuesSchema,
    })
    .strict();

  const day = z
    .object({ meals: z.array(meal) })
    .strict()
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      value.meals.forEach((entry, index) => {
        if (seen.has(entry.slotId)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["meals", index, "slotId"], message: `slot ${entry.slotId} is planned twice` });
        }
        seen.add(entry.slotId);
      });
      for (const slotId of slotOrder) {
        if (!seen.has(slotId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["meals"], message: `slot ${slotId} has no meal` });
      }
    });

  return z
    .object({
      days: z.array(day).length(NUTRITION_PLAN_DAY_COUNT, `exactly ${NUTRITION_PLAN_DAY_COUNT} days`),
    })
    .strict();
};

export type NutritionProviderResponse = z.infer<ReturnType<typeof nutritionProviderResponseSchema>>;

/**
 * The same shape as a JSON Schema, for Gemini's structured output
 * (`responseJsonSchema`). A transport aid only — the model is steered, not
 * trusted: the strict zod schema above decides.
 */
export const nutritionProviderResponseJsonSchema = (slotOrder: readonly NutritionSlotId[]): Record<string, unknown> => {
  const quantity = { type: "number", minimum: 0 };
  const values = {
    type: "object",
    properties: { kcal: quantity, proteinG: quantity, carbsG: quantity, fatG: quantity },
    required: ["kcal", "proteinG", "carbsG", "fatG"],
    additionalProperties: false,
    propertyOrdering: ["kcal", "proteinG", "carbsG", "fatG"],
  };
  const meal = {
    type: "object",
    properties: {
      slotId: { type: "string", enum: [...slotOrder] },
      name: { type: "string" },
      values,
    },
    required: ["slotId", "name", "values"],
    additionalProperties: false,
    propertyOrdering: ["slotId", "name", "values"],
  };
  const day = {
    type: "object",
    properties: {
      meals: { type: "array", items: meal, minItems: slotOrder.length, maxItems: slotOrder.length },
    },
    required: ["meals"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      days: { type: "array", items: day, minItems: NUTRITION_PLAN_DAY_COUNT, maxItems: NUTRITION_PLAN_DAY_COUNT },
    },
    required: ["days"],
    additionalProperties: false,
  };
};

/** A zod issue as a repair may be told it: never the reply's own keys or values. */
const normaliseIssue = (issue: z.ZodIssue): NutritionProviderIssue => {
  const path = issue.path.join(".");
  switch (issue.code) {
    case z.ZodIssueCode.unrecognized_keys:
      return { path, message: "must not contain any other field" };
    case z.ZodIssueCode.invalid_enum_value:
      return { path, message: `must be one of ${issue.options.join(", ")}` };
    case z.ZodIssueCode.invalid_type:
      return { path, message: `must be ${issue.expected}` };
    default:
      return { path, message: issue.message };
  }
};

/** Why an assembly failed on the server's side — never the model's fault, and not repairable. */
export class NutritionPlanAssemblyError extends Error {
  constructor(detail: string) {
    super(`The plan content cannot be assembled: ${detail}`);
    this.name = "NutritionPlanAssemblyError";
  }
}

/**
 * Canonical plan content from a parsed reply. The server supplies the dates
 * (the requested seven, in order), the slot order (the requested one) and a
 * fresh meal id per meal from `newMealId` — never derived from a name. Throws
 * `NutritionPlanAssemblyError` if the result is not valid plan content, which
 * can only be a server fault (a meal id generator that repeats itself).
 */
export const assembleNutritionPlanContent = ({
  input,
  response,
  newMealId,
}: {
  input: NutritionGenerationInput;
  response: NutritionProviderResponse;
  newMealId: () => string;
}): NutritionPlanContent => {
  const content: NutritionPlanContent = {
    startDate: input.startDate,
    endDate: addNutritionDays(input.startDate, NUTRITION_PLAN_DAY_COUNT - 1),
    slotOrder: [...input.slotOrder],
    days: response.days.map((day, dayIndex) => ({
      date: addNutritionDays(input.startDate, dayIndex),
      meals: input.slotOrder.map((slotId) => {
        const meal = day.meals.find((candidate) => candidate.slotId === slotId);
        if (!meal) throw new NutritionPlanAssemblyError("a requested slot has no meal");
        return {
          mealId: newMealId(),
          slotId,
          name: meal.name,
          values: {
            kcal: meal.values.kcal,
            proteinG: meal.values.proteinG,
            carbsG: meal.values.carbsG,
            fatG: meal.values.fatG,
          },
        };
      }),
    })),
  };
  const parsed = nutritionPlanContentSchema.safeParse(content);
  if (!parsed.success) throw new NutritionPlanAssemblyError("the assembled content is not valid plan content");
  return parsed.data;
};

export type NutritionProviderInterpretation =
  | { ok: true; content: NutritionPlanContent }
  | { ok: false; issues: NutritionProviderIssue[] };

/**
 * A model's parsed reply as plan content, or the normalised reasons it is not
 * the requested shape. `reply` is whatever the JSON parsed to — `undefined`
 * when the model answered no JSON at all.
 */
export const interpretNutritionProviderReply = ({
  input,
  reply,
  newMealId,
}: {
  input: NutritionGenerationInput;
  reply: unknown;
  newMealId: () => string;
}): NutritionProviderInterpretation => {
  const parsed = nutritionProviderResponseSchema(input.slotOrder).safeParse(reply);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map(normaliseIssue) };
  return { ok: true, content: assembleNutritionPlanContent({ input, response: parsed.data, newMealId }) };
};
