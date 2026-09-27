import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { parseNutritionProfile } from "../../../shared/nutrition";
import { BACKEND_CAPABILITIES } from "../config";
import { DEFAULT_QUOTA_LIMITS, QUOTA_ACTIONS } from "../quota";
import { productionInitialSlotConfiguration } from "./generationInput";
import { productionNutritionGenerationProviderRegistry } from "./providers/productionRegistry";
import { PRODUCTION_PLAN_VALIDATION_POLICIES, productionPlanValidationPolicyRegistry } from "./planValidation/registry";
import { PRODUCTION_TARGET_POLICIES } from "./targetPolicy/registry";

/*
  NUT-11 boundaries on source: the generation infrastructure is deployed, and
  nothing is configured to generate. The test generator never reaches the
  build; no module calls a model, holds a prompt or a secret, takes quota or
  logs a provider's input or output; activation is the one NUT-09 algorithm,
  run inside the finalisation's own transaction; and capabilities stay false.
*/

const FUNCTIONS_ROOT = join(__dirname, "..", "..");

const posix = (value: string) => value.split(/[\\/]/).join("/");
const rel = (file: string) => posix(relative(FUNCTIONS_ROOT, file));
const code = (file: string) =>
  readFileSync(join(FUNCTIONS_ROOT, file), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const walk = (dir: string, pattern: RegExp): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full, pattern);
    return pattern.test(full) ? [full] : [];
  });

/** Exactly the files `npm run build` (tsc -p tsconfig.json) compiles into lib/. */
const builtFiles = (): string[] => {
  const configPath = join(FUNCTIONS_ROOT, "tsconfig.json");
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, FUNCTIONS_ROOT).fileNames.map((file) => posix(file));
};

const GENERATION_MODULES = [
  "src/nutrition/generationCandidate.ts",
  "src/nutrition/generationInput.ts",
  "src/nutrition/generationLifecycle.ts",
  "src/nutrition/generationProvider.ts",
  "src/nutrition/requestPlan.ts",
];
const FAKE_PROVIDER = "src/testing/fakeNutritionPlanProvider.ts";

describe("the test generator stays out of production", () => {
  it("is not among the files the Functions build compiles", () => {
    const built = builtFiles();
    for (const file of GENERATION_MODULES) expect(built.some((path) => path.endsWith(`/${file}`)), file).toBe(true);
    expect(built.some((path) => path.endsWith(`/${FAKE_PROVIDER}`))).toBe(false);
    expect(built.filter((path) => /\/src\/testing\//.test(path))).toEqual([]);
  });

  it("is imported by no file the build compiles", () => {
    const importers = builtFiles().filter((file) => /fakeNutritionPlanProvider|from\s+["'][^"']*testing\//.test(readFileSync(file, "utf-8")));
    expect(importers).toEqual([]);
  });

  it("is not in an existing build output either", () => {
    const lib = join(FUNCTIONS_ROOT, "lib");
    if (!existsSync(lib)) return;
    const emitted = walk(lib, /\.js$/);
    expect(emitted.map(rel).filter((file) => /fakeNutrition|\/testing\//i.test(file))).toEqual([]);
    for (const file of emitted) {
      expect(readFileSync(file, "utf-8"), rel(file)).not.toMatch(/test-fixture-generator|createFakeNutritionPlanProvider|FIXTURE_INITIAL_SLOTS|createFakeGoogleGenAiClient|FIXTURE_VERTEX|fixture-project|fixture-location/);
    }
  });

  it("is not named by the entry point or any generation module", () => {
    for (const file of ["src/index.ts", ...GENERATION_MODULES]) {
      expect(code(file), file).not.toMatch(/fixture|testing|fake/i);
    }
  });

  it("makes no network call and has no prompt, model or secret", () => {
    const fake = code(FAKE_PROVIDER);
    expect(fake).not.toMatch(/fetch\(|https?:|require\(|import\(|@google|genai|openai|anthropic|process\.env|defineSecret/i);
    expect(fake).not.toMatch(/\bprompt\b|\bmodel\b/i);
  });
});

describe("production is unconfigured", () => {
  it("resolves no generator, no plan-validation policy and no first-plan slots, and has no target policy", () => {
    expect(productionNutritionGenerationProviderRegistry.current()).toBeNull();
    expect(Object.isFrozen(productionNutritionGenerationProviderRegistry)).toBe(true);
    expect(productionPlanValidationPolicyRegistry.current()).toBeNull();
    expect(PRODUCTION_PLAN_VALIDATION_POLICIES).toEqual([]);
    expect(PRODUCTION_TARGET_POLICIES).toEqual([]);
    expect(productionInitialSlotConfiguration.slotsFor(3)).toBeNull();
  });

  it("wires the deployed callable to the production registries only, with no secret, quota, operations store or log", () => {
    const index = code("src/index.ts");
    const start = index.indexOf("export const nutritionRequestPlan");
    const wiring = index.slice(start, index.indexOf("export const", start + 1));
    expect(wiring).toContain("handleNutritionRequestPlan(request");
    // NUT-12B: the closed backend gate, before the (lazy, unconfigured) registry.
    expect(wiring).toContain("generationEnabled: NUTRITION_AI_PRODUCTION_ENABLED");
    expect(wiring).toContain("providers: productionNutritionGenerationProviderRegistry");
    expect(wiring).toContain("policies: productionPlanValidationPolicyRegistry");
    expect(wiring).toContain("initialSlots: productionInitialSlotConfiguration");
    expect(wiring).not.toMatch(/secrets|GEMINI|createGeminiProvider|quota|Quota|operations|createFirestoreOperationStore|log\(|Log/);
  });

  it("declares no provider, model or secret for Nutrition anywhere", () => {
    for (const file of [...GENERATION_MODULES, "src/index.ts"]) {
      const source = code(file);
      expect(source, file).not.toMatch(/@google\/genai|generateContent|GEMINI_API_KEY\s*\)|openai|anthropic|fetch\(|https?:\/\//i);
      expect(source, file).not.toMatch(/\bprompt\b|systemInstruction|\bmodelId\b|MODEL_ID/i);
    }
    // The one Gemini secret belongs to Training's callables.
    const index = code("src/index.ts");
    const geminiUsers = [...index.matchAll(/export const (\w+) = onCall\(\s*\{[^}]*secrets: \[GEMINI_API_KEY\]/g)].map((match) => match[1]);
    expect(geminiUsers.sort()).toEqual(["generateWeeklyReview", "generateWorkoutPlan"]);
  });
});

describe("no quota, log or payload for Nutrition generation", () => {
  it("adds no Nutrition quota action or value", () => {
    expect([...QUOTA_ACTIONS]).toEqual(["plan_generation", "weekly_summary"]);
    expect(Object.keys(DEFAULT_QUOTA_LIMITS).sort()).toEqual(["plan_generation", "weekly_summary"]);
    for (const file of GENERATION_MODULES) expect(code(file), file).not.toMatch(/quota|Quota|reserve|consume|release/);
  });

  it.each(GENERATION_MODULES)("%s logs nothing — no console, logger, AI log or telemetry", (file) => {
    expect(code(file)).not.toMatch(/console\.|logger|AiLog|_ai_logs|ai_logs|firebase-functions\/logger|writeEntry|telemetry/i);
  });

  it("persists no prompt, response, payload or provider output: only the request's contract fields", () => {
    const lifecycle = code("src/nutrition/generationLifecycle.ts");
    const candidate = code("src/nutrition/generationCandidate.ts");
    // The candidate step writes nothing at all.
    expect(candidate).not.toMatch(/firestore|\.set\(|\.create\(|\.update\(|collection\(/i);
    // The lifecycle writes the request by its contract and ends it with status fields only.
    expect(lifecycle).not.toMatch(/\b(prompt|response|payload|rawOutput|providerOutput|answer)\s*:/);
    const updates = [...lifecycle.matchAll(/tx\.update\([^{]*\{([^}]*)\}\)/g)].map((match) => match[1].replace(/\s+/g, " ").trim());
    expect(updates).toEqual([
      "status: ended.status, errorCode: ended.errorCode, finishedAt: Timestamp.fromDate(at),",
      'status: "succeeded", resultPlanId: activated.planId, finishedAt: Timestamp.fromDate(at),',
    ]);
    expect(lifecycle).toMatch(/tx\.create\(refs\.generation\(requestId\), \{ \.\.\.created, createdAt: Timestamp\.fromDate\(at\) \}\)/);
  });

  it("never records a generation in the state's request ledger", () => {
    for (const file of GENERATION_MODULES) {
      expect(code(file), file).not.toMatch(/appendNutritionStateRequest|recentRequests:/);
    }
  });
});

describe("one activation algorithm, no nested transaction", () => {
  it("finalises through the transaction-scoped NUT-09 core, never the wrapper that opens its own transaction", () => {
    const lifecycle = code("src/nutrition/generationLifecycle.ts");
    expect(lifecycle).toMatch(/activateNutritionPlanInTransaction\(tx, /);
    expect(lifecycle).not.toMatch(/\bactivateNutritionPlan\(/);
    expect(lifecycle).not.toMatch(/supersedeNutritionPlan|lifecycle:/);
    // One Firestore transaction call, in one helper, used once each by claim, finalize and fail.
    expect([...lifecycle.matchAll(/\.runTransaction\(/g)]).toHaveLength(1);
    expect(lifecycle).toMatch(/\.runTransaction\(body\)/);
    expect([...lifecycle.matchAll(/runTransaction\(ctx\.firestore, /g)]).toHaveLength(3);

    const activation = code("src/nutrition/planActivation.ts");
    expect([...activation.matchAll(/runTransaction/g)]).toHaveLength(2); // the wrapper's type and its one call
    expect(activation).toMatch(/runTransaction\(\(tx\) => activateNutritionPlanInTransaction\(tx, deps, prepared\)\)/);
    // Repeat still uses the wrapper, exactly as before.
    expect(code("src/nutrition/repeatPlan.ts")).toMatch(/activateNutritionPlan\(/);
  });

  it("never writes a slot head, an entry or a target", () => {
    for (const file of GENERATION_MODULES) {
      const source = code(file);
      expect(source, file).not.toMatch(/NUTRITION_V2_COLLECTIONS\.(slots|entries)\b|SUGGESTIONS/);
      expect(source, file).not.toMatch(/tx\.(create|set|update)\(refs\.target/);
    }
  });

  it("mints plan ids and claim tokens once, outside the transactions, on the server", () => {
    const handler = code("src/nutrition/requestPlan.ts");
    expect(handler).toMatch(/newPlanId: \(deps\.newPlanId \?\? randomUUID\)\(\)/);
    const lifecycle = code("src/nutrition/generationLifecycle.ts");
    expect(lifecycle).not.toMatch(/randomUUID|newPlanId\(\)|Math\.random/);
  });

  it("has no cancel", () => {
    for (const file of [...GENERATION_MODULES, "src/index.ts", "../shared/nutrition/generation.ts", "../shared/nutrition/contracts.ts"]) {
      expect(code(file), file).not.toMatch(/cancel|abort|paused|superseded_generation|retrying/i);
    }
  });
});

describe("the profile contract stays as signed", () => {
  it("reads no exclusion vocabulary", () => {
    const view = parseNutritionProfile({ age: 30, excludedFoodCategories: ["a"], excludedFoods: ["b"] });
    expect(Object.keys(view).some((key) => /exclu/i.test(key))).toBe(false);
    expect(code("../shared/nutrition/profile.ts")).not.toMatch(/excludedFood/);
    for (const file of GENERATION_MODULES) expect(code(file), file).not.toMatch(/excludedFood|exclusion\w*\s*[:=]/i);
  });
});

describe("capabilities stay truthful", () => {
  it("claims neither Nutrition generation nor targets", () => {
    expect(BACKEND_CAPABILITIES.nutritionGeneration).toBe(false);
    expect(BACKEND_CAPABILITIES.nutritionTargets).toBe(false);
  });
});
