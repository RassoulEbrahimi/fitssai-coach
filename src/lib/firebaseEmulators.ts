import type { FirebaseApp } from "firebase/app";
import { connectAuthEmulator, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { FUNCTIONS_REGION } from "./backend/region";

/**
 * Local Firebase emulator routing for the E2E harness (NUT-13A).
 *
 * Off unless the build environment says, explicitly, `VITE_FIREBASE_USE_EMULATORS=true`.
 * Nothing is inferred from the hostname, the Vite mode or `import.meta.env.DEV`,
 * so a production build behaves exactly as before. When the flag is on, the
 * configuration must be unmistakably local, or the app refuses to start:
 *
 *   - the project id is the demo project `demo-fitssai` — never `fitssai-coach`;
 *     a `demo-` project has no production resources to reach
 *   - the API key is present (the Auth SDK needs one) and is not a real browser
 *     key (those start with `AIza`), so a production config cannot be reused
 *   - the emulator host is named explicitly and is loopback or a private LAN
 *     IPv4 address (a phone on the same network), never a public host
 *
 * A demo project id without the flag is refused as well: it only makes sense
 * against the emulators, and without them every call would go to Google.
 */

/** The only project id the emulator mode accepts. Firebase never maps a `demo-` id to real resources. */
export const E2E_FIREBASE_PROJECT_ID = "demo-fitssai";

/** The ports in firebase.json. Overridable, but only with a valid, distinct port. */
export const FIREBASE_EMULATOR_DEFAULT_PORTS = Object.freeze({
  auth: 9099,
  firestore: 8080,
  functions: 5001,
});

export interface FirebaseEmulatorConfig {
  host: string;
  ports: { auth: number; firestore: number; functions: number };
}

/** The build environment variables this module reads — the `import.meta.env` subset. */
export interface FirebaseEmulatorEnv {
  VITE_FIREBASE_USE_EMULATORS?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_EMULATOR_HOST?: string;
  VITE_FIREBASE_AUTH_EMULATOR_PORT?: string;
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT?: string;
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT?: string;
}

export class FirebaseEmulatorConfigError extends Error {
  constructor(message: string) {
    super(`Firebase emulator mode refused: ${message}`);
    this.name = "FirebaseEmulatorConfigError";
  }
}

const PRIVATE_IPV4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** Loopback, or a private (RFC 1918) IPv4 address of this network. Nothing else. */
export const isAllowedEmulatorHost = (host: string): boolean => {
  if (host === "localhost" || host === "127.0.0.1") return true;
  const octets = host.split(".");
  if (octets.length !== 4 || !octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)) {
    return false;
  }
  return PRIVATE_IPV4.some((pattern) => pattern.test(host));
};

const readPort = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined || raw === "") return fallback;
  if (!/^[1-9]\d{0,4}$/.test(raw) || Number(raw) > 65535) throw new FirebaseEmulatorConfigError(`${name} is not a port`);
  return Number(raw);
};

/**
 * The emulator configuration the environment asks for, `null` for the normal
 * (production) Firebase services, or a `FirebaseEmulatorConfigError` when the
 * request is ambiguous or could reach production. Pure.
 */
export const resolveFirebaseEmulatorConfig = (env: FirebaseEmulatorEnv): FirebaseEmulatorConfig | null => {
  const flag = env.VITE_FIREBASE_USE_EMULATORS;
  const projectId = env.VITE_FIREBASE_PROJECT_ID ?? "";

  if (flag === undefined || flag === "" || flag === "false") {
    if (projectId.startsWith("demo-")) {
      throw new FirebaseEmulatorConfigError(`project ${projectId} exists only in the emulators; set VITE_FIREBASE_USE_EMULATORS=true`);
    }
    return null;
  }
  if (flag !== "true") throw new FirebaseEmulatorConfigError("VITE_FIREBASE_USE_EMULATORS must be exactly true or false");

  if (projectId !== E2E_FIREBASE_PROJECT_ID) {
    throw new FirebaseEmulatorConfigError(`the project id must be ${E2E_FIREBASE_PROJECT_ID}`);
  }
  const apiKey = env.VITE_FIREBASE_API_KEY ?? "";
  if (apiKey === "") throw new FirebaseEmulatorConfigError("VITE_FIREBASE_API_KEY needs a placeholder value");
  if (apiKey.startsWith("AIza")) throw new FirebaseEmulatorConfigError("VITE_FIREBASE_API_KEY looks like a real browser key");

  const host = env.VITE_FIREBASE_EMULATOR_HOST ?? "";
  if (host === "") throw new FirebaseEmulatorConfigError("VITE_FIREBASE_EMULATOR_HOST is required");
  if (!isAllowedEmulatorHost(host)) {
    throw new FirebaseEmulatorConfigError("VITE_FIREBASE_EMULATOR_HOST must be loopback or a private LAN IPv4 address");
  }

  const ports = {
    auth: readPort(env.VITE_FIREBASE_AUTH_EMULATOR_PORT, FIREBASE_EMULATOR_DEFAULT_PORTS.auth, "VITE_FIREBASE_AUTH_EMULATOR_PORT"),
    firestore: readPort(
      env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT,
      FIREBASE_EMULATOR_DEFAULT_PORTS.firestore,
      "VITE_FIREBASE_FIRESTORE_EMULATOR_PORT"
    ),
    functions: readPort(
      env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT,
      FIREBASE_EMULATOR_DEFAULT_PORTS.functions,
      "VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT"
    ),
  };
  if (new Set(Object.values(ports)).size !== 3) throw new FirebaseEmulatorConfigError("the emulator ports must be distinct");

  return { host, ports };
};

/**
 * Route this app's Auth, Firestore and Functions to the emulators. Called once,
 * by `src/lib/firebase.ts`, before anything else can use them.
 *
 * Functions: every callable in the app asks `getFunctions(getApp(), FUNCTIONS_REGION)`,
 * which returns one cached instance per app and region. Connecting exactly that
 * instance here is what keeps those callables off the deployed backend.
 */
export const connectFirebaseEmulators = (
  app: FirebaseApp,
  auth: Auth,
  db: Firestore,
  { host, ports }: FirebaseEmulatorConfig
): void => {
  // No SDK banner: it overlaps the bottom navigation the E2E checks lay out.
  connectAuthEmulator(auth, `http://${host}:${ports.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, ports.firestore);
  connectFunctionsEmulator(getFunctions(app, FUNCTIONS_REGION), host, ports.functions);
  if (typeof document !== "undefined") document.documentElement.dataset.firebaseEmulators = host;
  console.warn(`[fitssai] Firebase emulator mode: ${E2E_FIREBASE_PROJECT_ID} at ${host}. No production service is used.`);
};
