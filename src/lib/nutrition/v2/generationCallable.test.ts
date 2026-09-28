import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  NUT-11: the browser side of `nutritionRequestPlan`. The request leaves as
  exactly `{ requestId }`, a refusal becomes a stable code, and an answer is
  the request's state — never a server message, a path or a plan.
*/

const functions = vi.hoisted(() => {
  const invoke = vi.fn();
  return {
    invoke,
    getFunctions: vi.fn(() => ({ region: "europe-west3" })),
    httpsCallable: vi.fn((_functions: unknown, _name: string, _options?: unknown) => invoke),
  };
});

vi.mock("firebase/app", () => ({ getApp: () => ({}) }));
vi.mock("firebase/functions", () => ({ getFunctions: functions.getFunctions, httpsCallable: functions.httpsCallable }));

import { callNutritionRequestPlan, NutritionRequestPlanCallError, toNutritionRequestPlanCallError } from "./generationCallable";

const REQUEST_ID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";
const answer = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  requestId: REQUEST_ID,
  status: "running",
  resultPlanId: null,
  errorCode: null,
  replay: false,
  ...overrides,
});

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as NutritionRequestPlanCallError;
  }
  throw new Error("expected a refusal");
};

beforeEach(() => {
  functions.invoke.mockReset();
  functions.httpsCallable.mockClear();
  functions.getFunctions.mockClear();
});

describe("callNutritionRequestPlan", () => {
  it("calls nutritionRequestPlan in the backend region with exactly the request id", async () => {
    functions.invoke.mockResolvedValue({ data: answer() });

    expect(await callNutritionRequestPlan({ requestId: REQUEST_ID })).toEqual(answer());
    expect(functions.getFunctions).toHaveBeenCalledWith(expect.anything(), "europe-west3");
    expect(functions.httpsCallable.mock.calls[0][1]).toBe("nutritionRequestPlan");
    // NUT-12C.2: its own 300-second timeout, never the SDK default.
    expect(functions.httpsCallable.mock.calls[0][2]).toEqual({ timeout: 300_000 });
    expect(functions.invoke.mock.calls).toEqual([[{ requestId: REQUEST_ID }]]);
  });

  it.each([
    ["succeeded", { status: "succeeded", resultPlanId: "plan-2" }],
    ["failed", { status: "failed", errorCode: "PROVIDER_FAILED" }],
    ["discarded", { status: "discarded_stale", errorCode: "STALE_ACTIVE_PLAN", replay: true }],
    ["discarded after an eligibility change", { status: "discarded_stale", errorCode: "ELIGIBILITY_CHANGED" }],
    ["another request running", { requestId: "00000000-0000-4000-8000-000000000012" }],
  ])("returns a %s answer as it is", async (_label, overrides) => {
    functions.invoke.mockResolvedValue({ data: answer(overrides) });
    expect(await callNutritionRequestPlan({ requestId: REQUEST_ID })).toEqual(answer(overrides));
  });

  it.each([
    ["a uid", { uid: "bob" }],
    ["a kind", { kind: "initial" }],
    ["a base plan", { basePlanId: "plan-1" }],
    ["a target", { targetVersionId: "tv-9" }],
    ["a state revision", { stateRevision: 4 }],
    ["profile values", { age: 34, weight: 70, dietaryPreference: "vegan", mealsPerDay: 3 }],
    ["exclusions", { excludedFoodCategories: ["x"] }],
    ["plan content", { days: [] }],
    ["a provider", { provider: "gemini", model: "m", prompt: "p" }],
    ["a quota", { quota: 99 }],
  ])("refuses to send %s, before calling", async (_name, extra) => {
    await expect(callNutritionRequestPlan({ requestId: REQUEST_ID, ...extra } as never)).rejects.toThrow();
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it("refuses a request id that is not a lower-case UUID, before calling", async () => {
    await expect(callNutritionRequestPlan({ requestId: REQUEST_ID.toUpperCase() })).rejects.toThrow();
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["a succeeded answer without its plan", { status: "succeeded" }],
    ["a failed answer without a code", { status: "failed" }],
    ["an unknown status", { status: "cancelled" }],
    ["an unknown code", { status: "failed", errorCode: "sk-live-secret" }],
    ["an extra field", { prompt: "leaked" }],
  ])("treats %s as INTERNAL", async (_label, overrides) => {
    functions.invoke.mockResolvedValue({ data: answer(overrides) });
    expect((await refusal(callNutritionRequestPlan({ requestId: REQUEST_ID }))).code).toBe("INTERNAL");
  });

  it("maps the production refusal to its code", async () => {
    functions.invoke.mockRejectedValue(Object.assign(new Error("NUTRITION_AI_DISABLED"), { code: "functions/failed-precondition" }));
    const error = await refusal(callNutritionRequestPlan({ requestId: REQUEST_ID }));
    expect(error).toBeInstanceOf(NutritionRequestPlanCallError);
    expect(error.code).toBe("NUTRITION_AI_DISABLED");
  });

  it("maps an unconfigured generator to its own code, distinct from the disabled gate", async () => {
    functions.invoke.mockRejectedValue(
      Object.assign(new Error("GENERATION_PROVIDER_NOT_CONFIGURED"), { code: "functions/failed-precondition" })
    );
    const error = await refusal(callNutritionRequestPlan({ requestId: REQUEST_ID }));
    expect(error).toBeInstanceOf(NutritionRequestPlanCallError);
    expect(error.code).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
  });
});

describe("toNutritionRequestPlanCallError", () => {
  it.each([
    [{ code: "functions/unauthenticated", message: "Authentication required." }, "UNAUTHENTICATED"],
    [{ code: "functions/permission-denied", message: "NOT_ELIGIBLE" }, "NOT_ELIGIBLE"],
    [{ code: "functions/failed-precondition", message: "PLAN_VALIDATION_POLICY_NOT_CONFIGURED" }, "PLAN_VALIDATION_POLICY_NOT_CONFIGURED"],
    [{ code: "functions/failed-precondition", message: "PLAN_NOT_REGENERABLE" }, "PLAN_NOT_REGENERABLE"],
    [{ code: "functions/failed-precondition", message: "GENERATION_SLOTS_NOT_CONFIGURED" }, "GENERATION_SLOTS_NOT_CONFIGURED"],
    [{ code: "functions/failed-precondition", message: "QUOTA_EXCEEDED" }, "QUOTA_EXCEEDED"],
    [{ code: "functions/failed-precondition", message: "DIETARY_PREFERENCE_NOT_SUPPORTED" }, "DIETARY_PREFERENCE_NOT_SUPPORTED"],
    [{ code: "functions/internal", message: "users/alice/nutrition_v2_generations/x: boom" }, "INTERNAL"],
    [{ code: "functions/unavailable", message: "Failed to fetch" }, "INTERNAL"],
    // Another callable's code is not this one's.
    [{ code: "functions/aborted", message: "STALE_REVISION" }, "INTERNAL"],
    [new TypeError("x is undefined"), "INTERNAL"],
    [null, "INTERNAL"],
  ])("maps %j to %s", (thrown, code) => {
    const error = toNutritionRequestPlanCallError(thrown);
    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
  });
});
