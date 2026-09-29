import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { RESET_VALUE } from "firebase-functions/v2/options";
import * as functions from "./index";
import { FUNCTIONS_REGION, NUTRITION_GENERATION_SERVICE_ACCOUNT } from "./config";

/*
  RUNTIME-IAM-02: `nutritionRequestPlan` runs as its own least-privilege
  account, and nothing else changes identity. Checked twice: on the deploy
  manifest each export carries (what firebase-tools reads), and on the source,
  so the value stays a reviewed literal no environment or parameter can move.
*/

const FUNCTIONS_ROOT = join(__dirname, "..");
const REPO_ROOT = join(FUNCTIONS_ROOT, "..");
const posix = (value: string) => value.split(/[\\/]/).join("/");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = (file: string) => stripComments(readFileSync(join(FUNCTIONS_ROOT, file), "utf-8"));

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.ts$/.test(full) ? [full] : [];
  });

const DEDICATED = "fitssai-nutrition-generation@fitssai-coach.iam.gserviceaccount.com";
const OTHER_FUNCTIONS = [
  "coachBackendStatus",
  "generateWorkoutPlan",
  "generateWeeklyReview",
  "nutritionSetTarget",
  "nutritionRepeatPlan",
  "nutritionUpdateSlot",
] as const;

type Endpoint = (typeof functions.nutritionRequestPlan)["__endpoint"];

/** The deploy manifest entry firebase-tools reads for one export. */
const endpoint = (name: keyof typeof functions): Endpoint => {
  const value = (functions[name] as { __endpoint?: Endpoint }).__endpoint;
  expect(value, name).toBeDefined();
  return value as Endpoint;
};

describe("the nutritionRequestPlan runtime identity (RUNTIME-IAM-02)", () => {
  it("is the dedicated account, as an exact literal", () => {
    expect(NUTRITION_GENERATION_SERVICE_ACCOUNT).toBe(DEDICATED);
    expect(endpoint("nutritionRequestPlan").serviceAccountEmail).toBe(DEDICATED);
  });

  it("is declared once, on nutritionRequestPlan's options, from the config constant", () => {
    const index = code("src/index.ts");
    expect([...index.matchAll(/serviceAccount/g)]).toHaveLength(1);
    const start = index.indexOf("export const nutritionRequestPlan = onCall(");
    const options = index.slice(index.indexOf("{", start), index.indexOf("}", start) + 1);
    expect(options).toMatch(/^\s*serviceAccount: NUTRITION_GENERATION_SERVICE_ACCOUNT,$/m);
  });

  it("is given to none of the other six Functions, which keep the SDK default", () => {
    for (const name of OTHER_FUNCTIONS) {
      expect(endpoint(name).serviceAccountEmail, name).toBe(RESET_VALUE);
      expect(JSON.stringify(endpoint(name)), name).not.toContain(DEDICATED);
    }
    const holders = walk(join(FUNCTIONS_ROOT, "src"))
      .filter((file) => !/\.test\.ts$/.test(file))
      .filter((file) => readFileSync(file, "utf-8").includes(DEDICATED))
      .map((file) => posix(relative(FUNCTIONS_ROOT, file)));
    expect(holders).toEqual(["src/config.ts"]);
  });

  it("cannot be overridden by an environment variable or parameter", () => {
    expect(code("src/config.ts")).toContain(`export const NUTRITION_GENERATION_SERVICE_ACCOUNT = "${DEDICATED}";`);
    expect(typeof endpoint("nutritionRequestPlan").serviceAccountEmail).toBe("string");
    for (const file of ["src/config.ts", "src/index.ts"]) {
      expect(code(file), file).not.toMatch(/process\.env|NODE_ENV|FUNCTIONS_EMULATOR|VITEST|defineString|defineBoolean|defineInt|defineList|defineJsonSecret|projectID|PROJECT_NUMBER/);
    }
  });

  it("leaves the build identity alone: no build service account anywhere in the deploy configuration", () => {
    const firebaseJson = readFileSync(join(REPO_ROOT, "firebase.json"), "utf-8");
    expect(firebaseJson).not.toMatch(/serviceAccount|buildConfig|cloudbuild/i);
    for (const file of ["src/config.ts", "src/index.ts"]) {
      expect(code(file), file).not.toMatch(/buildConfig|buildServiceAccount|cloudbuild/i);
    }
  });

  it("keeps nutritionRequestPlan's execution budget: europe-west3, 240 s, 256 MiB, five instances, no secret", () => {
    const plan = endpoint("nutritionRequestPlan");
    expect(plan.region).toEqual([FUNCTIONS_REGION]);
    expect(plan.timeoutSeconds).toBe(240);
    expect(plan.availableMemoryMb).toBe(256);
    expect(plan.maxInstances).toBe(5);
    expect(plan.secretEnvironmentVariables).toBeUndefined();
    expect(plan.callableTrigger).toEqual({});
  });
});
