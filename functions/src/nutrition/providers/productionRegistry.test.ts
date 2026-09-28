import { afterEach, describe, it, expect, vi } from "vitest";
import { FIXTURE_VERTEX_CONFIGURATION, FIXTURE_VERTEX_DEPLOYMENT, createFakeGoogleGenAiClient } from "../../testing/fakeGoogleGenAiClient";
import type { NutritionGenerationInput } from "../generationInput";
import { NutritionGenerationProviderConfigurationError } from "../generationProvider";
import {
  PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT,
  createNutritionVertexProviderRegistry,
  productionNutritionGenerationProviderRegistry,
} from "./productionRegistry";
import { NUTRITION_VERTEX_PROVIDER_ID } from "./vertexGemini";

/*
  NUT-12B: the deployed generator registry is lazy. Asking it is cheap and
  builds nothing; an incomplete deployment is an explicit error, never a
  defaulted project, location or setting. NUT-12C.2: production carries the
  signed Vertex deployment — configured, and still behind the closed gate.
*/

const FIXTURE_GENERATION_INPUT: NutritionGenerationInput = Object.freeze({
  startDate: "2026-09-29",
  dayCount: 7,
  target: Object.freeze({ kcal: 2100, proteinG: 130, carbsG: 240, fatG: 70 }),
  slotOrder: Object.freeze(["breakfast", "lunch", "dinner"]) as unknown as NutritionGenerationInput["slotOrder"],
  dietaryPreference: "vegetarian",
}) as NutritionGenerationInput;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the production registry", () => {
  it("resolves the signed deployment's generator and lease without any network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test"));
    const setup = productionNutritionGenerationProviderRegistry.current();
    expect(setup?.provider.id).toBe(NUTRITION_VERTEX_PROVIDER_ID);
    expect(setup?.operationLeaseMs).toBe(300_000);
    expect(productionNutritionGenerationProviderRegistry.current()).toBe(setup);
    expect(Object.isFrozen(productionNutritionGenerationProviderRegistry)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("over the signed deployment builds no SDK client until the generator is called, and then asks for the pinned model with LOW thinking and 8192 tokens", async () => {
    let built = 0;
    const client = createFakeGoogleGenAiClient([{ status: 400 }]);
    const connections: unknown[] = [];
    const registry = createNutritionVertexProviderRegistry(PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT, {
      createClient: (connection) => (connections.push(connection), (built += 1), client),
    });
    const setup = registry.current();
    expect(setup?.operationLeaseMs).toBe(PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT.operationLeaseMs);
    expect(built).toBe(0);

    await expect(setup?.provider.generate(FIXTURE_GENERATION_INPUT)).rejects.toThrow();
    expect(built).toBe(1);
    // Vertex through the runtime identity: a project and a location, never a key.
    expect(connections).toEqual([{ kind: "vertex", project: "fitssai-coach", location: "eu" }]);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0].model).toBe("gemini-3.8-flash");
    expect(client.requests[0].config).toMatchObject({ maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "LOW" }, responseMimeType: "application/json" });
    expect(Object.keys(client.requests[0].config as Record<string, unknown>).sort()).toEqual([
      "maxOutputTokens",
      "responseJsonSchema",
      "responseMimeType",
      "systemInstruction",
      "thinkingConfig",
    ]);
  });
});

describe("a registry over a deployment", () => {
  it("builds nothing until it is asked, and no SDK client until the generator is called", () => {
    let built = 0;
    const registry = createNutritionVertexProviderRegistry(FIXTURE_VERTEX_DEPLOYMENT, {
      createClient: () => ((built += 1), createFakeGoogleGenAiClient([{ reply: {} }])),
    });
    expect(built).toBe(0);
    const setup = registry.current();
    expect(setup?.provider.id).toBe(NUTRITION_VERTEX_PROVIDER_ID);
    expect(setup?.operationLeaseMs).toBe(FIXTURE_VERTEX_DEPLOYMENT.operationLeaseMs);
    expect(built).toBe(0);
    // The answer is kept: a retried transaction asks again and gets the same generator.
    expect(registry.current()).toBe(setup);
  });

  it.each<[string, unknown]>([
    ["no provider configuration", { operationLeaseMs: 60_000 }],
    ["no lease", { provider: FIXTURE_VERTEX_CONFIGURATION }],
    ["a zero lease", { ...FIXTURE_VERTEX_DEPLOYMENT, operationLeaseMs: 0 }],
    ["no location", { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, location: undefined } }],
    ["no project", { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, project: undefined } }],
    ["an API key", { ...FIXTURE_VERTEX_DEPLOYMENT, apiKey: "AIza-not-a-real-key" }],
    ["not an object", "vertex"],
  ])("with %s: an explicit configuration error, and nothing built", (_label, deployment) => {
    let built = 0;
    const registry = createNutritionVertexProviderRegistry(deployment, {
      createClient: () => ((built += 1), createFakeGoogleGenAiClient([{ reply: {} }])),
    });
    expect(() => registry.current()).toThrow(NutritionGenerationProviderConfigurationError);
    expect(built).toBe(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ["thinking level MINIMAL", { thinkingLevel: "MINIMAL" }],
    ["maxOutputTokens above the model's 65,536", { maxOutputTokens: 65_537 }],
    ["maxOutputTokens zero", { maxOutputTokens: 0 }],
  ])("with a setting the model cannot accept (%s): a configuration error, nothing built", (_label, patch) => {
    let built = 0;
    const registry = createNutritionVertexProviderRegistry(
      { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, ...patch } },
      { createClient: () => ((built += 1), createFakeGoogleGenAiClient([{ reply: {} }])) }
    );
    let error: unknown;
    try {
      registry.current();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NutritionGenerationProviderConfigurationError);
    const [field, value] = Object.entries(patch)[0];
    expect((error as Error).message).toContain(`provider.${field}`);
    if (typeof value === "string" || (typeof value === "number" && value > 2)) expect((error as Error).message).not.toContain(String(value));
    expect(built).toBe(0);
  });

  // NUT-12B.1: gemini-3.8-flash takes no custom sampling or candidate count, so
  // a deployment written for the NUT-12B shape is refused, never silently used.
  it.each<[string, Record<string, unknown>]>([
    ["temperature", { temperature: 1 }],
    ["topP", { topP: 0.93 }],
    ["candidateCount", { candidateCount: 1 }],
  ])("a stale deployment whose provider still carries %s: a configuration error, no value exposed, nothing built", (_label, patch) => {
    let built = 0;
    const registry = createNutritionVertexProviderRegistry(
      { ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, ...patch } },
      { createClient: () => ((built += 1), createFakeGoogleGenAiClient([{ reply: {} }])) }
    );
    let error: unknown;
    try {
      registry.current();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NutritionGenerationProviderConfigurationError);
    expect((error as Error).message).toContain("provider");
    for (const leak of ["0.93", "fixture-project", "fixture-location"]) expect((error as Error).message).not.toContain(leak);
    expect(built).toBe(0);
  });

  it("names the fields at fault and none of their values", () => {
    const registry = createNutritionVertexProviderRegistry({ ...FIXTURE_VERTEX_DEPLOYMENT, provider: { ...FIXTURE_VERTEX_CONFIGURATION, location: "" } });
    expect(() => registry.current()).toThrow(/provider\.location/);
    expect(() => registry.current()).not.toThrow(/fixture-project/);
  });

  it("without a deployment answers null — 'not configured', never 'disabled'", () => {
    expect(createNutritionVertexProviderRegistry(null).current()).toBeNull();
    expect(createNutritionVertexProviderRegistry(undefined).current()).toBeNull();
  });
});
