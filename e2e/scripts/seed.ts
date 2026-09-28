import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedNutritionE2E } from "../support/seedNutrition";
import { e2eEmulatorHost, loadLocalE2EEnvFile, withLocalEmulatorEnv } from "../support/processEnv";

/**
 * Reset the running emulators and seed the Nutrition E2E accounts.
 *
 *   npm run e2e:seed                     after npm run e2e:emulators
 *   npm run e2e:seed -- --json <file>    also write the summary (no password)
 *
 * The accounts' password is E2E_NUTRITION_PASSWORD, from the environment or
 * the gitignored .env.e2e.local. Choose a local-only value; it is never printed.
 */

loadLocalE2EEnvFile();

const password = process.env.E2E_NUTRITION_PASSWORD;
if (!password) {
  console.error("Set E2E_NUTRITION_PASSWORD (at least 8 characters) in .env.e2e.local — see .env.e2e.example.");
  process.exit(1);
}

const jsonIndex = process.argv.indexOf("--json");
const jsonFile = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : undefined;

const summary = await seedNutritionE2E({ env: withLocalEmulatorEnv(e2eEmulatorHost()), password });

if (jsonFile) {
  mkdirSync(path.dirname(path.resolve(jsonFile)), { recursive: true });
  writeFileSync(jsonFile, JSON.stringify(summary, null, 2));
}

console.log(`Seeded ${summary.projectId} for Berlin date ${summary.today}:`);
for (const user of Object.values(summary.users)) {
  const nutrition = user.nutrition
    ? `target ${Math.round(user.nutrition.target.kcal)} kcal, plan ${user.nutrition.planId} ${user.nutrition.startDate}..${user.nutrition.endDate}`
    : "profile only";
  console.log(`  ${user.key.padEnd(10)} ${user.email}  (${nutrition})`);
}
