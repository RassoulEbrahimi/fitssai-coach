import { existsSync, mkdirSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_EMULATOR_PORTS, E2E_PROJECT_ID, isLocalHostname, localEmulatorEnvFor } from "./emulatorEnv";

/**
 * Process plumbing shared by the harness's launch scripts. Nothing here talks
 * to Firebase; it only builds environments that `requireLocalEmulatorEnv`
 * (Node) and `resolveFirebaseEmulatorConfig` (browser) then check.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The E2E dev server's port. Not Vite's usual 8080, which the Firestore emulator uses. */
export const e2eClientPort = (): number => {
  const port = Number(process.env.E2E_CLIENT_PORT || 5180);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("E2E_CLIENT_PORT is not a port");
  return port;
};

/** Where the harness keeps generated, ignored files (`*.local` is gitignored). */
export const E2E_LOCAL_DIR = path.join(REPO_ROOT, "e2e", "results.local");

/**
 * `.env.e2e.local` (gitignored): local-only values such as the emulator
 * accounts' password or a LAN host. Never overrides a variable already set.
 */
export const loadLocalE2EEnvFile = (): void => {
  const file = path.join(REPO_ROOT, ".env.e2e.local");
  if (existsSync(file)) process.loadEnvFile(file);
};

/** The emulator host the harness uses: `E2E_EMULATOR_HOST`, or loopback. Must be local. */
export const e2eEmulatorHost = (): string => {
  const host = process.env.E2E_EMULATOR_HOST || "127.0.0.1";
  if (!isLocalHostname(host)) throw new Error("E2E_EMULATOR_HOST must be loopback or a private LAN IPv4 address");
  return host;
};

/** The private IPv4 addresses of this machine, for the phone check. */
export const lanAddresses = (): string[] =>
  Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal && isLocalHostname(entry.address))
    .map((entry) => entry!.address);

/** The LAN host: `E2E_EMULATOR_HOST` if set, else this machine's only private address. */
export const e2eLanHost = (): string => {
  if (process.env.E2E_EMULATOR_HOST) return e2eEmulatorHost();
  const addresses = lanAddresses().filter((address) => address !== "127.0.0.1");
  if (addresses.length !== 1) {
    throw new Error(
      `Set E2E_EMULATOR_HOST to this machine's LAN address in .env.e2e.local (found: ${addresses.join(", ") || "none"}).`
    );
  }
  return addresses[0];
};

/** Where `emulatorProcessEnv` keeps the real APPDATA, for processes the emulators start. */
export const ORIGINAL_APPDATA_ENV = "E2E_ORIGINAL_APPDATA";

/**
 * The environment for the Firebase CLI running the emulators: the demo
 * project, and every route to real Google credentials removed, so the
 * Functions emulator has nothing it could reach production with.
 *
 * The CLI hands the Functions runtime credentials in one of two ways: this
 * machine's Application Default Credentials (the gcloud well-known file, under
 * APPDATA on Windows and ~/.config elsewhere), or — when there are none — the
 * `firebase login` account, from the CLI's own config under XDG_CONFIG_HOME /
 * ~/.config. Both locations point at empty directories here, and the explicit
 * credential variables are removed, so neither exists. A demo project needs no
 * login.
 */
export const emulatorProcessEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  delete env.GOOGLE_CLOUD_PROJECT;
  delete env.FIREBASE_TOKEN;
  const empty = (name: string) => {
    const dir = path.join(tmpdir(), "fitssai-e2e-no-credentials", name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  if (env.APPDATA) env[ORIGINAL_APPDATA_ENV] = env.APPDATA;
  env.APPDATA = empty("appdata");
  env.XDG_CONFIG_HOME = empty("config");
  env.CLOUDSDK_CONFIG = empty("gcloud");
  env.GCLOUD_PROJECT = E2E_PROJECT_ID;
  return env;
};

/** The environment of a process started by the emulators, with the real APPDATA back. */
export const restoredAppDataEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const original = env[ORIGINAL_APPDATA_ENV];
  return original ? { ...env, APPDATA: original } : env;
};

/**
 * The current environment, with the Node-side emulator variables for `host`
 * filled in where they are not set. A value already set wins — and a value
 * that is not local is then refused by `requireLocalEmulatorEnv`, never replaced.
 */
export const withLocalEmulatorEnv = (host: string): NodeJS.ProcessEnv => ({ ...localEmulatorEnvFor(host), ...process.env });

/**
 * The Vite environment of the E2E client. Every `VITE_FIREBASE_*` value is set
 * explicitly, so a developer's `.env`/`.env.local` production config can never
 * leak into it (process variables take precedence over Vite's env files).
 */
export const e2eClientEnv = (host: string): NodeJS.ProcessEnv => ({
  ...process.env,
  VITE_FIREBASE_USE_EMULATORS: "true",
  VITE_FIREBASE_PROJECT_ID: E2E_PROJECT_ID,
  VITE_FIREBASE_API_KEY: "demo-fitssai-e2e-key",
  VITE_FIREBASE_AUTH_DOMAIN: `${E2E_PROJECT_ID}.local`,
  VITE_FIREBASE_STORAGE_BUCKET: "",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "",
  VITE_FIREBASE_APP_ID: "",
  VITE_FIREBASE_EMULATOR_HOST: host,
  VITE_FIREBASE_AUTH_EMULATOR_PORT: String(E2E_EMULATOR_PORTS.auth),
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: String(E2E_EMULATOR_PORTS.firestore),
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: String(E2E_EMULATOR_PORTS.functions),
});
