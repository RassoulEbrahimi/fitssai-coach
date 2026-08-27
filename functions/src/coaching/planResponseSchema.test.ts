import { describe, it, expect } from "vitest";
import { planResponseSchema, type ProviderSchema } from "./planResponseSchema";
import {
  DAYS_PER_WEEK,
  PLAN_WEEK_KEYS,
  validateWorkoutPlanContent,
} from "../../../shared/workoutPlan";

/*
  The provider schema and the Zod schema are two descriptions of one contract.
  Gemini accepts a restricted OpenAPI subset, so they cannot be the same
  object — which means they can drift, and a drifted provider schema asks the
  model for a shape our own validator will then reject at our expense.

  These tests pin the parity that matters: the same weeks, the same day count,
  and the same required exercise fields.
*/

const weekSchema = (): ProviderSchema =>
  planResponseSchema.properties?.[PLAN_WEEK_KEYS[0]] as ProviderSchema;

const daySchema = (): ProviderSchema => weekSchema().items as ProviderSchema;

const exerciseSchema = (): ProviderSchema =>
  (daySchema().properties?.exercises as ProviderSchema).items as ProviderSchema;

describe("parity with the shared plan contract", () => {
  it("asks for exactly the shared week keys", () => {
    expect(Object.keys(planResponseSchema.properties ?? {})).toEqual([...PLAN_WEEK_KEYS]);
    expect(planResponseSchema.required).toEqual([...PLAN_WEEK_KEYS]);
  });

  it("asks for exactly the shared number of days", () => {
    expect(weekSchema().minItems).toBe(DAYS_PER_WEEK);
    expect(weekSchema().maxItems).toBe(DAYS_PER_WEEK);
  });

  it("requires the same exercise fields the Zod schema requires", () => {
    expect(exerciseSchema().required).toEqual(["name", "sets", "reps"]);
  });

  it("asks for sets as an integer above zero, as the Zod schema demands", () => {
    const sets = exerciseSchema().properties?.sets as ProviderSchema;

    expect(sets.type).toBe("INTEGER");
    expect(sets.minimum).toBe(1);
  });

  it("asks for reps as a string, because real plans say 8-12", () => {
    expect((exerciseSchema().properties?.reps as ProviderSchema).type).toBe("STRING");
  });

  it("requires day and exercises on every day", () => {
    expect(daySchema().required).toEqual(["day", "exercises"]);
  });
});

describe("a document built to this schema satisfies the Zod schema", () => {
  /** Build the minimum document the provider schema describes. */
  const buildFromSchema = () => {
    const exercise = { name: "Kurzhantel-Rudern", sets: 3, reps: "8-12" };
    const week = Array.from({ length: DAYS_PER_WEEK }, (_, index) => ({
      day: `Tag ${index + 1}`,
      exercises: index === 0 ? [exercise] : [],
    }));
    return Object.fromEntries(PLAN_WEEK_KEYS.map((key) => [key, week]));
  };

  it("passes validation", () => {
    // If this ever fails, the model is being asked for a shape we reject.
    expect(validateWorkoutPlanContent(buildFromSchema()).ok).toBe(true);
  });

  it("still fails validation if a week is dropped, proving the check is real", () => {
    const content = buildFromSchema();
    delete (content as Record<string, unknown>)[PLAN_WEEK_KEYS[2]];

    expect(validateWorkoutPlanContent(content).ok).toBe(false);
  });
});

describe("the schema stays inside the provider's supported subset", () => {
  const walk = (schema: ProviderSchema): ProviderSchema[] => [
    schema,
    ...Object.values(schema.properties ?? {}).flatMap(walk),
    ...(schema.items ? walk(schema.items) : []),
  ];

  it("uses only supported type names", () => {
    const allowed = new Set(["OBJECT", "ARRAY", "STRING", "INTEGER", "NUMBER", "BOOLEAN"]);

    for (const node of walk(planResponseSchema)) {
      expect(allowed.has(node.type)).toBe(true);
    }
  });

  it("declares no keyword the provider would reject", () => {
    const serialised = JSON.stringify(planResponseSchema);

    for (const unsupported of ["additionalProperties", "oneOf", "allOf", "$ref", "patternProperties"]) {
      expect(serialised).not.toContain(unsupported);
    }
  });
});
