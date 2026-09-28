import { describe, expect, it } from "vitest";
import { deleteApp, getApp, initializeApp } from "firebase/app";
import { inMemoryPersistence, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import {
  E2E_FIREBASE_PROJECT_ID,
  FirebaseEmulatorConfigError,
  connectFirebaseEmulators,
  isAllowedEmulatorHost,
  resolveFirebaseEmulatorConfig,
  type FirebaseEmulatorEnv,
} from "./firebaseEmulators";
import { FUNCTIONS_REGION } from "./backend/region";

const E2E_ENV: FirebaseEmulatorEnv = {
  VITE_FIREBASE_USE_EMULATORS: "true",
  VITE_FIREBASE_PROJECT_ID: "demo-fitssai",
  VITE_FIREBASE_API_KEY: "demo-fitssai-e2e-key",
  VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
};

describe("resolveFirebaseEmulatorConfig", () => {
  it("is off by default: no flag means the normal Firebase services", () => {
    expect(resolveFirebaseEmulatorConfig({})).toBeNull();
    expect(resolveFirebaseEmulatorConfig({ VITE_FIREBASE_PROJECT_ID: "fitssai-coach", VITE_FIREBASE_API_KEY: "AIzaReal" })).toBeNull();
    expect(resolveFirebaseEmulatorConfig({ VITE_FIREBASE_USE_EMULATORS: "", VITE_FIREBASE_PROJECT_ID: "fitssai-coach" })).toBeNull();
    expect(resolveFirebaseEmulatorConfig({ VITE_FIREBASE_USE_EMULATORS: "false", VITE_FIREBASE_PROJECT_ID: "fitssai-coach" })).toBeNull();
  });

  it("is not inferred from anything but the flag — a local emulator host alone changes nothing", () => {
    expect(
      resolveFirebaseEmulatorConfig({ VITE_FIREBASE_PROJECT_ID: "fitssai-coach", VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1" })
    ).toBeNull();
  });

  it("routes the demo project to the default emulator ports", () => {
    expect(resolveFirebaseEmulatorConfig(E2E_ENV)).toEqual({
      host: "127.0.0.1",
      ports: { auth: 9099, firestore: 8080, functions: 5001 },
    });
    expect(E2E_FIREBASE_PROJECT_ID).toBe("demo-fitssai");
  });

  it("refuses the production project with the emulator flag", () => {
    expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_PROJECT_ID: "fitssai-coach" })).toThrow(
      FirebaseEmulatorConfigError
    );
  });

  it("refuses any project but demo-fitssai, and a missing one", () => {
    for (const project of ["demo-other", "fitssai-coach-staging", "", undefined]) {
      expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_PROJECT_ID: project })).toThrow(/project id/);
    }
  });

  it("refuses a demo project without the flag: it only exists in the emulators", () => {
    expect(() => resolveFirebaseEmulatorConfig({ VITE_FIREBASE_PROJECT_ID: "demo-fitssai" })).toThrow(FirebaseEmulatorConfigError);
  });

  it("refuses a flag value that is not exactly true or false", () => {
    for (const flag of ["TRUE", "1", "yes", " true"]) {
      expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_USE_EMULATORS: flag })).toThrow(/exactly true/);
    }
  });

  it("refuses a real browser API key and a missing one", () => {
    expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_API_KEY: "AIzaSyExample" })).toThrow(/real browser key/);
    expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_API_KEY: undefined })).toThrow(/placeholder/);
  });

  it("requires an explicit emulator host", () => {
    expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_EMULATOR_HOST: undefined })).toThrow(/required/);
    expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_EMULATOR_HOST: "" })).toThrow(/required/);
  });

  it("accepts a private LAN address for a phone, never a public host", () => {
    expect(resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_EMULATOR_HOST: "192.168.178.20" })?.host).toBe("192.168.178.20");
    for (const host of ["firestore.googleapis.com", "8.8.8.8", "172.32.0.1", "192.168.1", "example.test", "http://127.0.0.1", "127.0.0.1:8080"]) {
      expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_EMULATOR_HOST: host })).toThrow(/loopback or a private/);
    }
  });

  it("takes valid, distinct port overrides only", () => {
    expect(
      resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_AUTH_EMULATOR_PORT: "19099", VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: "15001" })
        ?.ports
    ).toEqual({ auth: 19099, firestore: 8080, functions: 15001 });
    expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: "80a" })).toThrow(/not a port/);
    expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: "70000" })).toThrow(/not a port/);
    expect(() => resolveFirebaseEmulatorConfig({ ...E2E_ENV, VITE_FIREBASE_AUTH_EMULATOR_PORT: "8080" })).toThrow(/distinct/);
  });
});

describe("isAllowedEmulatorHost", () => {
  it.each(["localhost", "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.0.10"])("allows %s", (host) => {
    expect(isAllowedEmulatorHost(host)).toBe(true);
  });
  it.each(["::1", "0.0.0.0", "1.1.1.1", "172.15.0.1", "192.169.0.1", "10.0.0.256", "010.0.0.1", "localhost.evil.test"])(
    "refuses %s",
    (host) => {
      expect(isAllowedEmulatorHost(host)).toBe(false);
    }
  );
});

describe("connectFirebaseEmulators with the real SDK", () => {
  it("routes Auth, Firestore and the cached europe-west3 Functions instance the callables use", async () => {
    const app = initializeApp({ apiKey: "demo-fitssai-e2e-key", projectId: "demo-fitssai" }, "emulator-routing-test");
    try {
      const auth = initializeAuth(app, { persistence: inMemoryPersistence });
      const db = getFirestore(app);
      connectFirebaseEmulators(app, auth, db, { host: "127.0.0.1", ports: { auth: 9099, firestore: 8080, functions: 5001 } });

      expect(auth.emulatorConfig).toMatchObject({ protocol: "http", host: "127.0.0.1", port: 9099 });
      expect((db.toJSON() as { settings: { host: string } }).settings.host).toBe("127.0.0.1:8080");

      // What every callable module does: getFunctions(getApp(), FUNCTIONS_REGION).
      const regional = getFunctions(getApp("emulator-routing-test"), FUNCTIONS_REGION) as unknown as {
        _url(name: string): string;
      };
      expect(FUNCTIONS_REGION).toBe("europe-west3");
      expect(regional._url("nutritionUpdateSlot")).toBe("http://127.0.0.1:5001/demo-fitssai/europe-west3/nutritionUpdateSlot");
      expect(document.documentElement.dataset.firebaseEmulators).toBe("127.0.0.1");
    } finally {
      delete document.documentElement.dataset.firebaseEmulators;
      await deleteApp(app);
    }
  });

  it("leaves a Functions instance of another region unrouted — the region is what matters", async () => {
    const app = initializeApp({ apiKey: "demo-fitssai-e2e-key", projectId: "demo-fitssai" }, "emulator-region-test");
    try {
      connectFirebaseEmulators(app, initializeAuth(app, { persistence: inMemoryPersistence }), getFirestore(app), {
        host: "127.0.0.1",
        ports: { auth: 9099, firestore: 8080, functions: 5001 },
      });
      const other = getFunctions(app, "us-central1") as unknown as { _url(name: string): string };
      expect(other._url("nutritionUpdateSlot")).toBe("https://us-central1-demo-fitssai.cloudfunctions.net/nutritionUpdateSlot");
    } finally {
      delete document.documentElement.dataset.firebaseEmulators;
      await deleteApp(app);
    }
  });
});
