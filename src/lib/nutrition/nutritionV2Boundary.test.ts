import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { NUTRITION_V2_ENABLED } from "@shared/nutrition/featureFlag";

/*
  NUT-05/NUT-06/NUT-07 boundary guard, on source. The Nutrition V2 read layer,
  Today shell, online recording and offline convergence exist, but while
  NUTRITION_V2_ENABLED is false nothing the app mounts may reach their UI: the
  nutrition tab stays on the legacy path. V2 modules never import legacy
  Nutrition and never read the server-only or generation collections. The one
  write is the recorded-entry transaction, in exactly one module, reached
  through the recording hook and the offline replay handler only.

  NUT-07's one crossing: the generic offline replay registry
  (offlineHandlers.ts) imports the V2 replay handler. It only ever runs for a
  NUTRITION_ENTRY_WRITE queue entry, and only the V2 recording hook enqueues
  one, so with V2 unreachable it never runs.
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
  "src/lib/nutrition/v2/nutritionWriteIntents.ts",
  "src/lib/nutrition/v2/entryHandoff.ts",
  "src/lib/nutrition/v2/entryReplay.ts",
  "src/hooks/queries/useNutritionV2.ts",
  "src/hooks/queries/useNutritionV2Recording.ts",
  "src/hooks/queries/useNutritionV2EntryOverlay.ts",
  "src/components/nutrition/v2/NutritionV2TodayShell.tsx",
  "src/components/nutrition/v2/NutritionV2TodayContainer.tsx",
  "src/components/nutrition/v2/NutritionV2TodayRecording.tsx",
  "src/components/nutrition/v2/NutritionV2RecordingSheet.tsx",
  "src/components/nutrition/v2/NutritionV2ConflictNotice.tsx",
  "src/components/nutrition/v2/recordingFormat.ts",
];

/** The only module that writes Firestore, and the only modules that reach it. */
const entryWriterModule = "src/lib/nutrition/v2/entryWriter.ts";
const recordingHookModule = "src/hooks/queries/useNutritionV2Recording.ts";
const replayHandlerModule = "src/lib/nutrition/v2/entryReplay.ts";
/** The one non-V2 production module allowed to import V2 code. */
const replayRegistryModule = "src/lib/offlineHandlers.ts";

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

  it("is not imported by any production module outside the V2 modules, except the replay registry", () => {
    const importers = productionSources.filter((path) => !v2Modules.includes(path) && IMPORTS_V2_MODULE.test(read(path)));
    expect(importers).toEqual([replayRegistryModule]);

    // And that registry imports the replay handler only.
    const imported = [...read(replayRegistryModule).matchAll(new RegExp(IMPORTS_V2_MODULE.source, "g"))].map(
      (match) => match[1]
    );
    expect(imported).toEqual(["@/lib/nutrition/v2/entryReplay"]);
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
    expect(writerImporters.sort()).toEqual([recordingHookModule, replayHandlerModule].sort());
  });

  it("writes only the recorded-entries collection", () => {
    const writer = code(entryWriterModule);
    expect(writer).toMatch(/NUTRITION_V2_COLLECTIONS\.entries\b/);
    expect(writer).not.toMatch(/NUTRITION_V2_COLLECTIONS\.(state|targets|plans|slots|generations)\b/);
    expect(writer).not.toMatch(/nutrition_plans|NUTRITION_LEGACY/);
  });

  it("uses the existing offline queue, never the replay loop, the Training queue hook or the persisted cache", () => {
    for (const path of v2Modules) {
      expect(read(path), path).not.toMatch(/offlineReplay|offlineHandlers|useOfflineQueue|QueryProvider|persistQueryClient/);
    }
    // Only Nutrition entry writes are ever enqueued, and only by the recording hook.
    const enqueuers = v2Modules.filter((path) => /\benqueue\(/.test(code(path)));
    expect(enqueuers).toEqual([recordingHookModule]);
    const enqueued = [...code(recordingHookModule).matchAll(/\benqueue\(\s*"(\w+)"/g)].map((match) => match[1]);
    expect(new Set(enqueued)).toEqual(new Set(["NUTRITION_ENTRY_WRITE"]));
  });

  it("never enables Firestore's own offline persistence", () => {
    for (const path of productionSources) {
      expect(code(path), path).not.toMatch(
        /enableIndexedDbPersistence|enableMultiTabIndexedDbPersistence|persistentLocalCache|persistentMultipleTabManager/
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
      "src/lib/nutrition/v2/nutritionWriteIntents.ts",
      "src/lib/nutrition/v2/entryHandoff.ts",
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
