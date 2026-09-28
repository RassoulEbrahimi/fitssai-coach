import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  The real src/lib/firebase.ts (imported by relative path: the `@/lib/firebase`
  alias points tests at an inert double), with the Firebase SDK mocked, so the
  exact calls it makes are visible. NUT-13A: with the emulator flag off the
  initialisation is what it always was; with it on, all three services are
  routed to the emulators before anything can use them.
*/

const sdk = vi.hoisted(() => ({
  initializeApp: vi.fn((config: unknown) => ({ name: "[DEFAULT]", options: config })),
  getApps: vi.fn(() => [] as unknown[]),
  getAuth: vi.fn(() => ({ kind: "auth" })),
  getFirestore: vi.fn(() => ({ kind: "firestore" })),
  getFunctions: vi.fn((_app: unknown, region: string) => ({ kind: "functions", region })),
  connectAuthEmulator: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  connectFunctionsEmulator: vi.fn(),
}));

vi.mock("firebase/app", () => ({ initializeApp: sdk.initializeApp, getApps: sdk.getApps }));
vi.mock("firebase/auth", () => ({ getAuth: sdk.getAuth, connectAuthEmulator: sdk.connectAuthEmulator }));
vi.mock("firebase/firestore", () => ({ getFirestore: sdk.getFirestore, connectFirestoreEmulator: sdk.connectFirestoreEmulator }));
vi.mock("firebase/functions", () => ({ getFunctions: sdk.getFunctions, connectFunctionsEmulator: sdk.connectFunctionsEmulator }));

const PRODUCTION_ENV = {
  VITE_FIREBASE_API_KEY: "AIzaProductionKeyForTest",
  VITE_FIREBASE_AUTH_DOMAIN: "fitssai-coach.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "fitssai-coach",
  VITE_FIREBASE_STORAGE_BUCKET: "fitssai-coach.appspot.com",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "1234",
  VITE_FIREBASE_APP_ID: "1:1234:web:abcd",
};

const stubEnv = (env: Record<string, string>) => {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
};

const loadFirebase = () => import("../lib/firebase");

beforeEach(() => {
  vi.resetModules();
  Object.values(sdk).forEach((fn) => fn.mockClear());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.firebaseEmulators;
});

describe("src/lib/firebase.ts bootstrap", () => {
  it("initialises production exactly as before when the emulator flag is off", async () => {
    stubEnv(PRODUCTION_ENV);
    const firebase = await loadFirebase();

    expect(sdk.initializeApp.mock.calls).toEqual([
      [
        {
          apiKey: "AIzaProductionKeyForTest",
          authDomain: "fitssai-coach.firebaseapp.com",
          projectId: "fitssai-coach",
          storageBucket: "fitssai-coach.appspot.com",
          messagingSenderId: "1234",
          appId: "1:1234:web:abcd",
        },
      ],
    ]);
    expect(firebase.auth).toEqual({ kind: "auth" });
    expect(firebase.db).toEqual({ kind: "firestore" });
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
    expect(sdk.connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(sdk.connectFunctionsEmulator).not.toHaveBeenCalled();
    // Functions is not even touched at start-up: the callables obtain it lazily, as before.
    expect(sdk.getFunctions).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.firebaseEmulators).toBeUndefined();
  });

  it("stays off for an explicit false", async () => {
    stubEnv({ ...PRODUCTION_ENV, VITE_FIREBASE_USE_EMULATORS: "false" });
    await loadFirebase();
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
    expect(sdk.getFunctions).not.toHaveBeenCalled();
  });

  it("refuses to start for the production project with the emulator flag, before any Firebase service exists", async () => {
    stubEnv({ ...PRODUCTION_ENV, VITE_FIREBASE_USE_EMULATORS: "true", VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1" });
    await expect(loadFirebase()).rejects.toThrow(/Firebase emulator mode refused/);
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    expect(sdk.getAuth).not.toHaveBeenCalled();
    expect(sdk.getFirestore).not.toHaveBeenCalled();
  });

  it("routes Auth, Firestore and the europe-west3 Functions instance for the demo project", async () => {
    stubEnv({
      VITE_FIREBASE_USE_EMULATORS: "true",
      VITE_FIREBASE_PROJECT_ID: "demo-fitssai",
      VITE_FIREBASE_API_KEY: "demo-fitssai-e2e-key",
      VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
    });
    const firebase = await loadFirebase();
    const app = sdk.initializeApp.mock.results[0].value;

    expect(sdk.connectAuthEmulator.mock.calls).toEqual([[firebase.auth, "http://127.0.0.1:9099", { disableWarnings: true }]]);
    expect(sdk.connectFirestoreEmulator.mock.calls).toEqual([[firebase.db, "127.0.0.1", 8080]]);
    expect(sdk.getFunctions.mock.calls).toEqual([[app, "europe-west3"]]);
    expect(sdk.connectFunctionsEmulator.mock.calls).toEqual([[{ kind: "functions", region: "europe-west3" }, "127.0.0.1", 5001]]);
    expect(document.documentElement.dataset.firebaseEmulators).toBe("127.0.0.1");
  });

  it("routes a phone's LAN host the same way, still only for the demo project", async () => {
    stubEnv({
      VITE_FIREBASE_USE_EMULATORS: "true",
      VITE_FIREBASE_PROJECT_ID: "demo-fitssai",
      VITE_FIREBASE_API_KEY: "demo-fitssai-e2e-key",
      VITE_FIREBASE_EMULATOR_HOST: "192.168.178.20",
    });
    await loadFirebase();
    expect(sdk.connectFirestoreEmulator.mock.calls[0].slice(1)).toEqual(["192.168.178.20", 8080]);
    expect(sdk.connectFunctionsEmulator.mock.calls[0].slice(1)).toEqual(["192.168.178.20", 5001]);
  });
});
