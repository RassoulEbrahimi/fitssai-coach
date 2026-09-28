import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { NUTRITION_V2_ENABLED } from "@shared/nutrition/featureFlag";

/*
  NUT-05/NUT-06/NUT-07 boundary guard, on source. The Nutrition V2 read layer,
  Today shell, online recording and offline convergence are mounted through
  the dedicated V2 view (NUT-12D). The rollout flag selects the entire tab.
  V2 modules never import legacy Nutrition or read server-only suggestions. The one
  write is the recorded-entry transaction, in exactly one module, reached
  through the recording hook and the offline replay handler only.

  NUT-07's one crossing: the generic offline replay registry
  (offlineHandlers.ts) imports the V2 replay handler. It only ever runs for a
  NUTRITION_ENTRY_WRITE queue entry, and only the V2 recording hook enqueues
  one, so with V2 unreachable it never runs.

  NUT-08 adds the target plumbing: one module calls one function,
  nutritionSetTarget, through one hook, and nothing on the client writes a
  target or the state — the server does.

  NUT-09 adds plan persistence the same way: one more module calls one more
  function, nutritionRepeatPlan, through one hook that no UI uses yet. Nothing
  on the client writes a plan, a slot head or the state, and no plan operation
  is ever queued offline.

  NUT-10 adds slot overrides: one more module calls one more function,
  nutritionUpdateSlot, through one hook used by the Today container. It is
  online-only and never queued, writes nothing to the cache before the server
  confirms, and touches the suggestions key only to drop it after a commit —
  it never reads suggestions.

  NUT-11 adds generation plumbing: one more module calls one more function,
  nutritionRequestPlan, through one hook that no UI uses yet. It is online
  only, never queued, never optimistic and has no cancel. Generation requests
  are read — strictly, by the id a pointer names, never listed — by the read
  layer alone.

  NUT-12D.1 adds the Nutrition profile completion: a pure completeness and
  save planner, and a card and sheet that read and save the existing profile
  through useProfile/useUpdateProfile only — no V2 read, no callable and no
  V2 document.
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
  "src/components/nutrition/v2/NutritionV2Conflicts.tsx",
  "src/components/nutrition/v2/recordingFormat.ts",
  "src/components/nutrition/v2/NutritionV2GenerationStatus.tsx",
  // NUT-08: target plumbing.
  "src/lib/nutrition/v2/targetCallable.ts",
  "src/lib/nutrition/v2/targetSetup.ts",
  "src/lib/nutrition/v2/sha256.ts",
  "src/hooks/queries/useNutritionV2Target.ts",
  "src/components/nutrition/v2/NutritionV2TargetCard.tsx",
  "src/components/nutrition/v2/NutritionV2TargetSetup.tsx",
  "src/components/nutrition/v2/NutritionV2TargetSection.tsx",
  // NUT-09: plan persistence plumbing (no UI).
  "src/lib/nutrition/v2/planCallable.ts",
  "src/hooks/queries/useNutritionV2RepeatPlan.ts",
  // NUT-10: slot overrides.
  "src/lib/nutrition/v2/slotCallable.ts",
  "src/lib/nutrition/v2/slotReplacement.ts",
  "src/hooks/queries/useNutritionV2SlotOverride.ts",
  "src/components/nutrition/v2/NutritionV2SlotReplaceSheet.tsx",
  // NUT-11: generation plumbing (no UI).
  "src/lib/nutrition/v2/generationCallable.ts",
  "src/hooks/queries/useNutritionV2RequestPlan.ts",
  // NUT-12D.1: profile completion.
  "src/lib/nutrition/v2/profileCompletion.ts",
  "src/components/nutrition/v2/NutritionV2ProfileCompletion.tsx",
];

/** NUT-12D.1: the profile completion planner and its card and sheet. */
const profileCompletionModule = "src/lib/nutrition/v2/profileCompletion.ts";
const profileCompletionComponent = "src/components/nutrition/v2/NutritionV2ProfileCompletion.tsx";

/** The one module that calls a function, and the one hook that reaches it (NUT-08). */
const targetCallableModule = "src/lib/nutrition/v2/targetCallable.ts";
const targetHookModule = "src/hooks/queries/useNutritionV2Target.ts";
/** NUT-09: the one module that calls nutritionRepeatPlan, and the one hook that reaches it. */
const planCallableModule = "src/lib/nutrition/v2/planCallable.ts";
const repeatPlanHookModule = "src/hooks/queries/useNutritionV2RepeatPlan.ts";
/** NUT-10: the one module that calls nutritionUpdateSlot, and the one hook that reaches it. */
const slotCallableModule = "src/lib/nutrition/v2/slotCallable.ts";
const slotHookModule = "src/hooks/queries/useNutritionV2SlotOverride.ts";
/** NUT-11: the one module that calls nutritionRequestPlan, and the one hook that reaches it. */
const generationCallableModule = "src/lib/nutrition/v2/generationCallable.ts";
const requestPlanHookModule = "src/hooks/queries/useNutritionV2RequestPlan.ts";
/** NUT-11: the read layer — the only modules that read a generation request. */
const generationReaders = [
  "src/lib/nutrition/v2/integrity.ts",
  "src/lib/nutrition/v2/firestoreReads.ts",
  "src/hooks/queries/useNutritionV2.ts",
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
  it("enables only the V2 UI rollout", () => {
    expect(NUTRITION_V2_ENABLED).toBe(true);
  });

  it("lists only V2 modules that exist, and every V2 client module is listed", () => {
    for (const path of v2Modules) expect(existsSync(resolve(root, path)), path).toBe(true);

    const found = productionSources.filter(
      (path) => path.includes("/nutrition/v2/") || /useNutritionV2\w*\.tsx?$/.test(path)
    );
    expect(found.sort()).toEqual([...v2Modules].sort());
  });

  it("is imported only by the V2 view and replay registry outside V2", () => {
    const importers = productionSources.filter((path) => !v2Modules.includes(path) && IMPORTS_V2_MODULE.test(read(path)));
    expect(importers.sort()).toEqual([replayRegistryModule, "src/views/NutritionV2View.tsx"].sort());

    // And that registry imports the replay handler only.
    const imported = [...read(replayRegistryModule).matchAll(new RegExp(IMPORTS_V2_MODULE.source, "g"))].map(
      (match) => match[1]
    );
    expect(imported).toEqual(["@/lib/nutrition/v2/entryReplay"]);
  });

  it("switches the entire Dashboard nutrition tab at the rollout boundary", () => {
    const dashboard = read("src/components/Dashboard.tsx");
    expect(dashboard).toMatch(/useLegacyNutritionPlan\(\)/);
    expect(dashboard).toMatch(/import\('@\/views\/NutritionView'\)/);
    expect(dashboard).toMatch(/NUTRITION_V2_ENABLED \? <NutritionV2View \/> : <NutritionView/);
    expect(dashboard).not.toMatch(/useNutritionV2/);

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

  it("never reads server-only suggestions, and reads generation requests only in the read layer, by id", () => {
    for (const path of v2Modules) {
      const source = read(path);
      expect(source, path).not.toMatch(/NUTRITION_V2_SUGGESTIONS_COLLECTION|_nutrition_v2_suggestions/);
      // NUT-11: the read layer reads a request by id; the request hook only refetches the generation keys.
      if (!generationReaders.includes(path) && path !== requestPlanHookModule) {
        expect(code(path), path).not.toMatch(/\.generations\b|"generations"|queryKeys\.nutrition\.generation/);
      }
      // NUT-10: the slot hook drops the suggestions key after a commit; nothing reads it.
      const suggestionKeys = [...code(path).matchAll(/queryKeys\.nutrition\.suggestions\w*/g)];
      if (path !== slotHookModule) expect(suggestionKeys, path).toEqual([]);
    }
    const hook = code(slotHookModule);
    expect([...hook.matchAll(/queryKeys\.nutrition\.suggestions\w*/g)]).toHaveLength(1);
    expect(hook).toMatch(
      /removeQueries\(\{\s*queryKey: queryKeys\.nutrition\.suggestions\(uid, request\.planId, request\.date, request\.slotId\),\s*exact: true,\s*\}\)/
    );
    expect(hook).not.toMatch(/useQuery\b|fetchQuery|getQueryData/);
  });

  it("never spells a V2 collection name", () => {
    for (const path of v2Modules) {
      expect(read(path), path).not.toMatch(/["'`]nutrition_v2_\w+["'`]/);
    }
  });

  it("never deletes, batches, patches or adds by auto id", () => {
    for (const path of v2Modules) {
      expect(code(path), path).not.toMatch(/\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch)\b/);
      expect(code(path), path).not.toMatch(/\.(delete|update)\(/);
    }
  });

  it("calls exactly one function, nutritionSetTarget, from one module reached only through the target hook", () => {
    const calling = v2Modules.filter((path) => /\b(httpsCallable|getFunctions)\b/.test(code(path)));
    // NUT-09, NUT-10 and NUT-11 add exactly one more calling module each (below).
    expect(calling.sort()).toEqual([generationCallableModule, planCallableModule, slotCallableModule, targetCallableModule].sort());
    expect(code(targetCallableModule)).toMatch(/httpsCallable<[^>]+>\(\s*getFunctions\(getApp\(\), FUNCTIONS_REGION\),\s*NUTRITION_SET_TARGET_CALLABLE\s*\)/);
    expect([...code(targetCallableModule).matchAll(/\bhttpsCallable\b/g)]).toHaveLength(2); // the import and the one call

    const importers = productionSources.filter((path) => /from\s+["'][^"']*\/targetCallable["']/.test(read(path)));
    expect(importers.sort()).toEqual([targetHookModule, "src/components/nutrition/v2/NutritionV2TargetSetup.tsx"].sort());
    // The setup component imports the error guard only; the call goes through the hook.
    expect(read("src/components/nutrition/v2/NutritionV2TargetSetup.tsx")).not.toMatch(/callNutritionSetTarget/);
  });

  it("sends only { mode, requestId } and refetches only the state and targets after a target is set", () => {
    const hook = code(targetHookModule);
    expect(hook).toMatch(/callNutritionSetTarget\(\{ mode, requestId \}\)/);
    const invalidated = [...hook.matchAll(/queryKey:\s*queryKeys\.nutrition\.([\w.]+)\(/g)].map((match) => match[1]);
    expect(invalidated.sort()).toEqual(["state", "targets.all"]);
    expect(hook).not.toMatch(/\benqueue\(|offlineQueue/);
    expect(hook).not.toMatch(/queryKeys\.(nutritionLegacy|workout|plans?|logs?)\b/);
  });

  it("calls nutritionRepeatPlan from one module, reached only through the repeat hook, which no UI uses yet", () => {
    const plan = code(planCallableModule);
    expect(plan).toMatch(/httpsCallable<[^>]+>\(\s*getFunctions\(getApp\(\), FUNCTIONS_REGION\),\s*NUTRITION_REPEAT_PLAN_CALLABLE\s*\)/);
    expect([...plan.matchAll(/\bhttpsCallable\b/g)]).toHaveLength(2); // the import and the one call
    expect(plan).not.toMatch(/NUTRITION_SET_TARGET_CALLABLE|NUTRITION_UPDATE_SLOT_CALLABLE/);
    expect(code(targetCallableModule)).not.toMatch(/NUTRITION_REPEAT_PLAN_CALLABLE/);

    const importers = productionSources.filter((path) => /from\s+["'][^"']*\/planCallable["']/.test(read(path)));
    expect(importers).toEqual([repeatPlanHookModule]);
    const hookImporters = productionSources.filter((path) => /useNutritionV2RepeatPlan["']/.test(read(path)));
    expect(hookImporters).toEqual([]);
  });

  it("sends only { requestId } and refetches only the state, plans and slot heads after a repeat", () => {
    const hook = code(repeatPlanHookModule);
    expect(hook).toMatch(/callNutritionRepeatPlan\(\{ requestId \}\)/);
    const invalidated = [...hook.matchAll(/queryKey:\s*queryKeys\.nutrition\.([\w.]+)\(/g)].map((match) => match[1]);
    expect(invalidated.sort()).toEqual(["plans.all", "slots.all", "state"]);
    expect(hook).not.toMatch(/\benqueue\(|offlineQueue|NUTRITION_ENTRY_WRITE/);
    expect(hook).not.toMatch(/queryKeys\.(nutritionLegacy|workout|plans?|logs?)\b|nutrition\.(entries|targets)\b/);
  });

  it("calls nutritionUpdateSlot from one module, reached only through the slot hook the Today container uses", () => {
    const slot = code(slotCallableModule);
    expect(slot).toMatch(/httpsCallable<[^>]+>\(\s*getFunctions\(getApp\(\), FUNCTIONS_REGION\),\s*NUTRITION_UPDATE_SLOT_CALLABLE\s*\)/);
    expect([...slot.matchAll(/\bhttpsCallable\b/g)]).toHaveLength(2); // the import and the one call
    expect(slot).not.toMatch(/NUTRITION_SET_TARGET_CALLABLE|NUTRITION_REPEAT_PLAN_CALLABLE/);
    // The strict schema runs before the payload leaves.
    expect(slot).toMatch(/const payload = nutritionUpdateSlotRequestSchema\.parse\(request\);/);

    const sheet = "src/components/nutrition/v2/NutritionV2SlotReplaceSheet.tsx";
    const importers = productionSources.filter((path) => /from\s+["'][^"']*\/slotCallable["']/.test(read(path)));
    expect(importers.sort()).toEqual([slotHookModule, sheet].sort());
    // The sheet imports the error guard only; the call goes through the hook.
    expect(read(sheet)).not.toMatch(/callNutritionUpdateSlot/);

    const hookImporters = productionSources.filter((path) => /useNutritionV2SlotOverride["']/.test(read(path)));
    expect(hookImporters.sort()).toEqual(
      ["src/components/nutrition/v2/NutritionV2TodayContainer.tsx", "src/components/nutrition/v2/NutritionV2TodayRecording.tsx", sheet].sort()
    );
    // Only the container runs the hook; the section and the sheet take its type and error guard.
    const running = hookImporters.filter((path) => /useNutritionV2SlotOverride\(\)/.test(code(path)));
    expect(running).toEqual(["src/components/nutrition/v2/NutritionV2TodayContainer.tsx"]);
  });

  it("a slot action is confirmed, never optimistic, never queued, and refetches only what disagreed", () => {
    const hook = code(slotHookModule);
    expect(hook).not.toMatch(/setQueryData|setQueriesData|onMutate|optimistic/i);
    expect(hook).not.toMatch(/\benqueue\(|offlineQueue|NUTRITION_ENTRY_WRITE|NUTRITION_SLOT/);
    expect(hook).toMatch(/if \(!navigator\.onLine\) return Promise\.reject\(new NutritionV2SlotOverrideUnavailableError\("offline"\)\);/);
    const touched = [...hook.matchAll(/queryKey:\s*queryKeys\.nutrition\.([\w.]+)\(/g)].map((match) => match[1]);
    // Success: the slot heads, and the dropped suggestions key. A refusal: the read that disagreed.
    expect(touched.sort()).toEqual(["entries.all", "plans.all", "slots.byPlan", "slots.byPlan", "state", "suggestions"].sort());
    expect(hook).not.toMatch(/nutrition\.targets|queryKeys\.(nutritionLegacy|workout|plans?|logs?)\b/);
    // The address travels; meal content never does.
    expect(hook).not.toMatch(/\b(kcal|proteinG|carbsG|fatG|values|meal)\b/);
    for (const path of ["src/lib/offlineQueue.ts", "src/lib/offlineReplay.ts", "src/lib/offlineHandlers.ts"]) {
      expect(read(path), path).not.toMatch(/SLOT_WRITE|slotOverride|nutritionUpdateSlot|NUTRITION_SLOT/i);
    }
  });

  it("calls nutritionRequestPlan from one module, reached only through the request hook, which no UI uses yet", () => {
    const generation = code(generationCallableModule);
    // NUT-12C.2: with this callable's own timeout, never the SDK default.
    expect(generation).toMatch(
      /httpsCallable<[^>]+>\(\s*getFunctions\(getApp\(\), FUNCTIONS_REGION\),\s*NUTRITION_REQUEST_PLAN_CALLABLE,\s*\{ timeout: NUTRITION_REQUEST_PLAN_CLIENT_TIMEOUT_MS \}\s*\)/
    );
    expect([...generation.matchAll(/\bhttpsCallable\b/g)]).toHaveLength(2); // the import and the one call
    expect(generation).toMatch(/const payload = nutritionRequestPlanRequestSchema\.parse\(request\);/);
    for (const other of [targetCallableModule, planCallableModule, slotCallableModule]) {
      expect(code(other), other).not.toMatch(/NUTRITION_REQUEST_PLAN_CALLABLE/);
      // The long timeout is this callable's alone.
      expect(code(other), other).not.toMatch(/timeout/i);
    }

    const importers = productionSources.filter((path) => /from\s+["'][^"']*\/generationCallable["']/.test(read(path)));
    expect(importers).toEqual([requestPlanHookModule]);
    const hookImporters = productionSources.filter((path) => /useNutritionV2RequestPlan["']/.test(read(path)));
    expect(hookImporters).toEqual([]);
  });

  it("requests a plan with { requestId } only: online, never queued, never optimistic, no cancel", () => {
    const hook = code(requestPlanHookModule);
    expect(hook).toMatch(/callNutritionRequestPlan\(\{ requestId \}\)/);
    expect(hook).toMatch(/if \(!navigator\.onLine\) throw new NutritionV2RequestPlanUnavailableError\("offline"\);/);
    expect(hook).not.toMatch(/\benqueue\(|offlineQueue|NUTRITION_ENTRY_WRITE|NUTRITION_GENERATION/);
    expect(hook).not.toMatch(/setQueryData|setQueriesData|onMutate|optimistic/i);
    expect(hook).not.toMatch(/cancel|abort|AbortController/i);
    const touched = [...hook.matchAll(/queryKey:\s*queryKeys\.nutrition\.([\w.]+)\(/g)].map((match) => match[1]);
    expect(touched.sort()).toEqual(["generation.all", "plans.all", "slots.all", "state"]);
    expect(hook).not.toMatch(/nutrition\.(entries|targets|suggestions)|queryKeys\.(nutritionLegacy|workout|plans?|logs?)\b/);
    for (const path of ["src/lib/offlineQueue.ts", "src/lib/offlineReplay.ts", "src/lib/offlineHandlers.ts"]) {
      expect(read(path), path).not.toMatch(/nutritionRequestPlan|GENERATION|generation/);
    }
  });

  it("writes through one transaction in one module, reached only through the recording hook", () => {
    const transactional = v2Modules.filter((path) => /\brunTransaction\b/.test(code(path)));
    expect(transactional).toEqual([entryWriterModule]);

    const mutating = v2Modules.filter((path) => /\buseMutation\b/.test(code(path)));
    expect(mutating.sort()).toEqual([recordingHookModule, targetHookModule, repeatPlanHookModule, slotHookModule, requestPlanHookModule].sort());

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
      "src/lib/nutrition/v2/targetSetup.ts",
      "src/lib/nutrition/v2/sha256.ts",
      "src/lib/nutrition/v2/slotReplacement.ts",
      profileCompletionModule,
    ]) {
      expect(read(path), path).not.toMatch(/from\s+["'](firebase\/|@\/lib\/firebase|react|@tanstack)/);
    }
  });

  it("completes the profile through the existing profile hooks only (NUT-12D.1)", () => {
    for (const path of [profileCompletionModule, profileCompletionComponent]) {
      const source = code(path);
      expect(source, path).not.toMatch(/useNutritionV2|Callable|httpsCallable|getFunctions|NUTRITION_V2_COLLECTIONS|queryKeys|useQuery\b|useMutation\b/);
      // Profile answers only: the target mode and a manual calorie target are not part of it.
      expect(source, path).not.toMatch(/nutritionTargetMode|nutrition_target_mode|manualTargetKcal|manual_target_kcal/);
    }
    const component = code(profileCompletionComponent);
    expect(component).toMatch(/useProfile\(\)/);
    expect(component).toMatch(/useUpdateProfile\(\)/);
    const importers = productionSources.filter((path) => /\/NutritionV2ProfileCompletion["']/.test(read(path)));
    expect(importers).toEqual(["src/components/nutrition/v2/NutritionV2TodayContainer.tsx"]);
  });

  it("uses no resolved-day query: a resolved day is derived", () => {
    for (const path of v2Modules) {
      expect(read(path), path).not.toMatch(/queryKeys\.nutrition\.(resolved|day)\b/);
    }
  });
});
