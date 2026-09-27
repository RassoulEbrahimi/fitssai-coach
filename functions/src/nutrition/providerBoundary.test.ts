import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { nutritionRequestPlanRequestSchema } from "../../../shared/nutrition";
import { NUTRITION_V2_ENABLED } from "../../../shared/nutrition/featureFlag";
import { BACKEND_CAPABILITIES } from "../config";
import { DEFAULT_QUOTA_LIMITS, QUOTA_ACTIONS } from "../quota";
import { NUTRITION_AI_PRODUCTION_ENABLED } from "./aiGate";
import { NUTRITION_SLOT_IDS } from "../../../shared/nutrition";
import { productionInitialSlotConfiguration } from "./generationInput";
import { PRODUCTION_PLAN_VALIDATION_POLICIES, productionPlanValidationPolicyRegistry } from "./planValidation/registry";
import { PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT, productionNutritionGenerationProviderRegistry } from "./providers/productionRegistry";
import { NUTRITION_GEMINI_MODEL_ID } from "./providers/vertexGemini";
import { PRODUCTION_TARGET_POLICIES, productionTargetPolicyRegistry } from "./targetPolicy/registry";

/*
  NUT-12B boundaries on source: a Nutrition Vertex AI adapter exists, and
  nothing can use it. The backend gate is a reviewed `false` that no client,
  environment or registry can move; the deployed callable passes exactly it;
  there is no Nutrition key, secret, quota, log, exclusion vocabulary or
  replacement generator; every policy registry and the first-plan slots stay
  empty; the model id and the SDK stay on the server; and no provider payload
  is persisted.
*/

const FUNCTIONS_ROOT = join(__dirname, "..", "..");
const REPO_ROOT = join(FUNCTIONS_ROOT, "..");
const posix = (value: string) => value.split(/[\\/]/).join("/");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = (file: string) => stripComments(readFileSync(join(FUNCTIONS_ROOT, file), "utf-8"));

const walk = (dir: string, pattern: RegExp): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full, pattern);
    return pattern.test(full) ? [full] : [];
  });

/** Exactly the files `npm run build` compiles into lib/. */
const builtFiles = (): string[] => {
  const { config } = ts.readConfigFile(join(FUNCTIONS_ROOT, "tsconfig.json"), ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, FUNCTIONS_ROOT).fileNames.map(posix);
};

const PROVIDER_MODULES = [
  "src/ai/googleGenai.ts",
  "src/nutrition/aiGate.ts",
  "src/nutrition/providers/productionRegistry.ts",
  "src/nutrition/providers/prompt.ts",
  "src/nutrition/providers/responseContract.ts",
  "src/nutrition/providers/vertexGemini.ts",
];

/** Every production Nutrition module: what the build compiles under src/nutrition/. */
const nutritionModules = walk(join(FUNCTIONS_ROOT, "src", "nutrition"), /\.ts$/)
  .map((file) => posix(relative(FUNCTIONS_ROOT, file)))
  .filter((file) => !/\.test\.ts$/.test(file));

/** The browser's sources: the client app and the shared contracts it bundles — not their tests, which name what they forbid. */
const clientSources = [...walk(join(REPO_ROOT, "src"), /\.(ts|tsx)$/), ...walk(join(REPO_ROOT, "shared"), /\.ts$/)].filter(
  (file) => !/\.test\.(ts|tsx)$/.test(file)
);

describe("the backend AI gate", () => {
  it("is false", () => {
    expect(NUTRITION_AI_PRODUCTION_ENABLED).toBe(false);
  });

  it("is a reviewed literal: no environment, parameter, emulator or test-runner default can move it", () => {
    const gate = code("src/nutrition/aiGate.ts");
    expect(gate.trim()).toBe("export const NUTRITION_AI_PRODUCTION_ENABLED: boolean = false;");
    for (const file of [...nutritionModules, "src/index.ts", "src/config.ts", "src/ai/googleGenai.ts"]) {
      expect(code(file), file).not.toMatch(/process\.env|NODE_ENV|FUNCTIONS_EMULATOR|VITEST|defineBoolean|defineString|defineInt|defineJsonSecret/);
    }
    // Only the entry point and the handler's documentation read the gate; nothing else may assign or derive it.
    const readers = [...nutritionModules, "src/index.ts"].filter((file) => /NUTRITION_AI_PRODUCTION_ENABLED/.test(code(file)));
    expect(readers.sort()).toEqual(["src/index.ts", "src/nutrition/aiGate.ts"]);
  });

  it("is what the deployed callable passes, and the handler requires it explicitly", () => {
    const index = code("src/index.ts");
    expect(index).toMatch(/import \{ NUTRITION_AI_PRODUCTION_ENABLED \} from "\.\/nutrition\/aiGate";/);
    const start = index.indexOf("export const nutritionRequestPlan");
    const wiring = index.slice(start, index.indexOf("export const", start + 1));
    expect([...wiring.matchAll(/generationEnabled:/g)]).toHaveLength(1);
    expect(wiring).toContain("generationEnabled: NUTRITION_AI_PRODUCTION_ENABLED,");
    // Required, with no default in the handler or the lifecycle.
    expect(code("src/nutrition/requestPlan.ts")).toMatch(/^\s*generationEnabled: boolean;$/m);
    expect(code("src/nutrition/requestPlan.ts")).not.toMatch(/generationEnabled\s*\?\?|generationEnabled\s*=\s*true/);
    expect(code("src/nutrition/generationLifecycle.ts")).toMatch(/if \(generationEnabled !== true\) throw new NutritionGenerationError\("NUTRITION_AI_DISABLED"/);
  });

  it("cannot be set by a client: the callable accepts exactly { requestId }, and no client code names the gate", () => {
    const request = { requestId: "3f1a6f28-9c4e-4a1b-8f2d-77c0b5e1a9d4" };
    expect(nutritionRequestPlanRequestSchema.safeParse(request).success).toBe(true);
    for (const extra of ["generationEnabled", "NUTRITION_AI_PRODUCTION_ENABLED", "enabled", "provider", "model", "location", "project"]) {
      expect(nutritionRequestPlanRequestSchema.safeParse({ ...request, [extra]: true }).success, extra).toBe(false);
    }
    for (const file of clientSources) {
      expect(readFileSync(file, "utf-8"), posix(relative(REPO_ROOT, file))).not.toMatch(/NUTRITION_AI_PRODUCTION_ENABLED|generationEnabled/);
    }
  });
});

describe("production stays unconfigured behind the gate", () => {
  it("has no Vertex deployment: no project, location or operational value is chosen", () => {
    expect(PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT).toBeNull();
    expect(productionNutritionGenerationProviderRegistry.current()).toBeNull();
  });

  it("keeps both policy registries and the first-plan slots empty", () => {
    expect(PRODUCTION_TARGET_POLICIES).toEqual([]);
    expect(productionTargetPolicyRegistry.get("manual")).toBeNull();
    expect(productionTargetPolicyRegistry.get("calculated")).toBeNull();
    expect(PRODUCTION_PLAN_VALIDATION_POLICIES).toEqual([]);
    expect(productionPlanValidationPolicyRegistry.current()).toBeNull();
    for (const mealsPerDay of [null, 1, 2, 3, 4, 5, 6]) expect(productionInitialSlotConfiguration.slotsFor(mealsPerDay)).toBeNull();
  });

  it("chooses no Vertex location or project anywhere in code — no region default", () => {
    for (const file of PROVIDER_MODULES) {
      const source = code(file);
      expect(source, file).not.toMatch(/["'`](global|us|eu|us-[a-z]+\d*|europe-[a-z]+\d*|asia-[a-z]+\d*|me-[a-z]+\d*)["'`]/);
      expect(source, file).not.toMatch(/GOOGLE_CLOUD_(PROJECT|LOCATION)|FUNCTIONS_REGION/);
    }
  });

  it("chooses no output cap, thinking level, timeout, attempt count or lease for production", () => {
    const vertex = code("src/nutrition/providers/vertexGemini.ts");
    const registry = code("src/nutrition/providers/productionRegistry.ts");
    // Settings come only from the configuration: no `?? <number>` fallback, no default object.
    expect(vertex).not.toMatch(/\?\?\s*\d|=\s*\{\s*maxOutputTokens|DEFAULT_/);
    expect(vertex).toMatch(/maxOutputTokens: config\.maxOutputTokens,/);
    expect(vertex).toMatch(/config\.timeoutMs/);
    expect(vertex).toMatch(/maxAttempts: config\.maxTransportAttempts/);
    expect(registry).toMatch(/PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT: NutritionVertexDeployment \| null = null;/);
  });

  it("does not claim the capability, and the V2 flag stays off", () => {
    expect(BACKEND_CAPABILITIES.nutritionTargets).toBe(false);
    expect(BACKEND_CAPABILITIES.nutritionGeneration).toBe(false);
    expect(NUTRITION_V2_ENABLED).toBe(false);
  });

  it("changes no Function operational setting: nutritionRequestPlan keeps its timeout and has no secret", () => {
    const index = code("src/index.ts");
    const start = index.indexOf("export const nutritionRequestPlan");
    const wiring = index.slice(start, index.indexOf("export const", start + 1));
    expect(wiring).toMatch(/timeoutSeconds: 30,/);
    expect(wiring).not.toMatch(/secrets|GEMINI_API_KEY|apiKey/);
  });
});

/**
 * NUT-12B.1: request fields `gemini-3.8-flash` does not take. Nutrition-only —
 * Training's `gemini-3.7-flash` config keeps its own sampling and candidate
 * count on purpose, so this is no repository-wide ban.
 */
const GEMINI_38_UNSUPPORTED_FIELDS = ["temperature", "topP", "topK", "candidateCount", "candidate_count", "frequencyPenalty", "presencePenalty"];

/** The object literal passed as `config:` to the adapter's `generateContent` call, braces balanced. */
const generateContentConfig = (source: string): string => {
  const call = source.indexOf(".generateContent(");
  expect(call, "the adapter calls generateContent").toBeGreaterThan(-1);
  const open = source.indexOf("{", source.indexOf("config:", call));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && (depth -= 1) === 0) return source.slice(open, index + 1);
  }
  throw new Error("unbalanced generateContent config");
};

describe("the Nutrition request stays within what gemini-3.8-flash takes (NUT-12B.1)", () => {
  it("the adapter calls generateContent exactly once in source, with exactly the supported config fields", () => {
    const vertex = code("src/nutrition/providers/vertexGemini.ts");
    expect([...vertex.matchAll(/\.generateContent\(/g)]).toHaveLength(1);
    const config = generateContentConfig(vertex);
    expect(config).toMatch(/systemInstruction: NUTRITION_PLAN_SYSTEM_INSTRUCTION,/);
    expect(config).toMatch(/maxOutputTokens: config\.maxOutputTokens,/);
    expect(config).toMatch(/config\.thinkingLevel === null \? \{\} : \{ thinkingConfig: \{ thinkingLevel: config\.thinkingLevel \} \}/);
    expect(config).toMatch(/responseMimeType: "application\/json",/);
    expect(config).toMatch(/responseJsonSchema,/);
    expect(config).toMatch(/abortSignal: signal,/);
    for (const field of GEMINI_38_UNSUPPORTED_FIELDS) expect(config, field).not.toMatch(new RegExp(`\\b${field}\\s*:`));
  });

  it.each(PROVIDER_MODULES.filter((file) => file.startsWith("src/nutrition/")))("%s names no sampling, candidate-count or penalty setting", (file) => {
    const source = readFileSync(join(FUNCTIONS_ROOT, file), "utf-8");
    for (const field of GEMINI_38_UNSUPPORTED_FIELDS) expect(source, field).not.toMatch(new RegExp(`\\b${field}\\b`));
    expect(source).not.toMatch(/TEMPERATURE/);
  });
});

describe("no Nutrition key, secret or client-side configuration", () => {
  it("declares exactly one secret, Training's", () => {
    const index = code("src/index.ts");
    expect([...index.matchAll(/defineSecret\(\s*"(\w+)"\s*\)/g)].map((match) => match[1])).toEqual(["GEMINI_API_KEY"]);
  });

  it.each([...nutritionModules, "src/ai/googleGenai.ts"])("%s holds no API key, secret or credential", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/defineSecret|API_KEY|credentials|googleAuthOptions|keyFile|serviceAccount|AIza[A-Za-z0-9_-]{10,}/);
    if (file !== "src/ai/googleGenai.ts") expect(source).not.toMatch(/apiKey/);
  });

  it("the Vertex connection carries a project and a location, and no key", () => {
    const transport = code("src/ai/googleGenai.ts");
    expect(transport).toMatch(/\| \{ kind: "vertex"; project: string; location: string \}/);
    expect(transport).toMatch(/vertexai: true,\s*project: connection\.project,\s*location: connection\.location,\s*\}/);
  });

  it("the client knows only the public Firebase web config as VITE_ variables — no Google AI key, model, location or Nutrition AI setting", () => {
    const names = new Set<string>();
    for (const file of [...clientSources, join(REPO_ROOT, "vite.config.ts"), join(REPO_ROOT, ".github", "workflows", "deploy.yml")]) {
      for (const match of readFileSync(file, "utf-8").matchAll(/VITE_[A-Z0-9_]+/g)) names.add(match[0]);
    }
    expect([...names].sort()).toEqual([
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_APP_ID",
      "VITE_FIREBASE_AUTH_DOMAIN",
      "VITE_FIREBASE_MESSAGING_SENDER_ID",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_STORAGE_BUCKET",
    ]);
  });
});

describe("the model and the SDK stay on the server", () => {
  it("names the Nutrition model in exactly one module", () => {
    const namers = [...walk(join(FUNCTIONS_ROOT, "src"), /\.ts$/)]
      .map((file) => posix(relative(FUNCTIONS_ROOT, file)))
      .filter((file) => !/\.test\.ts$/.test(file))
      .filter((file) => readFileSync(join(FUNCTIONS_ROOT, file), "utf-8").includes(NUTRITION_GEMINI_MODEL_ID));
    expect(namers).toEqual(["src/nutrition/providers/vertexGemini.ts"]);
  });

  it("no client or shared source names a Gemini model, the SDK or the transport", () => {
    for (const file of clientSources) {
      const source = readFileSync(file, "utf-8");
      const name = posix(relative(REPO_ROOT, file));
      expect(source, name).not.toMatch(/gemini-\d|@google\/genai|googleGenai|vertexGemini|NUTRITION_PLAN_SYSTEM_INSTRUCTION/i);
    }
  });

  it("is not in an existing client bundle either", () => {
    const dist = join(REPO_ROOT, "dist");
    if (!existsSync(dist)) return;
    for (const file of walk(dist, /\.(js|html|json|webmanifest)$/)) {
      const text = readFileSync(file, "utf-8");
      expect(text, posix(relative(REPO_ROOT, file))).not.toMatch(/gemini-3\.8-flash|@google\/genai|responseJsonSchema|aiplatform\.googleapis/);
    }
  });

  it("imports nothing of Coaching into Nutrition", () => {
    for (const file of nutritionModules) expect(code(file), file).not.toMatch(/from\s+["'][^"']*coaching\//);
  });
});

describe("no quota, log, payload, exclusion or replacement generator", () => {
  it("adds no Nutrition quota action or value", () => {
    expect([...QUOTA_ACTIONS]).toEqual(["plan_generation", "weekly_summary"]);
    expect(Object.keys(DEFAULT_QUOTA_LIMITS).sort()).toEqual(["plan_generation", "weekly_summary"]);
    for (const file of [...nutritionModules, "src/ai/googleGenai.ts"]) expect(code(file), file).not.toMatch(/quota|Quota|_ai_quota/);
  });

  it.each(PROVIDER_MODULES)("%s logs nothing and persists nothing", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/console\.|logger|AiLog|_ai_logs|ai_logs|writeEntry|telemetry/i);
    expect(source).not.toMatch(/firestore|firebase-admin|collection\(|\.doc\(|\.set\(|\.create\(|\.update\(|runTransaction/i);
  });

  it("names no exclusion or allergy vocabulary", () => {
    for (const file of PROVIDER_MODULES) {
      expect(code(file), file).not.toMatch(/excludedFood|exclusion|allergen(?!-free)|allergies/i);
    }
    // The only allergy wording is the refusal to promise safety.
    const prompt = code("src/nutrition/providers/prompt.ts");
    expect(prompt).toMatch(/Do not claim that a plan or meal is allergy-safe, allergen-free or medically safe\./);
    expect(prompt).toMatch(/preference to follow, not a guarantee/);
  });

  it("puts no unsigned nutrition number into the system instruction", () => {
    const prompt = code("src/nutrition/providers/prompt.ts");
    expect(prompt).not.toMatch(/%|tolerance|minimum|maximum|at least \d|at most \d|per ?kg|kcal per|\b\d{2,}\s*(kcal|g)\b/i);
  });

  it("adds no replacement generator: no suggestion callable, prompt or candidate count", () => {
    const index = code("src/index.ts");
    expect([...index.matchAll(/^export const (\w+)/gm)].map((match) => match[1])).toEqual([
      "GEMINI_API_KEY",
      "coachBackendStatus",
      "generateWorkoutPlan",
      "generateWeeklyReview",
      "nutritionRequestPlan",
      "nutritionSetTarget",
      "nutritionRepeatPlan",
      "nutritionUpdateSlot",
    ]);
    for (const file of PROVIDER_MODULES) expect(code(file), file).not.toMatch(/suggestion|replacement|candidateSet|suggestionStore/i);
  });

  it("keeps the fake SDK client out of the build", () => {
    const built = builtFiles();
    for (const file of PROVIDER_MODULES) expect(built.some((path) => path.endsWith(`/${file}`)), file).toBe(true);
    expect(built.some((path) => path.endsWith("/src/testing/fakeGoogleGenAiClient.ts"))).toBe(false);
    expect(built.filter((file) => /fakeGoogleGenAiClient|FIXTURE_VERTEX/.test(readFileSync(file, "utf-8")))).toEqual([]);
  });
});

describe("the slot vocabulary stays canonical English", () => {
  it("the response contract uses the canonical slot ids, untranslated", () => {
    expect([...NUTRITION_SLOT_IDS]).toEqual(["breakfast", "lunch", "snack_1", "dinner", "snack_2"]);
    expect(code("src/nutrition/providers/prompt.ts")).toMatch(/Slot ids stay exactly as given; do not translate them\./);
  });
});
