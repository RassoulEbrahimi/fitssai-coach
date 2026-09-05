import { RECOMMENDATION_CATEGORIES } from "../../../shared/weeklyRecommendation";
import type { ProviderSchema } from "./planResponseSchema";

/**
 * The response schema handed to the provider's structured-output mode.
 *
 * Four short fields, and no field in which a plan could be expressed: no
 * exercises, no sets, no reps, no schedule. Structured output makes valid
 * output likely rather than certain, so the result is still `unknown` until
 * the shared Zod schema has parsed it and the category has been checked
 * against the one the rules chose — but a shape that cannot describe a workout
 * is one fewer way for a model to hand back plan content.
 */
export const weeklyReviewResponseSchema: ProviderSchema = {
  type: "OBJECT",
  properties: {
    category: {
      type: "STRING",
      description: `Exakt der Wert aus der Eingabe. Erlaubt: ${RECOMMENDATION_CATEGORIES.join(", ")}.`,
    },
    headline: { type: "STRING", description: "Kurze deutsche Überschrift, höchstens 70 Zeichen." },
    message: {
      type: "STRING",
      description: "Die Empfehlung in ein bis zwei deutschen Sätzen, höchstens 320 Zeichen.",
    },
    reason: {
      type: "STRING",
      description: "Begründung aus den gelieferten Zahlen, höchstens 240 Zeichen.",
    },
  },
  required: ["category", "headline", "message", "reason"],
  propertyOrdering: ["category", "headline", "message", "reason"],
};
