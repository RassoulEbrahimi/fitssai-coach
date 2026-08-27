import { DAYS_PER_WEEK, PLAN_WEEK_KEYS } from "../../../shared/workoutPlan";

/**
 * The response schema handed to the provider's structured-output mode.
 *
 * Gemini accepts a restricted OpenAPI subset, not arbitrary JSON Schema, so
 * this cannot simply be the Zod schema serialised: `passthrough`, unions and
 * refinements have no equivalent. It is a small explicit adapter instead — but
 * one built *from* the shared constants, so a change to the week keys or the
 * days-per-week count moves both sides at once. A parity test pins the rest.
 *
 * Structured output is a way to make valid output likely, not a guarantee. The
 * result is still `unknown` until the shared Zod schema has parsed it; a model
 * that returns four weeks of nothing satisfies this schema perfectly.
 */

export type ProviderSchemaType =
  | "OBJECT"
  | "ARRAY"
  | "STRING"
  | "INTEGER"
  | "NUMBER"
  | "BOOLEAN";

export interface ProviderSchema {
  type: ProviderSchemaType;
  description?: string;
  properties?: Record<string, ProviderSchema>;
  required?: string[];
  propertyOrdering?: string[];
  items?: ProviderSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
}

const exerciseSchema: ProviderSchema = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", description: "Deutscher Übungsname." },
    sets: { type: "INTEGER", description: "Anzahl der Sätze, mindestens 1.", minimum: 1 },
    reps: { type: "STRING", description: 'Wiederholungen als Text, z. B. "8-12".' },
    rest: { type: "STRING", description: 'Pause zwischen den Sätzen, z. B. "90s".' },
    description: { type: "STRING", description: "Kurzer deutscher Ausführungshinweis." },
  },
  required: ["name", "sets", "reps"],
  propertyOrdering: ["name", "sets", "reps", "rest", "description"],
};

const daySchema: ProviderSchema = {
  type: "OBJECT",
  properties: {
    day: { type: "STRING", description: "Deutscher Wochentag, z. B. Montag." },
    exercises: {
      type: "ARRAY",
      description: "Leer an einem Ruhetag.",
      items: exerciseSchema,
    },
  },
  required: ["day", "exercises"],
  propertyOrdering: ["day", "exercises"],
};

const weekSchema: ProviderSchema = {
  type: "ARRAY",
  description: `Genau ${DAYS_PER_WEEK} Tage, Montag zuerst.`,
  items: daySchema,
  minItems: DAYS_PER_WEEK,
  maxItems: DAYS_PER_WEEK,
};

/** The four weeks, keyed exactly as the shared contract keys them. */
export const planResponseSchema: ProviderSchema = {
  type: "OBJECT",
  properties: Object.fromEntries(PLAN_WEEK_KEYS.map((key) => [key, weekSchema])),
  required: [...PLAN_WEEK_KEYS],
  propertyOrdering: [...PLAN_WEEK_KEYS],
};
