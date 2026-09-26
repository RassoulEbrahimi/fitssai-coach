import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { NUTRITION_V2_ENABLED } from "@shared/nutrition/featureFlag";

/*
  NUT-05 boundary guard, on source. The Nutrition V2 read layer and Today shell
  exist, but while NUTRITION_V2_ENABLED is false nothing the app mounts may
  reach them: the nutrition tab stays on the legacy path. V2 modules never
  import legacy Nutrition, never read the server-only or generation
  collections, and never write.
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
const isTest = (path: string) => /\.test\.tsx?$/.test(path) || path.startsWith("src/test/");
const productionSources = sourceFiles("src").filter((path) => path !== thisFile && !isTest(path));

/** Every Nutrition V2 client module added by NUT-05. */
const v2Modules = [
  "src/lib/nutrition/v2/integrity.ts",
  "src/lib/nutrition/v2/firestoreReads.ts",
  "src/lib/nutrition/v2/readStatus.ts",
  "src/lib/nutrition/v2/resolvedPlan.ts",
  "src/lib/nutrition/v2/todayView.ts",
  "src/hooks/queries/useNutritionV2.ts",
  "src/components/nutrition/v2/NutritionV2TodayShell.tsx",
  "src/components/nutrition/v2/NutritionV2TodayContainer.tsx",
];

const IMPORTS_V2_MODULE =
  /from\s+["'](@\/hooks\/queries\/useNutritionV2|@\/lib\/nutrition\/v2\/[^"']+|@\/components\/nutrition\/v2\/[^"']+|\.{1,2}\/[^"']*nutrition\/v2[^"']*)["']/;

describe("Nutrition V2 reachability", () => {
  it("keeps the feature flag off", () => {
    expect(NUTRITION_V2_ENABLED).toBe(false);
  });

  it("lists only V2 modules that exist, and every V2 client module is listed", () => {
    for (const path of v2Modules) expect(existsSync(resolve(root, path)), path).toBe(true);

    const found = productionSources.filter(
      (path) => path.includes("/nutrition/v2/") || /useNutritionV2\.tsx?$/.test(path)
    );
    expect(found.sort()).toEqual([...v2Modules].sort());
  });

  it("is not imported by any production module outside the V2 modules", () => {
    const importers = productionSources.filter((path) => !v2Modules.includes(path) && IMPORTS_V2_MODULE.test(read(path)));

    expect(importers).toEqual([]);
  });

  it("leaves the Dashboard nutrition tab on the legacy path", () => {
    const dashboard = read("src/components/Dashboard.tsx");
    expect(dashboard).toMatch(/useLegacyNutritionPlan\(\)/);
    expect(dashboard).toMatch(/import\('@\/views\/NutritionView'\)/);
    expect(dashboard).not.toMatch(/NutritionV2|nutrition\/v2|useNutritionV2|NUTRITION_V2_ENABLED/);

    expect(read("src/views/NutritionView.tsx")).toMatch(/<LegacyNutritionPlanView\b/);
  });
});

describe("Nutrition V2 module boundary", () => {
  it("never imports legacy Nutrition", () => {
    for (const path of v2Modules) {
      expect(read(path), path).not.toMatch(
        /nutrition\/legacy|useLegacyNutritionPlan|LegacyNutritionPlan|NUTRITION_LEGACY_PLANS_COLLECTION|nutrition_plans/
      );
    }
  });

  it("never reads server-only suggestions or generation requests", () => {
    for (const path of v2Modules) {
      const source = read(path);
      expect(source, path).not.toMatch(/NUTRITION_V2_SUGGESTIONS_COLLECTION|_nutrition_v2_suggestions/);
      expect(source, path).not.toMatch(/\.generations\b|queryKeys\.nutrition\.(generation|suggestions)/);
    }
  });

  it("never spells a V2 collection name", () => {
    for (const path of v2Modules) {
      expect(read(path), path).not.toMatch(/["'`]nutrition_v2_\w+["'`]/);
    }
  });

  it("has no write path", () => {
    for (const path of v2Modules) {
      expect(read(path), path).not.toMatch(
        /\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction|useMutation|httpsCallable)\b/
      );
    }
  });

  it("keeps the pure read model free of Firestore and React", () => {
    for (const path of [
      "src/lib/nutrition/v2/integrity.ts",
      "src/lib/nutrition/v2/readStatus.ts",
      "src/lib/nutrition/v2/resolvedPlan.ts",
      "src/lib/nutrition/v2/todayView.ts",
    ]) {
      expect(read(path), path).not.toMatch(/from\s+["'](firebase\/|@\/lib\/firebase|react|@tanstack)/);
    }
  });

  it("uses no resolved-day query: a resolved day is derived", () => {
    for (const path of v2Modules) {
      expect(read(path), path).not.toMatch(/queryKeys\.nutrition\.(resolved|day)\b/);
    }
  });
});
