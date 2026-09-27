import { describe, it, expect } from "vitest";
import { FIXTURE_VERTEX_CONFIGURATION, FIXTURE_VERTEX_DEPLOYMENT, createFakeGoogleGenAiClient } from "../../testing/fakeGoogleGenAiClient";
import { NutritionGenerationProviderConfigurationError } from "../generationProvider";
import {
  PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT,
  createNutritionVertexProviderRegistry,
  productionNutritionGenerationProviderRegistry,
} from "./productionRegistry";
import { NUTRITION_VERTEX_PROVIDER_ID } from "./vertexGemini";

/*
  NUT-12B: the deployed generator registry is lazy and unconfigured. Asking it
  is cheap and builds nothing; an incomplete deployment is an explicit error,
  never a defaulted project, location or setting.
*/

describe("the production registry", () => {
  it("has no deployment, so it resolves no generator", () => {
    expect(PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT).toBeNull();
    expect(productionNutritionGenerationProviderRegistry.current()).toBeNull();
    expect(Object.isFrozen(productionNutritionGenerationProviderRegistry)).toBe(true);
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
    ["temperature zero", { temperature: 0 }],
    ["temperature above two", { temperature: 2.5 }],
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
