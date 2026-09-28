import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { requireLocalEmulatorEnv } from "./emulatorEnv";
import { E2E_LOCAL_DIR, REPO_ROOT, loadLocalE2EEnvFile } from "./processEnv";

/** Where the seed summary (ids, dates, meal names — never the password) is written for the tests. */
export const SEED_SUMMARY_FILE = path.join(E2E_LOCAL_DIR, "seed-summary.json");

/**
 * Reset the emulators and seed them again, in a process of its own: the seed
 * executes the Functions workspace's TypeScript (the real activation core) as
 * CommonJS. Writes the summary to `SEED_SUMMARY_FILE`. Global setup runs it
 * once; the NUT-13B tests run it before every scenario (`e2e/support/fixtures.ts`).
 */
export const runNutritionSeed = ({ quiet = false }: { quiet?: boolean } = {}): void => {
  requireLocalEmulatorEnv(process.env);
  const tsx = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const seed = spawnSync(process.execPath, [tsx, "e2e/scripts/seed.ts", "--json", SEED_SUMMARY_FILE], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", quiet ? "ignore" : "inherit", "inherit"],
  });
  if (seed.status !== 0) throw new Error(`Seeding the emulators failed (exit ${seed.status}).`);
};

/**
 * Playwright global setup: refuse anything but the local demo emulators, then
 * reset and seed them.
 *
 * Without an E2E_NUTRITION_PASSWORD the accounts get a fresh random password,
 * kept only in this run's environment — never printed and never written
 * anywhere.
 */
export default function globalSetup(): void {
  loadLocalE2EEnvFile();
  requireLocalEmulatorEnv(process.env);
  if (!process.env.E2E_NUTRITION_PASSWORD) process.env.E2E_NUTRITION_PASSWORD = randomBytes(18).toString("base64url");
  runNutritionSeed();
}
