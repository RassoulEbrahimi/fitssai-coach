import { NUTRITION_PLAN_DAY_COUNT } from "../../../../shared/nutrition";
import type { NutritionGenerationInput } from "../generationInput";
import type { NutritionCandidateFailure } from "../generationProvider";

/**
 * What the Nutrition model is told (NUT-12B). Nutrition's own: nothing here
 * is shared with Training's prompts.
 *
 * STRUCTURE and BEHAVIOUR only. No number in this file is nutrition policy:
 * there is no tolerance, no minimum or maximum, no per-meal limit, no formula
 * and no threshold — those belong to the signed-off target and plan-validation
 * policies, which judge every candidate after the model has answered. The only
 * numbers the model reads are the TARGET values it is given and the fixed
 * plan length.
 *
 * The prompt is built field by field from the minimized generation input and
 * from nothing else: no profile, no account, no document path, no id.
 */

export const NUTRITION_PLAN_SYSTEM_INSTRUCTION = [
  `You create a ${NUTRITION_PLAN_DAY_COUNT}-day meal plan for a nutrition app, as structured data.`,
  "",
  "Use only what the request gives you: the TARGET values (kcal, protein, carbohydrates and fat per day), the meal slots, the start date and a dietary preference. Plan each day towards the TARGET values.",
  "",
  "Structure:",
  `- Return exactly ${NUTRITION_PLAN_DAY_COUNT} days, in order.`,
  "- Every day has exactly one meal for every requested slot, and no meal for any other slot.",
  "- Each meal has only: slotId (one of the requested slot ids, exactly as written), name, and values (kcal, proteinG, carbsG, fatG) as non-negative numbers.",
  "- Write every meal name in German. Slot ids stay exactly as given; do not translate them.",
  "- Output only the requested structured content. No commentary, no explanation, no text outside it.",
  "",
  "Never output:",
  "- ids of any kind (no plan id, meal id, request id or target id), dates, the slot order or the TARGET itself;",
  "- storage, lifecycle, validation or source metadata, or timestamps;",
  "- facts about the person: you know nothing about them beyond this request, so do not invent a name, age, body data, goal or health information.",
  "",
  "Boundaries:",
  "- The dietary preference is a preference to follow, not a guarantee. Do not claim that a plan or meal is allergy-safe, allergen-free or medically safe.",
  "- Do not diagnose, treat or give advice about any disease or medical condition.",
].join("\n");

/** How the dietary preference is phrased: a preference, never an allergy promise. */
const describePreference = (preference: NutritionGenerationInput["dietaryPreference"]): string =>
  preference === null || preference === "noPreference"
    ? "none stated"
    : `${preference} (a preference to follow, not an allergy or medical guarantee)`;

/**
 * The request for one plan. Built field by field from the minimized input:
 * the start date, the plan length, the four TARGET values, the slot ids and
 * the dietary preference — nothing else can reach the model.
 */
export const buildNutritionPlanPrompt = (input: NutritionGenerationInput): string =>
  [
    `Create the ${input.dayCount}-day meal plan.`,
    "",
    `Start date: ${input.startDate}`,
    `Days: ${input.dayCount}`,
    `TARGET per day: ${input.target.kcal} kcal, ${input.target.proteinG} g protein, ${input.target.carbsG} g carbohydrates, ${input.target.fatG} g fat`,
    `Meal slots, one meal each per day: ${input.slotOrder.join(", ")}`,
    `Dietary preference: ${describePreference(input.dietaryPreference)}`,
  ].join("\n");

/** What the one repair is told about the first answer: normalised issues, or only that the plan check refused it. */
const describeFailure = (failure: NutritionCandidateFailure): string[] => {
  if (failure.kind === "rejectedByPolicy") {
    return ["The previous plan was not accepted by the plan check. Create a new plan for the same request."];
  }
  return [
    "The previous answer did not have the requested structure:",
    ...failure.issues.map((issue) => `- ${issue.path === "" ? "(answer)" : issue.path}: ${issue.message}`),
    "Return the complete plan again with the requested structure.",
  ];
};

/**
 * The one repair: the same request, plus what was wrong with the first answer
 * in normalised form. Never the first answer itself, a profile, a path, an
 * exception or anything the provider returned besides.
 */
export const buildNutritionRepairPrompt = (input: NutritionGenerationInput, failure: NutritionCandidateFailure): string =>
  [buildNutritionPlanPrompt(input), "", ...describeFailure(failure)].join("\n");
