import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { BACKEND_CAPABILITIES } from "../config";

/*
  NUT-10 boundaries on source: the slot callable writes only the slot head and
  a suggestion candidate's consumption; no production module generates or
  seeds a suggestion, calls a provider or picks a suggestion lifetime; fixture
  suggestion sets never reach the build.
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

const SLOT_MODULES = ["src/nutrition/updateSlot.ts", "src/nutrition/suggestionStore.ts"];
const SHARED_SLOT_MODULES = ["../shared/nutrition/slotOverride.ts", "../shared/nutrition/contracts.ts"];

describe("fixture suggestion sets stay out of production", () => {
  it("are not among the files the Functions build compiles", () => {
    const built = builtFiles();
    expect(built.some((file) => file.endsWith("/src/nutrition/updateSlot.ts"))).toBe(true);
    expect(built.some((file) => file.endsWith("/src/nutrition/suggestionStore.ts"))).toBe(true);
    expect(built.filter((file) => /nutritionSuggestionFixtures|\/src\/testing\//.test(file))).toEqual([]);
  });

  it("are imported by no file the build compiles", () => {
    const importers = builtFiles().filter((file) =>
      /from\s+["'][^"']*(testing\/|nutritionSuggestionFixtures)/.test(readFileSync(file, "utf-8"))
    );
    expect(importers).toEqual([]);
  });

  it("are not in an existing build output either", () => {
    const lib = join(FUNCTIONS_ROOT, "lib");
    if (!existsSync(lib)) return;
    const emitted = walk(lib, /\.js$/);
    expect(emitted.map(rel).filter((file) => /\/testing\/|fixture/i.test(file))).toEqual([]);
    for (const file of emitted) {
      expect(readFileSync(file, "utf-8"), rel(file)).not.toMatch(/Fixture suggestion|test-fixture-replacement|seedFixtureSuggestionSet/);
    }
  });

  it("are not named by the entry point or any slot module", () => {
    for (const file of ["src/index.ts", ...SLOT_MODULES]) {
      expect(code(file), file).not.toMatch(/fixture|testing/i);
    }
  });
});

describe("no production suggestion source", () => {
  it("exports no callable that creates, seeds or generates suggestions", () => {
    const index = code("src/index.ts");
    const exported = [...index.matchAll(/export const (\w+)\s*=\s*onCall/g)].map((match) => match[1]);
    expect(exported.sort()).toEqual(
      ["coachBackendStatus", "generateWeeklyReview", "generateWorkoutPlan", "nutritionRepeatPlan", "nutritionSetTarget", "nutritionUpdateSlot"].sort()
    );
    expect(index).not.toMatch(/storeReplacementSuggestionSet|suggestionStore/);
  });

  it("the deployed slot callable is wired to Firestore alone", () => {
    const index = code("src/index.ts");
    const wiring = index.slice(index.indexOf("export const nutritionUpdateSlot"));
    expect(wiring).toContain("handleNutritionUpdateSlot(request, { firestore: db() })");
    expect(wiring).not.toMatch(/secrets|GEMINI|provider|Provider|quota|Quota|operations|log\(|Log/);
  });

  it.each([...SLOT_MODULES, ...SHARED_SLOT_MODULES])("%s calls no provider, prompt, quota or AI operation record", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/gemini|@google\/genai|generateContent|prompt|quota|_ai_operations|createFirestoreOperationStore|AiLog|console\./i);
    expect(source).not.toMatch(/Math\.random/);
  });

  it("suggestion sets live only in the top-level server-only collection, filed under {uid}__{setId}", () => {
    const store = code("src/nutrition/suggestionStore.ts");
    expect(store).toMatch(/firestore\.collection\(NUTRITION_V2_SUGGESTIONS_COLLECTION\)\.doc\(suggestionSetDocId\(uid, suggestionSetId\)\)/);
    expect(store).toMatch(/`\$\{uid\}__\$\{suggestionSetId\}`/);
    // Never under /users, where the owner wildcard would reach.
    for (const file of SLOT_MODULES) expect(code(file), file).not.toMatch(/collection\("users"\)[^;]*SUGGESTIONS/);
  });

  it("the storage helper is imported by the slot callable (for its path) and by nothing else in production", () => {
    const importers = builtFiles().filter((file) => /from\s+["']\.\/suggestionStore["']/.test(readFileSync(file, "utf-8")));
    expect(importers.map((file) => file.slice(file.indexOf("/src/") + 1))).toEqual(["src/nutrition/updateSlot.ts"]);
    expect(code("src/nutrition/updateSlot.ts")).toMatch(/import \{ suggestionSetRef \} from "\.\/suggestionStore";/);
  });
});

describe("no suggestion lifetime is chosen", () => {
  it.each([...SLOT_MODULES, ...SHARED_SLOT_MODULES, "src/index.ts"])("%s hard-codes no TTL duration", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/\bttl\b|timeToLive|expiresIn|lifetime\s*[:=]|DURATION|_MS\b|_SECONDS\b|_MINUTES\b|_HOURS\b/i);
    expect(source).not.toMatch(/\b(60|3600|86400|86_400|3_600|900|300)\s*\*|\*\s*(60|1000|3600)\b/);
    expect(source).not.toMatch(/set(Minutes|Hours|Seconds|Date)\(|addMinutes|addHours|Date\.now\(\)\s*\+/);
  });

  it("the storage helper requires the caller's expiresAt and defaults none", () => {
    const source = code("src/nutrition/suggestionStore.ts");
    expect(source).toMatch(/expiresAt: Date;/);
    expect(source).not.toMatch(/expiresAt\?|expiresAt \?\?|expiresAt = /);
  });

  it("the repository configures no Firestore TTL policy (it is TTL-ready, not TTL-enabled)", () => {
    const indexes = join(FUNCTIONS_ROOT, "..", "firestore.indexes.json");
    if (!existsSync(indexes)) return;
    expect(readFileSync(indexes, "utf-8")).not.toMatch(/"ttl"\s*:\s*true/);
  });
});

describe("slot writes", () => {
  it("write the slot head (created when new) and a candidate's consumption — nothing else", () => {
    const source = code("src/nutrition/updateSlot.ts");
    expect([...source.matchAll(/tx\.(create|set|update)\(([^,]+),/g)].map((match) => `${match[1]} ${match[2]}`)).toEqual([
      "create headRef",
      "set headRef",
      "update ref",
    ]);
    expect(source).toMatch(/tx\.update\(ref, \{\s*candidates:/);
    expect(source).not.toMatch(/merge|\.delete\(|FieldValue/);
    expect([...source.matchAll(/runTransaction/g)]).toHaveLength(2); // the type and the one call
  });

  it("never writes a plan, the state, a target, an entry or a generation", () => {
    const source = code("src/nutrition/updateSlot.ts");
    expect(source).not.toMatch(/NUTRITION_V2_COLLECTIONS\.(state|targets|generations)\b/);
    // Plans and entries are only read: the plan by query, the entry by id.
    const planRefs = [...source.matchAll(/NUTRITION_V2_COLLECTIONS\.(plans|entries|slots)\b/g)].map((match) => match[1]);
    expect(planRefs.sort()).toEqual(["entries", "plans", "slots"]);
    expect(source).not.toMatch(/tx\.(create|set|update)\((plansQuery|entryRef)/);
    expect(source).not.toMatch(/activateNutritionPlan|supersedeNutritionPlan/);
  });

  it("mints ids once, outside the transaction, from the server only", () => {
    const source = code("src/nutrition/updateSlot.ts");
    const transaction = source.slice(source.indexOf(".runTransaction("));
    expect(transaction).not.toMatch(/newId\(|randomUUID/);
    expect(source).toMatch(/const overrideId = request\.action === "commit" \? newId\(\) : null;/);
  });
});

describe("capabilities stay truthful", () => {
  it("slot overrides claim neither Nutrition targets nor generation, and add no capability", () => {
    expect(BACKEND_CAPABILITIES.nutritionTargets).toBe(false);
    expect(BACKEND_CAPABILITIES.nutritionGeneration).toBe(false);
    expect(Object.keys(BACKEND_CAPABILITIES).sort()).toEqual([
      "nutritionGeneration",
      "nutritionTargets",
      "planGeneration",
      "weeklySummaryAI",
    ]);
  });
});
