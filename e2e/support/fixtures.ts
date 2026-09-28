import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test as base } from "@playwright/test";
import type { Firestore } from "../../functions/node_modules/firebase-admin/lib/firestore/index";
import { expectNoProductionTraffic, guardNetwork, readSeedSummary, type NetworkLog } from "./browser";
import { deleteEmulatorAdmin, initEmulatorAdmin } from "./emulatorAdmin";
import { requireLocalEmulatorEnv, type LocalEmulatorEnv } from "./emulatorEnv";
import { runNutritionSeed } from "./globalSetup";
import { readPersistedNutritionV2, type PersistedNutritionV2 } from "./nutritionState";
import { E2E_LOCAL_DIR } from "./processEnv";
import type { NutritionSeedSummary } from "./seedNutrition";

/**
 * The NUT-13B test fixture.
 *
 *   seed     (auto) the emulators are reset and seeded again before EVERY
 *            test, with the NUT-13A seed — so no test depends on another's
 *            mutations or on the order tests run in
 *   network  (auto) the NUT-13A network guard on the test's browser context;
 *            after the test, any request that tried to leave the local
 *            emulator boundary, or an emulator request naming the production
 *            project, fails it
 *   persisted  reads one account's Nutrition V2 documents from the Firestore
 *            emulator through the strict shared schemas
 *   env      the checked local emulator environment
 */
export const test = base.extend<
  { seed: NutritionSeedSummary; network: NetworkLog; persisted: (uid: string) => Promise<PersistedNutritionV2> },
  { env: LocalEmulatorEnv; adminDb: Firestore }
>({
  // Playwright requires the destructuring pattern even when no fixture is used.
  // eslint-disable-next-line no-empty-pattern
  env: [async ({}, provide) => provide(requireLocalEmulatorEnv(process.env)), { scope: "worker" }],
  adminDb: [
    async ({ env }, provide) => {
      const { app, db } = initEmulatorAdmin(env, "fitssai-nutrition-e2e-tests");
      await provide(db);
      await deleteEmulatorAdmin(app);
    },
    { scope: "worker" },
  ],
  seed: [
    async ({ env }, provide) => {
      void env;
      runNutritionSeed({ quiet: true });
      await provide(readSeedSummary());
    },
    { auto: true },
  ],
  network: [
    async ({ context, seed }, provide, testInfo) => {
      void seed;
      const log = await guardNetwork(context);
      await provide(log);
      // Evidence: every host:port the browser reached, and what was blocked.
      const dir = path.join(E2E_LOCAL_DIR, "evidence", "network");
      mkdirSync(dir, { recursive: true });
      const summary = {
        test: testInfo.titlePath.join(" › "),
        requestsByHost: Object.fromEntries([...log.local.entries()].map(([host, urls]) => [host, urls.length])),
        blocked: log.blocked,
      };
      writeFileSync(path.join(dir, `${testInfo.testId}-${testInfo.repeatEachIndex}.json`), JSON.stringify(summary, null, 2));
      expectNoProductionTraffic(log);
    },
    { auto: true },
  ],
  persisted: async ({ adminDb }, provide) => provide((uid) => readPersistedNutritionV2(adminDb, uid)),
});

export { expect } from "@playwright/test";
