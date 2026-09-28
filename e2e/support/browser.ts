import { readFileSync } from "node:fs";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { E2E_EMULATOR_PORTS, isLocalHostname } from "./emulatorEnv";
import { SEED_SUMMARY_FILE } from "./globalSetup";
import type { NutritionSeedSummary } from "./seedNutrition";

/** What global setup seeded (ids, dates, meal names; never the password). */
export const readSeedSummary = (): NutritionSeedSummary => JSON.parse(readFileSync(SEED_SUMMARY_FILE, "utf8"));

/** The emulator accounts' password for this run. */
export const e2ePassword = (): string => {
  const password = process.env.E2E_NUTRITION_PASSWORD;
  if (!password) throw new Error("E2E_NUTRITION_PASSWORD is not set; global setup did not run.");
  return password;
};

/**
 * Hosts the page may reach: the dev server and the emulators — loopback, or the
 * private LAN host of a phone run (E2E_EMULATOR_HOST) — and the web font.
 */
const lanHost = process.env.E2E_EMULATOR_HOST;
/** Where the app under test routes Firebase: the LAN host of a phone run, or loopback. */
const EMULATOR_HOST = lanHost && isLocalHostname(lanHost) ? lanHost : "127.0.0.1";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", ...(lanHost && isLocalHostname(lanHost) ? [lanHost] : [])]);
const ALLOWED_THIRD_PARTY = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

export interface NetworkLog {
  /** Every request URL the page issued to a local host, by `host:port`. */
  local: Map<string, string[]>;
  /** Non-local requests other than the web font: aborted, never sent. */
  blocked: string[];
}

/**
 * Nothing but the local dev server, the emulators and the web font may leave
 * the browser. Anything else — a production Firebase endpoint above all — is
 * aborted before it is sent and recorded, and the test then fails on it.
 */
export const guardNetwork = async (context: BrowserContext): Promise<NetworkLog> => {
  const log: NetworkLog = { local: new Map(), blocked: [] };
  await context.route(
    (url) => !LOCAL_HOSTS.has(url.hostname) && !ALLOWED_THIRD_PARTY.has(url.hostname) && url.protocol.startsWith("http"),
    async (route) => {
      log.blocked.push(route.request().url());
      await route.abort("blockedbyclient");
    }
  );
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (!LOCAL_HOSTS.has(url.hostname)) return;
    const key = `${url.hostname}:${url.port || 80}`;
    log.local.set(key, [...(log.local.get(key) ?? []), request.url()]);
  });
  return log;
};

/**
 * The page reached Auth, Firestore (and Functions) on the configured emulator
 * host, and nothing non-local.
 */
export const expectEmulatorOnlyTraffic = (log: NetworkLog, { functions }: { functions: boolean }) => {
  expect(log.blocked, "requests to non-local hosts").toEqual([]);
  const count = (port: number) => log.local.get(`${EMULATOR_HOST}:${port}`)?.length ?? 0;
  expect(count(E2E_EMULATOR_PORTS.auth), `Auth emulator requests to ${EMULATOR_HOST}`).toBeGreaterThan(0);
  expect(count(E2E_EMULATOR_PORTS.firestore), `Firestore emulator requests to ${EMULATOR_HOST}`).toBeGreaterThan(0);
  if (functions) expect(count(E2E_EMULATOR_PORTS.functions), `Functions emulator requests to ${EMULATOR_HOST}`).toBeGreaterThan(0);
};

/** Sign in through the app's own login form, against the Auth emulator. */
export const signIn = async (page: Page, email: string, password: string) => {
  await page.goto("auth/sign-in");
  // The emulator bootstrap marks the document; without it this is not an E2E build.
  await expect(page.locator("html")).toHaveAttribute("data-firebase-emulators", /.+/);
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(password);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/fitssai-coach\/dashboard/);
};

/** Open the Nutrition tab of the dashboard. */
export const openNutrition = async (page: Page) => {
  await page.goto("dashboard#/nutrition");
  await expect(page.getByTestId("nutrition-v2-today")).toBeVisible();
};

/** Presentation rounding, as the V2 components do it. */
export const formatKcal = (kcal: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(kcal));
