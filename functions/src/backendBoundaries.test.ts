import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  FORBIDDEN_PROVIDER_FIELDS,
  planGenerationInputSchema,
  type PlanGenerationInput,
} from "./coaching/planGenerationInput";
import { getCoachProvider } from "./coaching/provider";

/*
  PR50 builds the execution layer and nothing else. These guards fail the day
  somebody quietly adds a provider, widens the prompt input to include personal
  data, or teaches the status callable to write to Firestore.
*/

const FUNCTIONS_ROOT = join(__dirname);
const REPO_ROOT = join(__dirname, "..", "..");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.ts$/.test(full) ? [full] : [];
  });

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const backendSources = walk(FUNCTIONS_ROOT).filter(
  (file) => !/\.(test|fixtures)\.ts$/.test(file)
);

const sharedSources = walk(join(REPO_ROOT, "shared"));

const rel = (file: string) => relative(REPO_ROOT, file);

describe("no model provider exists yet", () => {
  it("resolves no provider", () => {
    expect(getCoachProvider()).toBeNull();
  });

  it.each(backendSources.map(rel))("%s names no provider SDK", (file) => {
    const code = stripComments(readFileSync(join(REPO_ROOT, file), "utf-8"));

    expect(code).not.toMatch(/openai|anthropic|@google\/gen|generativeai|mistral|cohere|ollama/i);
    expect(code).not.toMatch(/api\.openai\.com|generativelanguage|api\.anthropic\.com/i);
  });

  it("declares no provider package", () => {
    const pkg = JSON.parse(readFileSync(join(FUNCTIONS_ROOT, "..", "package.json"), "utf-8"));
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    expect(declared).toEqual(
      expect.not.arrayContaining(["openai", "@anthropic-ai/sdk", "@google/generative-ai", "@mistralai/mistralai", "cohere-ai"])
    );
    expect(declared.join(" ")).not.toMatch(/openai|anthropic|generative-ai|mistral|cohere/i);
  });

  it("treats provider output as unknown, so the caller must validate it", () => {
    const source = readFileSync(join(FUNCTIONS_ROOT, "coaching/provider.ts"), "utf-8");

    // A typed plan return would make the provider the validation boundary.
    expect(source).toMatch(/generatePlan\(input: PlanGenerationInput\): Promise<unknown>/);
    expect(source).toMatch(/summariseWeeklyReview\([^)]*\): Promise<unknown>/);
    expect(source).not.toMatch(/Promise<WorkoutPlanContent>/);
  });
});

describe("plan-generation input is minimised", () => {
  const valid: PlanGenerationInput = {
    goal: "gainMuscle",
    experienceLevel: "intermediate",
    equipment: ["dumbbells"],
    daysPerWeek: 3,
    sessionMinutes: 60,
  };

  it("accepts the minimum a coach actually needs", () => {
    expect(planGenerationInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([...FORBIDDEN_PROVIDER_FIELDS])("rejects an input carrying %s", (field) => {
    const parsed = planGenerationInputSchema.safeParse({ ...valid, [field]: "value" });

    // Strict, so a well-meaning caller cannot smuggle personal data through as
    // an extra key that the schema silently strips and the provider still sees.
    expect(parsed.success).toBe(false);
  });

  it("names no personal field in its own shape", () => {
    const keys = Object.keys(planGenerationInputSchema.shape);

    expect(keys.sort()).toEqual([
      "daysPerWeek",
      "equipment",
      "experienceLevel",
      "goal",
      "sessionMinutes",
    ]);
    expect(keys.join(" ")).not.toMatch(/name|mail|uid|height|weight|birth/i);
  });

  it("requires a goal and at least one piece of equipment", () => {
    expect(planGenerationInputSchema.safeParse({ ...valid, equipment: [] }).success).toBe(false);
    expect(
      planGenerationInputSchema.safeParse({ ...valid, goal: "getRipped" }).success
    ).toBe(false);
  });
});

describe("no secret ever reaches the client bundle", () => {
  it.each([...backendSources, ...sharedSources].map(rel))("%s reads no VITE_ variable", (file) => {
    const code = readFileSync(join(REPO_ROOT, file), "utf-8");

    // A VITE_ variable is compiled into the browser bundle and is readable by
    // anyone. A provider key must never be one.
    expect(code).not.toMatch(/VITE_[A-Z_]*(OPENAI|GEMINI|ANTHROPIC|MISTRAL|API_KEY|SECRET|TOKEN)/);
  });

  it.each([...backendSources.map(rel)])("%s hardcodes no key-shaped literal", (file) => {
    const code = stripComments(readFileSync(join(REPO_ROOT, file), "utf-8"));

    expect(code).not.toMatch(/sk-[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}/);
  });
});

describe("the status callable is inert", () => {
  const statusSources = ["src/coaching/status.ts", "src/auth.ts", "src/config.ts", "src/index.ts"];

  it.each(statusSources)("functions/%s performs no Firestore write", (file) => {
    const code = stripComments(readFileSync(join(FUNCTIONS_ROOT, "..", file), "utf-8"));

    expect(code).not.toMatch(/\b(set|add|update|delete)\(|writeBatch|firestore\(\)/);
    expect(code).not.toMatch(/firebase-admin/);
  });

  it.each(statusSources)("functions/%s consumes no quota and writes no log", (file) => {
    const code = stripComments(readFileSync(join(FUNCTIONS_ROOT, "..", file), "utf-8"));

    expect(code).not.toMatch(/createQuotaService|\.consume\(|AiLogWriter|aiLogCollectionPath/);
  });
});

describe("no production data is migrated", () => {
  it.each([...backendSources, ...sharedSources].map(rel))("%s runs no migration", (file) => {
    const code = stripComments(readFileSync(join(REPO_ROOT, file), "utf-8"));
    const declaresMigration = /\b(function|const|let)\s+\w*(migrate|backfill)\w*/i.test(code);

    expect(declaresMigration).toBe(false);
  });

  it("deploys only the targets this repository actually owns", () => {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, "firebase.json"), "utf-8"));

    // Firestore rules became version-controlled in PR54, captured from
    // production and tested against the emulator. Storage and hosting are
    // still nobody's here — GitHub Pages hosts the client — and a target that
    // does not exist cannot be deployed by accident.
    expect(config.firestore).toEqual({ rules: "firestore.rules" });
    expect(config.storage).toBeUndefined();
    expect(config.hosting).toBeUndefined();
    expect(config.database).toBeUndefined();
  });
});
