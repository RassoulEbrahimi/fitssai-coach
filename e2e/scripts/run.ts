import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { E2E_PROJECT_ID, localEmulatorEnvFor } from "../support/emulatorEnv";
import { REPO_ROOT, emulatorProcessEnv, loadLocalE2EEnvFile, restoredAppDataEnv, withLocalEmulatorEnv } from "../support/processEnv";

/**
 * Run the Nutrition browser E2E suite against local emulators.
 *
 *   npm run e2e:nutrition                     start emulators, run headless, stop
 *   npm run e2e:nutrition:headed              the same with a visible browser
 *   npm run e2e:nutrition:attach              use emulators already running (npm run e2e:emulators)
 *
 * Any other argument is passed to `playwright test` (e.g. `-g "Week"`).
 * Playwright's global setup resets and seeds the emulators before the tests.
 */

loadLocalE2EEnvFile();
const exit = (code: number | null) => process.exit(code ?? 1);
const ARGS_ENV = "E2E_PLAYWRIGHT_ARGS";

const runPlaywright = (args: string[], env: NodeJS.ProcessEnv) => {
  const cli = path.join(REPO_ROOT, "node_modules", "@playwright", "test", "cli.js");
  spawn(process.execPath, [cli, "test", "-c", "e2e/playwright.config.ts", ...args], { cwd: REPO_ROOT, stdio: "inherit", env }).on(
    "exit",
    exit
  );
};

const argv = process.argv.slice(2);

if (argv.includes("--inside")) {
  // Started by `firebase emulators:exec` below: the emulators are up.
  runPlaywright(JSON.parse(process.env[ARGS_ENV] ?? "[]"), { ...restoredAppDataEnv(process.env), ...localEmulatorEnvFor("127.0.0.1") });
} else if (argv.includes("--attach")) {
  runPlaywright(
    argv.filter((arg) => arg !== "--attach"),
    withLocalEmulatorEnv("127.0.0.1")
  );
} else {
  const build = spawnSync("npm run build:functions", { cwd: REPO_ROOT, stdio: "inherit", shell: true });
  if (build.status !== 0) exit(build.status);

  // The command string has no spaces to quote; Playwright's arguments travel in the env.
  const inner = "node node_modules/tsx/dist/cli.mjs e2e/scripts/run.ts --inside";
  spawn(`firebase emulators:exec --only auth,firestore,functions --project ${E2E_PROJECT_ID} "${inner}"`, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
    env: { ...emulatorProcessEnv(), [ARGS_ENV]: JSON.stringify(argv) },
  }).on("exit", exit);
}
