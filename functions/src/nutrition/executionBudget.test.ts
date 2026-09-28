import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NUTRITION_REQUEST_PLAN_CLIENT_TIMEOUT_MS } from "../../../shared/nutrition";
import { TRANSPORT_RETRY_BACKOFF_MS } from "../ai/googleGenai";
import { CLAIM_LEASE_MS } from "../idempotency";
import { PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT } from "./providers/productionRegistry";

/*
  NUT-12C.2: the execution budget of `nutritionRequestPlan`, as one chain.

    provider attempt     45 s, at most 2 transport attempts (429/5xx only;
                         a timeout is not retried), 250 ms back-off between
    one generation       a first call and at most one repair
    worst provider time  2 × (2 × 45 s + 0.25 s) = 180.5 s
    Function timeout     240 s — the provider time fits, with room for the
                         claim and finalisation transactions
    operation lease      300 s — longer than the Function can run, so a claim
                         is never taken over while its invocation still runs
    browser timeout      300 s — the browser waits as long as the claim lasts

  A change to any link that breaks the chain fails here, and so does a return
  to the NUT-11 placeholders (a 30-second Function, the SDK's default browser
  timeout, a 105-second lease).
*/

const FUNCTIONS_ROOT = join(__dirname, "..", "..");
const REPO_ROOT = join(FUNCTIONS_ROOT, "..");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const INDEX = stripComments(readFileSync(join(FUNCTIONS_ROOT, "src", "index.ts"), "utf-8"));

/** The options object of one exported callable in src/index.ts. */
const callableOptions = (name: string): string => {
  const start = INDEX.indexOf(`export const ${name} = onCall(`);
  expect(start, name).toBeGreaterThan(-1);
  const open = INDEX.indexOf("{", start);
  return INDEX.slice(open, INDEX.indexOf("}", open) + 1);
};

const numberSetting = (options: string, key: string): number | undefined => {
  const match = new RegExp(`${key}:\\s*([\\d_]+)`).exec(options);
  return match ? Number(match[1].replace(/_/g, "")) : undefined;
};

const { provider, operationLeaseMs } = PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT;

/** Two provider calls (generate, then one repair), each exhausting its transport attempts. */
const worstCaseProviderMs = (): number => {
  let backoff = 0;
  for (let attempt = 1; attempt < provider.maxTransportAttempts; attempt += 1) backoff += TRANSPORT_RETRY_BACKOFF_MS * attempt;
  return 2 * (provider.maxTransportAttempts * provider.timeoutMs + backoff);
};

describe("the Nutrition generation execution budget", () => {
  it("pins each link: 45 s × 2 attempts, 240 s Function, 300 s lease, 300 s browser", () => {
    expect(provider.timeoutMs).toBe(45_000);
    expect(provider.maxTransportAttempts).toBe(2);
    expect(TRANSPORT_RETRY_BACKOFF_MS).toBe(250);
    expect(numberSetting(callableOptions("nutritionRequestPlan"), "timeoutSeconds")).toBe(240);
    expect(operationLeaseMs).toBe(300_000);
    expect(NUTRITION_REQUEST_PLAN_CLIENT_TIMEOUT_MS).toBe(300_000);
  });

  it("keeps the chain intact: worst provider time < Function timeout < operation lease <= browser timeout", () => {
    const providerMs = worstCaseProviderMs();
    const functionMs = (numberSetting(callableOptions("nutritionRequestPlan"), "timeoutSeconds") ?? 0) * 1000;
    expect(providerMs).toBe(180_500);
    expect(providerMs).toBeLessThanOrEqual(181_000);
    expect(providerMs).toBeLessThan(functionMs);
    expect(functionMs).toBeLessThan(operationLeaseMs);
    expect(operationLeaseMs).toBeLessThanOrEqual(NUTRITION_REQUEST_PLAN_CLIENT_TIMEOUT_MS);
  });

  it("never returns to the NUT-11 placeholders: a 30 s Function, the SDK's default browser timeout, a 105 s lease", () => {
    expect(numberSetting(callableOptions("nutritionRequestPlan"), "timeoutSeconds")).not.toBe(30);
    expect(operationLeaseMs).not.toBe(105_000);
    const callable = stripComments(readFileSync(join(REPO_ROOT, "src", "lib", "nutrition", "v2", "generationCallable.ts"), "utf-8"));
    expect(callable).toMatch(/NUTRITION_REQUEST_PLAN_CALLABLE,\s*\{ timeout: NUTRITION_REQUEST_PLAN_CLIENT_TIMEOUT_MS \}\s*\)/);
    // The SDK's default is 70 s; the explicit timeout is well past it.
    expect(NUTRITION_REQUEST_PLAN_CLIENT_TIMEOUT_MS).toBeGreaterThan(70_000);
  });

  it("changes nothing else about nutritionRequestPlan: 256 MiB, five instances, no secret", () => {
    const options = callableOptions("nutritionRequestPlan");
    expect(options).toMatch(/memory: "256MiB"/);
    expect(numberSetting(options, "maxInstances")).toBe(5);
    expect(options).not.toMatch(/secrets/);
  });

  it("changes no other Function's budget, and not Training's lease", () => {
    const budgets = Object.fromEntries(
      ["coachBackendStatus", "generateWorkoutPlan", "generateWeeklyReview", "nutritionSetTarget", "nutritionRepeatPlan", "nutritionUpdateSlot"].map((name) => {
        const options = callableOptions(name);
        return [name, [numberSetting(options, "timeoutSeconds") ?? null, numberSetting(options, "maxInstances"), /memory: "(\w+)"/.exec(options)?.[1] ?? null]];
      })
    );
    expect(budgets).toEqual({
      coachBackendStatus: [null, 3, null],
      generateWorkoutPlan: [180, 5, "512MiB"],
      generateWeeklyReview: [60, 5, "256MiB"],
      nutritionSetTarget: [30, 5, "256MiB"],
      nutritionRepeatPlan: [30, 5, "256MiB"],
      nutritionUpdateSlot: [30, 5, "256MiB"],
    });
    expect(CLAIM_LEASE_MS).toBe(240_000);
  });
});
