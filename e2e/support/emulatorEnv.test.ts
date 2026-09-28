import { afterEach, describe, expect, it, vi } from "vitest";
import {
  E2E_PROJECT_ID,
  REQUIRED_EMULATOR_ENV,
  UnsafeEmulatorEnvError,
  isLocalHostname,
  localEmulatorEnvFor,
  requireLocalEmulatorEnv,
} from "./emulatorEnv";
import { callEmulatorCallable, emulatorRequest, resetEmulators } from "./emulatorRest";
import { seedNutritionE2E } from "./seedNutrition";

/*
  NUT-13A: the Node side of the harness — seed/reset, Playwright setup,
  launchers — refuses anything but the local demo emulators, before a single
  request is made.
*/

const LOCAL = localEmulatorEnvFor("127.0.0.1");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requireLocalEmulatorEnv", () => {
  it("accepts the demo project on loopback emulators", () => {
    expect(requireLocalEmulatorEnv(LOCAL)).toEqual({
      projectId: "demo-fitssai",
      authUrl: "http://127.0.0.1:9099",
      firestoreUrl: "http://127.0.0.1:8080",
      functionsUrl: "http://127.0.0.1:5001",
      authHost: "127.0.0.1:9099",
      firestoreHost: "127.0.0.1:8080",
    });
  });

  it("accepts emulators on a private LAN address", () => {
    expect(requireLocalEmulatorEnv(localEmulatorEnvFor("192.168.178.20")).functionsUrl).toBe("http://192.168.178.20:5001");
  });

  it.each(REQUIRED_EMULATOR_ENV)("refuses when %s is missing", (name) => {
    expect(() => requireLocalEmulatorEnv({ ...LOCAL, [name]: undefined })).toThrow(UnsafeEmulatorEnvError);
    expect(() => requireLocalEmulatorEnv({ ...LOCAL, [name]: "" })).toThrow(UnsafeEmulatorEnvError);
  });

  it("refuses an empty environment — nothing is defaulted", () => {
    expect(() => requireLocalEmulatorEnv({})).toThrow(/GCLOUD_PROJECT is not set/);
  });

  it("refuses the production project and any other project", () => {
    expect(() => requireLocalEmulatorEnv({ ...LOCAL, GCLOUD_PROJECT: "fitssai-coach" })).toThrow(/production project/);
    expect(() => requireLocalEmulatorEnv({ ...LOCAL, GCLOUD_PROJECT: "demo-other" })).toThrow(/must be demo-fitssai/);
    expect(() => requireLocalEmulatorEnv({ ...LOCAL, GOOGLE_CLOUD_PROJECT: "fitssai-coach" })).toThrow(/another project/);
    expect(() => requireLocalEmulatorEnv({ ...LOCAL, FIREBASE_PROJECT_ID: "fitssai-coach" })).toThrow(/another project/);
    expect(requireLocalEmulatorEnv({ ...LOCAL, GOOGLE_CLOUD_PROJECT: E2E_PROJECT_ID }).projectId).toBe(E2E_PROJECT_ID);
  });

  it("refuses a production or public host for every emulator", () => {
    for (const name of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_FUNCTIONS_EMULATOR_HOST"]) {
      for (const value of ["firestore.googleapis.com:443", "8.8.8.8:8080", "127.0.0.1", "http://127.0.0.1:8080", "127.0.0.1:0", "127.0.0.1:99999"]) {
        expect(() => requireLocalEmulatorEnv({ ...LOCAL, [name]: value }), `${name}=${value}`).toThrow(UnsafeEmulatorEnvError);
      }
    }
  });

  it("uses the same host rule as the browser bootstrap", () => {
    expect(["localhost", "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.2"].every(isLocalHostname)).toBe(true);
    expect(["::1", "0.0.0.0", "1.1.1.1", "172.32.0.1", "firebase.google.com"].some(isLocalHostname)).toBe(false);
  });
});

describe("seed and reset refuse to run outside the emulator environment", () => {
  it.each([
    ["no environment", {}],
    ["the production project", { ...LOCAL, GCLOUD_PROJECT: "fitssai-coach" }],
    ["a production Firestore host", { ...LOCAL, FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" }],
    ["no Functions emulator", { ...LOCAL, FIREBASE_FUNCTIONS_EMULATOR_HOST: undefined }],
  ])("seedNutritionE2E with %s makes no request at all", async (_label, env) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(seedNutritionE2E({ env, password: "local-only-password" })).rejects.toThrow(UnsafeEmulatorEnvError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the REST helpers refuse any URL that is not one of the checked emulators", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const env = requireLocalEmulatorEnv(LOCAL);
    await expect(
      emulatorRequest(env, "https://firestore.googleapis.com/v1/projects/fitssai-coach/databases/(default)/documents", {}, "probe")
    ).rejects.toThrow(/not an emulator URL/);
    await expect(emulatorRequest(env, "http://127.0.0.1:9999/x", {}, "probe")).rejects.toThrow(/not an emulator URL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reset and callables address only the emulator endpoints of the demo project", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const env = requireLocalEmulatorEnv(LOCAL);
    await resetEmulators(env);
    await callEmulatorCallable(env, "nutritionUpdateSlot", "token", {});
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:9099/emulator/v1/projects/demo-fitssai/accounts",
      "http://127.0.0.1:8080/emulator/v1/projects/demo-fitssai/databases/(default)/documents",
      "http://127.0.0.1:5001/demo-fitssai/europe-west3/nutritionUpdateSlot",
    ]);
  });

  it("refuses a short password before touching the emulators", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(seedNutritionE2E({ env: LOCAL, password: "short" })).rejects.toThrow(/at least 8/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
