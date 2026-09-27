import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { BACKEND_CAPABILITIES } from "../config";
import {
  PRODUCTION_PLAN_VALIDATION_POLICIES,
  productionPlanValidationPolicyRegistry,
} from "./planValidation/registry";

/*
  NUT-09 boundaries on source: fixture plan-validation policies can never
  reach the deployed backend, the production validation seam carries no
  threshold, plans are only ever created (and superseded by their lifecycle
  field alone), and repeat reads the base plan only.
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

const PLAN_MODULES = [
  "src/nutrition/planActivation.ts",
  "src/nutrition/repeatPlan.ts",
  "src/nutrition/stateLedger.ts",
  "src/nutrition/planValidation/decide.ts",
  "src/nutrition/planValidation/registry.ts",
  "src/nutrition/planValidation/types.ts",
];

describe("fixture plan-validation policies stay out of production", () => {
  it("are not among the files the Functions build compiles", () => {
    const built = builtFiles();
    expect(built.some((file) => file.endsWith("/src/nutrition/planActivation.ts"))).toBe(true);
    expect(built.filter((file) => /\/src\/testing\//.test(file))).toEqual([]);
    expect(built.filter((file) => /\.test\.ts$/.test(file))).toEqual([]);
  });

  it("are imported by no file the build compiles", () => {
    const importers = builtFiles().filter((file) => /from\s+["'][^"']*testing\//.test(readFileSync(file, "utf-8")));
    expect(importers).toEqual([]);
  });

  it("are not in an existing build output either", () => {
    const lib = join(FUNCTIONS_ROOT, "lib");
    if (!existsSync(lib)) return;
    const emitted = walk(lib, /\.js$/);
    expect(emitted.map(rel).filter((file) => /\/testing\/|fixture/i.test(file))).toEqual([]);
    for (const file of emitted) {
      expect(readFileSync(file, "utf-8"), rel(file)).not.toMatch(/test-fixture-|FIXTURE_\w+_POLICY/);
    }
  });

  it("are not named by the entry point or any plan module", () => {
    for (const file of ["src/index.ts", ...PLAN_MODULES]) {
      expect(code(file), file).not.toMatch(/fixture|testing/i);
    }
  });

  it("the deployed callable is wired to the production validation registry only", () => {
    const index = code("src/index.ts");
    const wiring = index.slice(index.indexOf("export const nutritionRepeatPlan"));
    expect(wiring).toContain("handleNutritionRepeatPlan(request");
    expect(wiring).toContain("policies: productionPlanValidationPolicyRegistry");
    expect(wiring).not.toMatch(/secrets|GEMINI|provider|Provider|quota|Quota|operations|log\(|Log/);
  });
});

describe("the production plan-validation seam", () => {
  it("contains zero policies and resolves none", () => {
    expect(PRODUCTION_PLAN_VALIDATION_POLICIES).toEqual([]);
    expect(Object.isFrozen(PRODUCTION_PLAN_VALIDATION_POLICIES)).toBe(true);
    expect(productionPlanValidationPolicyRegistry.current()).toBeNull();
  });

  it.each(PLAN_MODULES)("%s names no nutrition threshold, tolerance or ratio", (file) => {
    const source = code(file);
    expect(source).not.toMatch(
      /\b(tolerances?|deviations?|thresholds?|percent(age)?|ratios?|bounds?|limits?)\b|\bmin(Kcal|Protein|Calories)|\bmax(Kcal|Calories)/i
    );
    expect(source).not.toMatch(/proteinG\s*[<>]=?|kcal\s*[<>]=?|carbsG\s*[<>]=?|fatG\s*[<>]=?/);
  });

  it.each(PLAN_MODULES)("%s uses no provider, quota, AI operation record, clock or logging of its own", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/_ai_operations|OPERATION_COLLECTION|createFirestoreOperationStore/);
    expect(source).not.toMatch(/quota|provider|gemini|AiLog|console\./i);
    expect(source).not.toMatch(/Math\.random/);
  });

  it("policies are pure: the seam gives them no Firestore, auth or clock", () => {
    for (const file of ["src/nutrition/planValidation/types.ts", "src/nutrition/planValidation/decide.ts"]) {
      expect(code(file), file).not.toMatch(/firebase-admin|firestore|requireAuth|new Date|Date\.now/i);
    }
  });
});

describe("plan writes", () => {
  it("creates a plan with tx.create and never sets, merges or deletes one", () => {
    const source = code("src/nutrition/planActivation.ts");
    expect(source).toMatch(/tx\.create\(planRef\(planId\), \{ \.\.\.plan, createdAt: at, activatedAt: at \}\)/);
    expect(source).not.toMatch(/merge/);
    expect(source).not.toMatch(/\.delete\(/);
    expect([...source.matchAll(/tx\.set\(/g)]).toHaveLength(1);
    expect(source).toMatch(/tx\.set\(stateRef, nextState\)/);
  });

  it("supersedes the old plan by writing its lifecycle field only, after assertPlanTransition", () => {
    const source = code("src/nutrition/planActivation.ts");
    const updates = [...source.matchAll(/tx\.update\(([^;]*)\);/g)].map((match) => match[1]);
    expect(updates).toEqual(["planRef(previous.planId), { lifecycle: superseded.lifecycle }"]);
    // supersedeNutritionPlan runs assertPlanTransition before returning.
    expect(source).toMatch(/supersedeNutritionPlan\(previous, \{ planId, startDate: plan\.startDate \}\)/);
    expect(code("../shared/nutrition/plan.ts")).toMatch(/assertPlanTransition\(plan, superseded\);\s*return superseded;/);
  });

  it("has one activation transaction, used by repeat; repeat opens none of its own", () => {
    const activation = code("src/nutrition/planActivation.ts");
    const repeat = code("src/nutrition/repeatPlan.ts");
    expect([...activation.matchAll(/runTransaction/g)]).toHaveLength(2); // the type and the one call
    expect(repeat).not.toMatch(/runTransaction|\.create\(|\.set\(|\.update\(/);
    expect(repeat).toMatch(/activateNutritionPlan\(/);
  });

  it("repeat and activation read no slot head, override, entry or generation", () => {
    for (const file of ["src/nutrition/planActivation.ts", "src/nutrition/repeatPlan.ts"]) {
      const source = code(file);
      expect(source, file).not.toMatch(/NUTRITION_V2_COLLECTIONS\.(slots|entries|generations)\b/);
      expect(source, file).not.toMatch(/SUGGESTIONS|nutrition_v2_\w+/);
    }
  });
});

describe("capabilities stay truthful", () => {
  it("repeat plumbing claims neither Nutrition targets nor generation", () => {
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
