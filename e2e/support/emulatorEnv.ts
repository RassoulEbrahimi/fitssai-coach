/**
 * The Node-side safety boundary of the local Nutrition E2E harness (NUT-13A).
 *
 * Everything in e2e/ that talks to Firebase — the seed/reset, the Playwright
 * setup, the launchers — resolves its targets through `requireLocalEmulatorEnv`
 * and nothing else. It fails closed: unless every emulator variable is present
 * and names a loopback or private-LAN `host:port`, and the project is the demo
 * project, it throws before any request is made.
 *
 * Pure: reads only the env object it is given.
 */

/** The only project the harness ever addresses. A `demo-` project has no production resources. */
export const E2E_PROJECT_ID = "demo-fitssai";

/** The production project. Named only so it can be refused explicitly. */
export const PRODUCTION_PROJECT_ID = "fitssai-coach";

/** Must match FUNCTIONS_REGION in functions/src/config.ts and src/lib/backend/region.ts. */
export const E2E_FUNCTIONS_REGION = "europe-west3";

/** The ports in firebase.json. */
export const E2E_EMULATOR_PORTS = Object.freeze({ auth: 9099, firestore: 8080, functions: 5001 });

/**
 * The variables the harness requires. `FIRESTORE_EMULATOR_HOST`,
 * `FIREBASE_AUTH_EMULATOR_HOST` and `GCLOUD_PROJECT` are the standard names
 * `firebase emulators:exec` sets; the Functions host has no standard name.
 */
export const REQUIRED_EMULATOR_ENV = [
  "GCLOUD_PROJECT",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_FUNCTIONS_EMULATOR_HOST",
] as const;

export interface LocalEmulatorEnv {
  projectId: typeof E2E_PROJECT_ID;
  /** `http://host:port` of each emulator. */
  authUrl: string;
  firestoreUrl: string;
  functionsUrl: string;
  /** The raw `host:port` values, for the Admin SDK's own env variables. */
  authHost: string;
  firestoreHost: string;
}

export class UnsafeEmulatorEnvError extends Error {
  constructor(message: string) {
    super(`Refusing to touch Firebase: ${message}`);
    this.name = "UnsafeEmulatorEnvError";
  }
}

const PRIVATE_IPV4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** Loopback, or a private (RFC 1918) IPv4 address. The same rule as the browser bootstrap. */
export const isLocalHostname = (host: string): boolean => {
  if (host === "localhost" || host === "127.0.0.1") return true;
  const octets = host.split(".");
  if (octets.length !== 4 || !octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)) {
    return false;
  }
  return PRIVATE_IPV4.some((pattern) => pattern.test(host));
};

const requireHostPort = (name: string, value: string | undefined): string => {
  if (value === undefined || value === "") throw new UnsafeEmulatorEnvError(`${name} is not set`);
  const match = /^([^:/\s]+):([1-9]\d{0,4})$/.exec(value);
  if (!match || Number(match[2]) > 65535) throw new UnsafeEmulatorEnvError(`${name} must be host:port`);
  if (!isLocalHostname(match[1])) throw new UnsafeEmulatorEnvError(`${name} must be loopback or a private LAN address`);
  return value;
};

/**
 * The emulator endpoints the environment names, or an `UnsafeEmulatorEnvError`.
 * Never defaults anything: a missing variable is a refusal, not a guess.
 */
export const requireLocalEmulatorEnv = (env: Record<string, string | undefined>): LocalEmulatorEnv => {
  const project = env.GCLOUD_PROJECT;
  if (project === undefined || project === "") throw new UnsafeEmulatorEnvError("GCLOUD_PROJECT is not set");
  if (project === PRODUCTION_PROJECT_ID) throw new UnsafeEmulatorEnvError("GCLOUD_PROJECT is the production project");
  if (project !== E2E_PROJECT_ID) throw new UnsafeEmulatorEnvError(`GCLOUD_PROJECT must be ${E2E_PROJECT_ID}`);
  // Another project named elsewhere is a sign of a mixed configuration.
  for (const name of ["GOOGLE_CLOUD_PROJECT", "FIREBASE_PROJECT_ID"]) {
    const other = env[name];
    if (other !== undefined && other !== "" && other !== E2E_PROJECT_ID) {
      throw new UnsafeEmulatorEnvError(`${name} names another project`);
    }
  }

  const authHost = requireHostPort("FIREBASE_AUTH_EMULATOR_HOST", env.FIREBASE_AUTH_EMULATOR_HOST);
  const firestoreHost = requireHostPort("FIRESTORE_EMULATOR_HOST", env.FIRESTORE_EMULATOR_HOST);
  const functionsHost = requireHostPort("FIREBASE_FUNCTIONS_EMULATOR_HOST", env.FIREBASE_FUNCTIONS_EMULATOR_HOST);

  return {
    projectId: E2E_PROJECT_ID,
    authUrl: `http://${authHost}`,
    firestoreUrl: `http://${firestoreHost}`,
    functionsUrl: `http://${functionsHost}`,
    authHost,
    firestoreHost,
  };
};

/**
 * The emulator variables for `host` and the firebase.json ports. Used by the
 * harness's own launchers only; the result still goes through
 * `requireLocalEmulatorEnv`, so a bad host is refused there.
 */
export const localEmulatorEnvFor = (host: string): Record<(typeof REQUIRED_EMULATOR_ENV)[number], string> => ({
  GCLOUD_PROJECT: E2E_PROJECT_ID,
  FIREBASE_AUTH_EMULATOR_HOST: `${host}:${E2E_EMULATOR_PORTS.auth}`,
  FIRESTORE_EMULATOR_HOST: `${host}:${E2E_EMULATOR_PORTS.firestore}`,
  FIREBASE_FUNCTIONS_EMULATOR_HOST: `${host}:${E2E_EMULATOR_PORTS.functions}`,
});
