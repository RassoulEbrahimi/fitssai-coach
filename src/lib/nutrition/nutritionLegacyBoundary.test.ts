import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";

/*
  NUT-04 boundary guard. Legacy Nutrition (`nutrition_plans`) and Nutrition V2
  are separate concepts: the legacy model is named as legacy, legacy code never
  imports the V2 contracts, and the old ambiguous names are gone. These are
  assertions on source, so they fail the moment the overlap is reintroduced.
*/

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const sourceFiles = (dir: string): string[] =>
  readdirSync(resolve(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(resolve(root, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path.replace(/\\/g, "/")] : [];
  });

const thisFile = relative(root, __filename).replace(/\\/g, "/");
const clientSources = sourceFiles("src").filter((path) => path !== thisFile);

/** Every client module that handles legacy Nutrition data. */
const legacyConsumers = [
  "src/lib/nutrition/legacy.ts",
  "src/hooks/queries/useLegacyNutritionPlan.ts",
  "src/components/nutrition/LegacyNutritionPlanView.tsx",
  "src/views/NutritionView.tsx",
  "src/views/HomeView.tsx",
  "src/views/ProfileView.tsx",
  "src/components/Dashboard.tsx",
  "src/pages/AdminPanel.tsx",
];

/** Imports that can bring the V2 `NutritionPlan` (and the rest of the V2 contracts). */
const V2_CONTRACT_IMPORT = /from\s+["'](@shared\/nutrition(\/index|\/contracts)?|[./]*shared\/nutrition(\/index|\/contracts)?)["']/;

const importsLegacy = (source: string) => /from\s+["']@\/lib\/nutrition\/legacy["']/.test(source);

describe("legacy Nutrition naming and import boundary", () => {
  it("lists only legacy consumers that exist", () => {
    for (const path of legacyConsumers) {
      expect(existsSync(resolve(root, path)), path).toBe(true);
    }
  });

  it("keeps the V2 contracts out of every legacy consumer", () => {
    for (const path of legacyConsumers) {
      const source = read(path);
      expect(source, path).not.toMatch(V2_CONTRACT_IMPORT);
      // `LegacyNutritionPlan` is fine; the bare V2 name is not.
      expect(source, path).not.toMatch(/\bNutritionPlan\b/);
      expect(source, path).not.toMatch(/\bNutritionMeal\b/);
    }
  });

  it("has no client module that imports both the legacy model and the V2 contracts", () => {
    const both = clientSources.filter((path) => {
      const source = read(path);
      return importsLegacy(source) && V2_CONTRACT_IMPORT.test(source);
    });

    expect(both).toEqual([]);
  });

  it("keeps the legacy model free of any import", () => {
    expect(read("src/lib/nutrition/legacy.ts")).not.toMatch(/^\s*import\b/m);
  });

  it("removes the ambiguous legacy NutritionPlan and NutritionMeal from src/lib/types.ts", () => {
    const types = read("src/lib/types.ts");

    expect(types).not.toMatch(/\bNutritionPlan\b/);
    expect(types).not.toMatch(/\bNutritionMeal\b/);
  });

  it("removes the old useNutritionPlan hook and every import of it", () => {
    expect(existsSync(resolve(root, "src/hooks/queries/useNutritionPlan.ts"))).toBe(false);

    const importers = clientSources.filter((path) => /\buseNutritionPlan\b/.test(read(path)));
    expect(importers).toEqual([]);
  });

  it("spells the legacy collection name only in the shared collection constants", () => {
    const literal = /["']nutrition_plans["']/;
    const spelled = clientSources.filter((path) => !/\.test\.tsx?$/.test(path) && literal.test(read(path)));

    expect(spelled).toEqual([]);
  });
});
