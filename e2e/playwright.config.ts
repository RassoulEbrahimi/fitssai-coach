import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { E2E_LOCAL_DIR, REPO_ROOT, e2eClientPort, loadLocalE2EEnvFile } from "./support/processEnv";

loadLocalE2EEnvFile();

/**
 * Local Nutrition V2 browser E2E (NUT-13A). Runs the real app from the Vite
 * dev server against the Firebase emulators; see docs/dev/nutrition-e2e.md.
 * Not part of CI or the deployment workflow.
 *
 * The browser is the installed Google Chrome by default, so no browser download
 * is needed. Set E2E_BROWSER_CHANNEL=chromium after `npx playwright install
 * chromium` to use Playwright's own build instead.
 */

const channel = process.env.E2E_BROWSER_CHANNEL || "chrome";
const baseURL = `http://127.0.0.1:${e2eClientPort()}/fitssai-coach/`;

export default defineConfig({
  testDir: path.join(REPO_ROOT, "e2e", "tests"),
  // `*.e2e.ts`, so Vitest's default `*.test.ts`/`*.spec.ts` collection never picks these up.
  testMatch: "**/*.e2e.ts",
  outputDir: path.join(E2E_LOCAL_DIR, "test-output"),
  globalSetup: path.join(REPO_ROOT, "e2e", "support", "globalSetup.ts"),
  // One seeded dataset shared by every test: run them one after another.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { outputFolder: path.join(E2E_LOCAL_DIR, "report"), open: "never" }]],
  use: {
    baseURL,
    channel: channel === "chromium" ? undefined : channel,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    // A service worker could answer from a cache instead of the dev server.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "desktop-chrome", use: { ...devices["Desktop Chrome"], channel: channel === "chromium" ? undefined : channel } }],
  webServer: {
    command: "node node_modules/tsx/dist/cli.mjs e2e/scripts/client.ts",
    cwd: REPO_ROOT,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
  },
});
