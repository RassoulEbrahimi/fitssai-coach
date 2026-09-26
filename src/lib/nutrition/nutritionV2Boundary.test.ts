import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { NUTRITION_V2_ENABLED } from "@shared/nutrition/featureFlag";

/*
  NUT-05/NUT-06 boundary guard, on source. The Nutrition V2 read layer, Today
  shell and online recording exist, but while NUTRITION_V2_ENABLED is false
  nothing the app mounts may reach them: the nutrition tab stays on the legacy
  path. V2 modules never import legacy Nutrition, never read the server-only or
  generation collections, and never touch the offline queue. The one write is
  the recorded-entry transaction, in exactly one module, reached through
  exactly one hook.
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

/** Every Nutrition V2 client module (NUT-05 reads and shell, NUT-06 recording). */
const v2Modules = [
  "src/lib/nutrition/v2/integrity.ts",
  "src/lib/nutrition/v2/firestoreReads.ts",
  "src/lib/nutrition/v2/readStatus.ts",
  "src/lib/nutrition/v2/resolvedPlan.ts",
  "src/lib/nutrition/v2/todayView.ts",
  "src/lib/nutrition/v2/dayRecordings.ts",
  "src/lib/nutrition/v2/recording.ts",
  "src/lib/nutrition/v2/entryTransaction.ts",
  "src/lib/nutrition/v2/entryWriter.ts",
  "src/hooks/queries/useNutritionV2.ts",
  "src/hooks/queries/useNutritionV2Recording.ts",
  "src/components/nutrition/v2/NutritionV2TodayShell.tsx",
  "src/components/nutrition/v2/NutritionV2TodayContainer.tsx",
  "src/components/nutrition/v2/NutritionV2TodayRecording.tsx",
  "src/components/nutrition/v2/NutritionV2RecordingSheet.tsx",
  "src/components/nutrition/v2/recordingFormat.ts",
];

/** The only module that writes Firestore, and the only hook that reaches it. */
const entryWriterModule = "src/lib/nutrition/v2/entryWriter.ts";
const recordingHookModule = "src/hooks/queries/useNutritionV2Recording.ts";

/** Source without comments, so prose about a write is not mistaken for one. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const IMPORTS_V2_MODULE =
  /from\s+["'](@\/hooks\/queries\/useNutritionV2|@\/lib\/nutrition\/v2\/[^"']+|@\/components\/nutrition\/v2\/[^"']+|\.{1,2}\/[^"']*nutrition\/v2[^"']*)["']/;

describe("Nutrition V2 reachability", () => {
  it("keeps the feature flag off", () => {
    expect(NUTRITION_V2_ENABLED).toBe(false);
  });

  it("lists only V2 modules that exist, and every V2 client module is listed", () => {
    for (const path of v2Modules) expect(existsSync(resolve(root, path)), path).toBe(true);

    const found = productionSources.filter(
      (path) => path.includes("/nutrition/v2/") || /useNutritionV2\w*\.tsx?$/.test(path)
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

  it("never deletes, batches, patches, adds by auto id or calls a function", () => {
    for (const path of v2Modules) {
      expect(code(path), path).not.toMatch(/\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|httpsCallable)\b/);
      expect(code(path), path).not.toMatch(/\.(delete|update)\(/);
    }
  });

  it("writes through one transaction in one module, reached only through the recording hook", () => {
    const transactional = v2Modules.filter((path) => /\brunTransaction\b/.test(code(path)));
    expect(transactional).toEqual([entryWriterModule]);

    const mutating = v2Modules.filter((path) => /\buseMutation\b/.test(code(path)));
    expect(mutating).toEqual([recordingHookModule]);

    const writerImporters = productionSources.filter((path) => /from\s+["'][^"']*\/entryWriter["']/.test(read(path)));
    expect(writerImporters).toEqual([recordingHookModule]);
  });

  it("writes only the recorded-entries collection", () => {
    const writer = code(entryWriterModule);
    expect(writer).toMatch(/NUTRITION_V2_COLLECTIONS\.entries\b/);
    expect(writer).not.toMatch(/NUTRITION_V2_COLLECTIONS\.(state|targets|plans|slots|generations)\b/);
    expect(writer).not.toMatch(/nutrition_plans|NUTRITION_LEGACY/);
  });

  it("never touches the offline queue, replay or persisted cache", () => {
    for (const path of v2Modules) {
      expect(read(path), path).not.toMatch(
        /offlineQueue|offlineReplay|offlineHandlers|useOfflineQueue|QueryProvider|persistQueryClient/
      );
    }
  });

  it("keeps the pure read model and recording builders free of Firestore and React", () => {
    for (const path of [
      "src/lib/nutrition/v2/integrity.ts",
      "src/lib/nutrition/v2/readStatus.ts",
      "src/lib/nutrition/v2/resolvedPlan.ts",
      "src/lib/nutrition/v2/todayView.ts",
      "src/lib/nutrition/v2/dayRecordings.ts",
      "src/lib/nutrition/v2/recording.ts",
      "src/lib/nutrition/v2/entryTransaction.ts",
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
