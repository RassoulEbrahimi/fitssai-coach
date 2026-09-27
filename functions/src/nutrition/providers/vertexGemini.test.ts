import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nutritionPlanContentSchema, type NutritionPlanContent, type TargetVersion } from "../../../../shared/nutrition";
import { GEMINI_MODEL_ID } from "../../coaching/providers/gemini";
import {
  FAKE_PROVIDER_FAILURE_MESSAGE,
  FIXTURE_VERTEX_CONFIGURATION,
  createFakeGoogleGenAiClient,
  fixtureMealIds,
  fixtureVertexReply,
  type FakeGenAiStep,
} from "../../testing/fakeGoogleGenAiClient";
import {
  FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY,
  FIXTURE_REJECT_PLAN_VALIDATION_POLICY,
} from "../../testing/fixturePlanValidationPolicies";
import { storedTarget } from "../../testing/nutritionPlanFixtures";
import { generateNutritionPlanCandidate } from "../generationCandidate";
import type { NutritionGenerationInput } from "../generationInput";
import { NutritionGenerationProviderConfigurationError, NutritionProviderAnswerRejection } from "../generationProvider";
import { NUTRITION_PLAN_SYSTEM_INSTRUCTION } from "./prompt";
import {
  NUTRITION_GEMINI_MAX_OUTPUT_TOKENS,
  NUTRITION_GEMINI_MODEL_ID,
  NUTRITION_GEMINI_TEMPERATURE_MAX,
  NUTRITION_MAX_TRANSPORT_ATTEMPTS_CEILING,
  NUTRITION_THINKING_LEVELS,
  NUTRITION_VERTEX_PROVIDER_ID,
  NutritionProviderCallError,
  createNutritionVertexProvider,
  parseNutritionVertexProviderConfiguration,
} from "./vertexGemini";

/*
  NUT-12B: the Nutrition Vertex AI adapter, against a scripted fake SDK client.
  No test here reaches a network, a credential or a real project: CI never
  calls Vertex AI. The production gate is not involved — these tests build the
  adapter directly, which only the (unconfigured) production registry would do
  in a deployment.
*/

const INPUT: NutritionGenerationInput = Object.freeze({
  startDate: "2026-09-29",
  dayCount: 7,
  target: Object.freeze({ kcal: 2100, proteinG: 130, carbsG: 240, fatG: 70 }),
  slotOrder: Object.freeze(["breakfast", "lunch", "dinner"]) as unknown as NutritionGenerationInput["slotOrder"],
  dietaryPreference: "vegetarian",
}) as NutritionGenerationInput;

/** A JSON Schema node, walked by key; only what these assertions read. */
type SchemaNode = { readonly [key: string]: SchemaNode };

const SLOTS = ["breakfast", "lunch", "dinner"] as const;
const DATES = ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];

const TARGET = { ...storedTarget("target-1"), createdAt: { seconds: 0, nanoseconds: 0 } } as unknown as TargetVersion;

const build = (steps: FakeGenAiStep[], configuration: Record<string, unknown> = {}) => {
  const client = createFakeGoogleGenAiClient(steps);
  const sleeps: number[] = [];
  let built = 0;
  const provider = createNutritionVertexProvider(
    { ...FIXTURE_VERTEX_CONFIGURATION, ...configuration },
    {
      createClient: (connection) => {
        built += 1;
        expect(connection).toEqual({ kind: "vertex", project: "fixture-project", location: "fixture-location" });
        return client;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      newMealId: fixtureMealIds(),
    }
  );
  return { client, provider, sleeps, built: () => built };
};

const valid = { reply: fixtureVertexReply(SLOTS) };

const rejectionOf = async (step: FakeGenAiStep) => {
  const answer = await build([step]).provider.generate(INPUT);
  expect(answer).toBeInstanceOf(NutritionProviderAnswerRejection);
  return (answer as NutritionProviderAnswerRejection).issues;
};

const callError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(NutritionProviderCallError);
    return error as NutritionProviderCallError;
  }
  throw new Error("expected the call to fail");
};

describe("the model", () => {
  it("is Nutrition's own pinned model: gemini-3.8-flash", () => {
    expect(NUTRITION_GEMINI_MODEL_ID).toBe("gemini-3.8-flash");
  });

  it("is independent of Training's model constant, which stays where it was", () => {
    expect(GEMINI_MODEL_ID).toBe("gemini-3.7-flash");
    expect(NUTRITION_GEMINI_MODEL_ID).not.toBe(GEMINI_MODEL_ID);
    const source = readFileSync(join(__dirname, "vertexGemini.ts"), "utf-8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // A literal, not a reference: changing Training's constant cannot move it.
    expect(code).toMatch(/export const NUTRITION_GEMINI_MODEL_ID = "gemini-3\.8-flash";/);
    expect(code.replace(/NUTRITION_GEMINI_MODEL_ID/g, "")).not.toMatch(/GEMINI_MODEL_ID|coaching\//);
    // The availability check is dated beside it.
    expect(source).toMatch(/Availability checked on 2026-09-27/);
  });

  it("is sent verbatim, with the provider's own id naming no key, project or location", async () => {
    const { client, provider } = build([valid]);
    await provider.generate(INPUT);
    expect(client.requests[0].model).toBe(NUTRITION_GEMINI_MODEL_ID);
    expect(NUTRITION_VERTEX_PROVIDER_ID).toBe("google-vertex-nutrition");
    expect(provider.id).toBe(NUTRITION_VERTEX_PROVIDER_ID);
  });
});

describe("what the model is sent", () => {
  it("only the minimized input, the Nutrition system instruction and the configured settings", async () => {
    const { client, provider } = build([valid]);
    await provider.generate(INPUT);

    const request = client.requests[0];
    expect(Object.keys(request).sort()).toEqual(["config", "contents", "model"]);
    const config = request.config as Record<string, unknown>;
    expect(Object.keys(config).sort()).toEqual([
      "candidateCount",
      "maxOutputTokens",
      "responseJsonSchema",
      "responseMimeType",
      "systemInstruction",
      "temperature",
      "thinkingConfig",
    ]);
    expect(config.systemInstruction).toBe(NUTRITION_PLAN_SYSTEM_INSTRUCTION);
    expect(config.temperature).toBe(FIXTURE_VERTEX_CONFIGURATION.temperature);
    expect(config.maxOutputTokens).toBe(FIXTURE_VERTEX_CONFIGURATION.maxOutputTokens);
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(config.candidateCount).toBe(1);
    expect(config.responseMimeType).toBe("application/json");

    const prompt = String(request.contents);
    expect(prompt).toContain("2026-09-29");
    expect(prompt).toContain("2100 kcal, 130 g protein, 240 g carbohydrates, 70 g fat");
    expect(prompt).toContain("breakfast, lunch, dinner");
    expect(prompt).toContain("vegetarian (a preference to follow, not an allergy or medical guarantee)");
  });

  it("carries no identity, profile, path, credential, project or location", async () => {
    const { client, provider } = build([valid]);
    await provider.generate(INPUT);
    const sent = JSON.stringify(client.requests[0]);
    for (const forbidden of ["uid", "email", "Alice", "users/", "nutrition_v2", "fixture-project", "fixture-location", "apiKey", "planId", "requestId", "targetVersionId", "weight", "height", "biologicalSex", "activityLevel", "fitnessGoal", "manualTargetKcal", "excluded"]) {
      expect(sent, forbidden).not.toContain(forbidden);
    }
  });

  it("refuses an input carrying anything beyond the minimized fields, before any call", async () => {
    const { client, provider, built } = build([valid]);
    const widened = { ...INPUT, uid: "alice", excludedFoodCategories: ["x"] } as unknown as NutritionGenerationInput;
    expect((await callError(provider.generate(widened))).reason).toBe("invalidInput");
    expect(client.requests).toEqual([]);
    expect(built()).toBe(0);
  });

  it("asks for structured output generated for exactly the requested slots and seven days", async () => {
    const { client, provider } = build([valid]);
    await provider.generate({ ...INPUT, slotOrder: ["lunch", "snack_2"] });
    const schema = (client.requests[0].config as Record<string, unknown>).responseJsonSchema as unknown as SchemaNode;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["days"]);
    expect(schema.properties.days.minItems).toBe(7);
    expect(schema.properties.days.maxItems).toBe(7);
    const meals = schema.properties.days.items.properties.meals;
    expect(meals.minItems).toBe(2);
    expect(meals.maxItems).toBe(2);
    expect(meals.items.properties.slotId.enum).toEqual(["lunch", "snack_2"]);
    expect(meals.items.required).toEqual(["slotId", "name", "values"]);
    expect(meals.items.additionalProperties).toBe(false);
    expect(meals.items.properties.values.properties.kcal).toEqual({ type: "number", minimum: 0 });
    expect(JSON.stringify(schema)).not.toMatch(/mealId|planId|date|targetVersionId|source|lifecycle|requestId|validation/);
  });

  it("sends no thinking setting when the configuration names none", async () => {
    const { client, provider } = build([valid], { thinkingLevel: null });
    await provider.generate(INPUT);
    expect(client.requests[0].config).not.toHaveProperty("thinkingConfig");
  });

  it("builds the SDK client once, on the first call — never when it is only constructed", async () => {
    const { provider, built } = build([{ reply: {} }, valid]);
    expect(built()).toBe(0);
    await provider.generate(INPUT);
    await provider.repair?.({ input: INPUT, failure: { kind: "rejectedByPolicy" } });
    expect(built()).toBe(1);
  });
});

describe("the server assembles the plan", () => {
  it("from a valid reply: the requested seven dates, the requested slot order, server meal ids and German names", async () => {
    const answer = (await build([valid]).provider.generate(INPUT)) as NutritionPlanContent;

    expect(nutritionPlanContentSchema.safeParse(answer).success).toBe(true);
    expect(answer.startDate).toBe("2026-09-29");
    expect(answer.endDate).toBe("2026-10-05");
    expect(answer.slotOrder).toEqual([...SLOTS]);
    expect(answer.days.map((day) => day.date)).toEqual(DATES);
    expect(answer.days.flatMap((day) => day.meals.map((meal) => meal.mealId))).toEqual(Array.from({ length: 21 }, (_, index) => `meal-${index + 1}`));
    expect(answer.days[2].meals.map((meal) => meal.name)).toEqual(["Haferbrei mit Beeren 3", "Linsensuppe mit Brot 3", "Gemüsepfanne mit Reis 3"]);
    expect(answer.days[0].meals[0].values).toEqual({ kcal: 400, proteinG: 25, carbsG: 45, fatG: 12 });
  });

  it("puts meals in the requested slot order whatever order the model used", async () => {
    const reply = fixtureVertexReply(SLOTS);
    reply.days.forEach((day) => day.meals.reverse());
    const answer = (await build([{ reply }]).provider.generate(INPUT)) as NutritionPlanContent;
    expect(answer.days.every((day) => day.meals.map((meal) => meal.slotId).join() === SLOTS.join())).toBe(true);
  });

  it("never derives a meal id from a name: the same name twice gets two ids", async () => {
    const reply = fixtureVertexReply(SLOTS, (slotId) => ({ slotId, name: "Eintopf", values: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1 } }));
    const answer = (await build([{ reply }]).provider.generate(INPUT)) as NutritionPlanContent;
    const ids = answer.days.flatMap((day) => day.meals.map((meal) => meal.mealId));
    expect(new Set(ids).size).toBe(21);
    expect(ids.some((id) => /eintopf/i.test(id))).toBe(false);
  });
});

describe("a reply that is not the requested shape is refused, not repaired silently", () => {
  const withMeal = (patch: (meal: Record<string, unknown>) => Record<string, unknown>) =>
    fixtureVertexReply(SLOTS, (slotId, dayIndex) =>
      patch({ slotId, name: `Mahlzeit ${dayIndex}`, values: { kcal: 300, proteinG: 20, carbsG: 30, fatG: 10 } })
    );

  it.each(["mealId", "planId", "uid", "targetVersionId", "source", "lifecycle", "date", "requestId"])(
    "a meal carrying %s — the model cannot choose server metadata",
    async (field) => {
      const issues = await rejectionOf({ reply: withMeal((meal) => ({ ...meal, [field]: "model-chosen" })) });
      expect(issues).toContainEqual({ path: "days.0.meals.0", message: "must not contain any other field" });
      expect(JSON.stringify(issues)).not.toContain("model-chosen");
    }
  );

  it.each(["planId", "startDate", "endDate", "slotOrder", "validation", "generationRequestId"])("a reply carrying %s at the top", async (field) => {
    const issues = await rejectionOf({ reply: { ...fixtureVertexReply(SLOTS), [field]: "model-chosen" } });
    expect(issues).toContainEqual({ path: "", message: "must not contain any other field" });
  });

  it("a day carrying its own date", async () => {
    const reply = fixtureVertexReply(SLOTS);
    (reply.days[3] as Record<string, unknown>).date = "2026-10-02";
    expect(await rejectionOf({ reply })).toContainEqual({ path: "days.3", message: "must not contain any other field" });
  });

  it("extra nutrient fields", async () => {
    const issues = await rejectionOf({ reply: withMeal((meal) => ({ ...meal, values: { ...(meal.values as object), sugarG: 5 } })) });
    expect(issues).toContainEqual({ path: "days.0.meals.0.values", message: "must not contain any other field" });
  });

  it("a missing day", async () => {
    const reply = fixtureVertexReply(SLOTS);
    reply.days.pop();
    expect(await rejectionOf({ reply })).toContainEqual({ path: "days", message: "exactly 7 days" });
  });

  it("a missing meal", async () => {
    const reply = fixtureVertexReply(SLOTS);
    reply.days[1].meals.splice(1, 1);
    expect(await rejectionOf({ reply })).toContainEqual({ path: "days.1.meals", message: "slot lunch has no meal" });
  });

  it("a slot that was not requested", async () => {
    const issues = await rejectionOf({ reply: withMeal((meal) => (meal.slotId === "dinner" ? { ...meal, slotId: "snack_2" } : meal)) });
    expect(issues).toContainEqual({ path: "days.0.meals.2.slotId", message: "must be one of breakfast, lunch, dinner" });
  });

  it("an extra meal for a slot that already has one", async () => {
    const reply = fixtureVertexReply(SLOTS);
    reply.days[0].meals.push({ ...reply.days[0].meals[0] });
    expect(await rejectionOf({ reply })).toContainEqual({ path: "days.0.meals.3.slotId", message: "slot breakfast is planned twice" });
  });

  it.each<[string, unknown]>([
    ["negative", -5],
    ["a string", "300"],
    ["missing", undefined],
  ])("nutrition that is %s", async (_label, kcal) => {
    const issues = await rejectionOf({ reply: withMeal((meal) => ({ ...meal, values: { ...(meal.values as object), kcal } })) });
    expect(issues.some((issue) => issue.path === "days.0.meals.0.values.kcal")).toBe(true);
  });

  it("an empty meal name", async () => {
    const issues = await rejectionOf({ reply: withMeal((meal) => ({ ...meal, name: "   " })) });
    expect(issues).toContainEqual({ path: "days.0.meals.0.name", message: "must not be empty" });
  });

  it.each<[string, FakeGenAiStep]>([
    ["prose instead of JSON", { text: "Hier ist dein Plan: Montag …" }],
    ["no text at all", "empty"],
    ["a JSON array", { reply: [] }],
    ["the canonical plan shape instead of the transport shape", { reply: { startDate: "2026-09-29", days: [] } }],
  ])("%s", async (_label, step) => {
    expect((await rejectionOf(step)).length).toBeGreaterThan(0);
  });
});

describe("the NUT-11 candidate step over the adapter: at most one repair", () => {
  const candidate = (steps: FakeGenAiStep[], policy = FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY) => {
    const built = build(steps);
    return { ...built, outcome: generateNutritionPlanCandidate({ provider: built.provider, input: INPUT, policy, target: TARGET }) };
  };

  it("a valid reply is accepted without a repair", async () => {
    const { outcome, client } = candidate([valid]);
    expect(await outcome).toMatchObject({ ok: true, repairUsed: false });
    expect(client.requests).toHaveLength(1);
  });

  it("an injected id, then a valid repair: accepted; the repair is told the normalised failure and nothing of the reply", async () => {
    const injected = fixtureVertexReply(SLOTS, (slotId) => ({ slotId, mealId: "secret-model-id", name: "X", values: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1 } }));
    const { outcome, client } = candidate([{ reply: injected }, valid]);
    const result = await outcome;
    expect(result).toMatchObject({ ok: true, repairUsed: true });
    expect(client.requests).toHaveLength(2);
    const repairPrompt = String(client.requests[1].contents);
    expect(repairPrompt).toContain(String(client.requests[0].contents));
    expect(repairPrompt).toContain("days.0.meals.0: must not contain any other field");
    expect(repairPrompt).not.toContain("secret-model-id");
    expect(JSON.stringify(result)).not.toContain("secret-model-id");
  });

  it("invalid twice: CANDIDATE_INVALID after exactly one repair — never a loop", async () => {
    const { outcome, client } = candidate([{ reply: {} }, { reply: {} }, valid]);
    expect(await outcome).toEqual({ ok: false, code: "CANDIDATE_INVALID", repairUsed: true });
    expect(client.requests).toHaveLength(2);
  });

  it("a repair whose call fails: PROVIDER_FAILED", async () => {
    const { outcome } = candidate([{ reply: {} }, { status: 400 }]);
    expect(await outcome).toEqual({ ok: false, code: "PROVIDER_FAILED", repairUsed: true });
  });

  it("policy-rejected twice: PLAN_VALIDATION_FAILED; the repair is told only that the plan check refused", async () => {
    const { outcome, client } = candidate([valid, valid], FIXTURE_REJECT_PLAN_VALIDATION_POLICY);
    expect(await outcome).toEqual({ ok: false, code: "PLAN_VALIDATION_FAILED", repairUsed: true });
    expect(String(client.requests[1].contents)).toContain("was not accepted by the plan check");
    expect(String(client.requests[1].contents)).not.toContain("test-fixture-reject");
  });

  it("a first call that fails: PROVIDER_FAILED and no repair", async () => {
    const { outcome, client } = candidate([{ status: 401 }, valid]);
    expect(await outcome).toEqual({ ok: false, code: "PROVIDER_FAILED", repairUsed: false });
    expect(client.requests).toHaveLength(1);
  });
});

describe("transport: bounded retries, no retry for what would fail again", () => {
  it.each([429, 500, 503])("retries %i once, then succeeds", async (status) => {
    const { client, provider, sleeps } = build([{ status }, valid]);
    expect(nutritionPlanContentSchema.safeParse(await provider.generate(INPUT)).success).toBe(true);
    expect(client.requests).toHaveLength(2);
    expect(sleeps).toEqual([250]);
  });

  it("stops at the configured attempts: 429 every time is two calls, then a failure", async () => {
    const { client, provider } = build([{ status: 429 }]);
    expect((await callError(provider.generate(INPUT))).reason).toBe("rateLimited");
    expect(client.requests).toHaveLength(FIXTURE_VERTEX_CONFIGURATION.maxTransportAttempts);
  });

  it.each([
    [400, "refused"],
    [401, "refused"],
    [403, "refused"],
    [404, "refused"],
  ] as const)("does not retry %i", async (status, reason) => {
    const { client, provider, sleeps } = build([{ status }, valid]);
    expect((await callError(provider.generate(INPUT))).reason).toBe(reason);
    expect(client.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("5xx on every attempt is unavailable", async () => {
    expect((await callError(build([{ status: 502 }]).provider.generate(INPUT))).reason).toBe("unavailable");
  });

  it("does not retry a schema rejection: an unusable reply is one call, answered as a rejection", async () => {
    const { client, provider } = build([{ reply: { days: "none" } }, valid]);
    expect(await provider.generate(INPUT)).toBeInstanceOf(NutritionProviderAnswerRejection);
    expect(client.requests).toHaveLength(1);
  });

  it("times out an attempt that never answers, aborts it, and does not retry it", async () => {
    const { client, provider, sleeps } = build(["hang", valid], { timeoutMs: 25 });
    const started = Date.now();
    expect((await callError(provider.generate(INPUT))).reason).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(client.requests).toHaveLength(1);
    expect(client.signals[0].aborted).toBe(true);
    expect(sleeps).toEqual([]);
  });

  it("never lets the provider's message, endpoint, project, credential or request out", async () => {
    for (const step of [{ status: 429 }, { status: 503 }, { status: 403 }, "hang"] as FakeGenAiStep[]) {
      const error = await callError(build([step], { timeoutMs: 10 }).provider.generate(INPUT));
      const exposed = `${error.message} ${error.stack ?? ""} ${JSON.stringify(error)}`;
      for (const leak of [FAKE_PROVIDER_FAILURE_MESSAGE, "fixture-project", "fixture-location", "ya29", "https://", "kcal"]) {
        expect(exposed, leak).not.toContain(leak);
      }
      expect(error.message).toBe("The Nutrition provider call failed.");
    }
  });
});

describe("configuration is explicit, never defaulted", () => {
  it.each(["project", "location", "temperature", "maxOutputTokens", "thinkingLevel", "timeoutMs", "maxTransportAttempts"])(
    "a configuration without %s is refused, naming the field and no value",
    (field) => {
      const { [field as keyof typeof FIXTURE_VERTEX_CONFIGURATION]: _dropped, ...rest } = FIXTURE_VERTEX_CONFIGURATION;
      let error: unknown;
      try {
        parseNutritionVertexProviderConfiguration(rest);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(NutritionGenerationProviderConfigurationError);
      expect((error as Error).message).toContain(field);
      expect((error as Error).message).not.toContain("fixture-project");
    }
  );

  it.each<[string, Record<string, unknown>]>([
    ["a blank location", { location: " " }],
    ["a blank project", { project: "" }],
    ["a zero timeout", { timeoutMs: 0 }],
    ["unbounded attempts", { maxTransportAttempts: Number.POSITIVE_INFINITY }],
    ["attempts above the ceiling", { maxTransportAttempts: NUTRITION_MAX_TRANSPORT_ATTEMPTS_CEILING + 1 }],
    ["no attempt at all", { maxTransportAttempts: 0 }],
    ["an unknown thinking level", { thinkingLevel: "MAXIMUM" }],
    ["an API key", { apiKey: "AIza-not-a-real-key" }],
    ["an extra setting", { region: "somewhere" }],
  ])("refuses %s", (_label, patch) => {
    expect(() => parseNutritionVertexProviderConfiguration({ ...FIXTURE_VERTEX_CONFIGURATION, ...patch })).toThrow(NutritionGenerationProviderConfigurationError);
    expect(() => createNutritionVertexProvider({ ...FIXTURE_VERTEX_CONFIGURATION, ...patch })).toThrow(NutritionGenerationProviderConfigurationError);
  });

  it("accepts the fixture configuration as given and freezes it", () => {
    expect(parseNutritionVertexProviderConfiguration(FIXTURE_VERTEX_CONFIGURATION)).toEqual(FIXTURE_VERTEX_CONFIGURATION);
  });
});

describe("configuration stays within what the pinned model accepts", () => {
  /** Whether `patch` is accepted, and — if refused — that it is refused before any client exists or any call is made. */
  const judged = async (patch: Record<string, unknown>) => {
    let built = 0;
    const client = createFakeGoogleGenAiClient([valid]);
    const create = () =>
      createNutritionVertexProvider({ ...FIXTURE_VERTEX_CONFIGURATION, ...patch }, { createClient: () => ((built += 1), client), newMealId: fixtureMealIds() });
    let provider: ReturnType<typeof create>;
    try {
      provider = create();
    } catch (error) {
      expect(error).toBeInstanceOf(NutritionGenerationProviderConfigurationError);
      const message = (error as Error).message;
      for (const value of Object.values(patch)) {
        if ((typeof value === "string" && value !== "") || (typeof value === "number" && value !== 0 && value !== 1 && value !== 2)) {
          expect(message, "no raw setting value").not.toContain(String(value));
        }
      }
      expect(built).toBe(0);
      expect(client.requests).toEqual([]);
      return "refused" as const;
    }
    await provider.generate(INPUT);
    expect(client.requests).toHaveLength(1);
    return "accepted" as const;
  };

  it("pins the model's limits beside the model", () => {
    expect(NUTRITION_THINKING_LEVELS).toEqual(["LOW", "MEDIUM", "HIGH"]);
    expect(NUTRITION_GEMINI_MAX_OUTPUT_TOKENS).toBe(65_536);
    expect(NUTRITION_GEMINI_TEMPERATURE_MAX).toBe(2);
  });

  it.each(["LOW", "MEDIUM", "HIGH"])("thinking level %s is accepted and sent", async (thinkingLevel) => {
    expect(await judged({ thinkingLevel })).toBe("accepted");
    const client = createFakeGoogleGenAiClient([valid]);
    await createNutritionVertexProvider({ ...FIXTURE_VERTEX_CONFIGURATION, thinkingLevel }, { createClient: () => client }).generate(INPUT);
    expect((client.requests[0].config as Record<string, unknown>).thinkingConfig).toEqual({ thinkingLevel });
  });

  it("no thinking level (null) is accepted, and sends none", async () => {
    expect(await judged({ thinkingLevel: null })).toBe("accepted");
  });

  it.each(["MINIMAL", "minimal", "low", "MAXIMUM", "THINKING_LEVEL_UNSPECIFIED", ""])(
    "thinking level %j is refused before a client is built",
    async (thinkingLevel) => {
      expect(await judged({ thinkingLevel })).toBe("refused");
    }
  );

  it.each([1, 8_192, 65_536])("maxOutputTokens %i is accepted", async (maxOutputTokens) => {
    expect(await judged({ maxOutputTokens })).toBe("accepted");
  });

  it.each([0, -1, 65_537, 1_000_000, 1.5])("maxOutputTokens %s is refused before a client is built", async (maxOutputTokens) => {
    expect(await judged({ maxOutputTokens })).toBe("refused");
  });

  it.each([0.1, 1, 2])("temperature %s is accepted", async (temperature) => {
    expect(await judged({ temperature })).toBe("accepted");
  });

  it.each([0, -0.5, 2.0001, 3, Number.NaN])("temperature %s is refused before a client is built", async (temperature) => {
    expect(await judged({ temperature })).toBe("refused");
  });
});

describe("the fixture configuration", () => {
  it("parses and freezes", () => {
    const parsed = parseNutritionVertexProviderConfiguration(FIXTURE_VERTEX_CONFIGURATION);
    expect(parsed).toEqual(FIXTURE_VERTEX_CONFIGURATION);
    expect(Object.isFrozen(parsed)).toBe(true);
  });
});
