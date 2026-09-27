import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  NUT-09: the browser side of `nutritionRepeatPlan`. The request leaves as
  exactly `{ requestId }`, and every answer becomes a stable code — never a
  server message, a path or a plan's content.
*/

const functions = vi.hoisted(() => {
  const invoke = vi.fn();
  return {
    invoke,
    getFunctions: vi.fn(() => ({ region: "europe-west3" })),
    httpsCallable: vi.fn((_functions: unknown, _name: string) => invoke),
  };
});

vi.mock("firebase/app", () => ({ getApp: () => ({}) }));
vi.mock("firebase/functions", () => ({ getFunctions: functions.getFunctions, httpsCallable: functions.httpsCallable }));

import { callNutritionRepeatPlan, NutritionPlanCallError, toNutritionPlanCallError } from "./planCallable";

const REQUEST_ID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as NutritionPlanCallError;
  }
  throw new Error("expected a refusal");
};

beforeEach(() => {
  functions.invoke.mockReset();
  functions.httpsCallable.mockClear();
  functions.getFunctions.mockClear();
});

describe("callNutritionRepeatPlan", () => {
  it("calls nutritionRepeatPlan in the backend region with exactly the request id", async () => {
    functions.invoke.mockResolvedValue({ data: { ok: true, planId: "plan-2", replay: false } });

    const result = await callNutritionRepeatPlan({ requestId: REQUEST_ID });

    expect(result).toEqual({ ok: true, planId: "plan-2", replay: false });
    expect(functions.getFunctions).toHaveBeenCalledWith(expect.anything(), "europe-west3");
    expect(functions.httpsCallable.mock.calls[0][1]).toBe("nutritionRepeatPlan");
    expect(functions.invoke.mock.calls).toEqual([[{ requestId: REQUEST_ID }]]);
  });

  it.each([
    ["a uid", { uid: "bob" }],
    ["a plan id", { planId: "plan-mine" }],
    ["a target", { targetVersionId: "tv-9" }],
    ["a start date", { startDate: "2026-10-01" }],
    ["meal content", { days: [] }],
    ["slot heads", { slotHeads: [] }],
  ])("refuses to send %s, before calling", async (_name, extra) => {
    await expect(callNutritionRepeatPlan({ requestId: REQUEST_ID, ...extra } as never)).rejects.toThrow();
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it("refuses a request id that is not a lower-case UUID, before calling", async () => {
    await expect(callNutritionRepeatPlan({ requestId: REQUEST_ID.toUpperCase() })).rejects.toThrow();
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it("treats a malformed answer as INTERNAL", async () => {
    functions.invoke.mockResolvedValue({ data: { ok: true, planId: "../evil", replay: false } });
    expect((await refusal(callNutritionRepeatPlan({ requestId: REQUEST_ID }))).code).toBe("INTERNAL");
  });

  it("maps a server refusal to its code", async () => {
    functions.invoke.mockRejectedValue(
      Object.assign(new Error("PLAN_VALIDATION_POLICY_NOT_CONFIGURED"), { code: "functions/failed-precondition" })
    );
    const error = await refusal(callNutritionRepeatPlan({ requestId: REQUEST_ID }));
    expect(error).toBeInstanceOf(NutritionPlanCallError);
    expect(error.code).toBe("PLAN_VALIDATION_POLICY_NOT_CONFIGURED");
  });
});

describe("toNutritionPlanCallError", () => {
  it.each([
    [{ code: "functions/unauthenticated", message: "Authentication required." }, "UNAUTHENTICATED"],
    [{ code: "functions/permission-denied", message: "NOT_ELIGIBLE" }, "NOT_ELIGIBLE"],
    [{ code: "functions/failed-precondition", message: "TARGET_CHANGED" }, "TARGET_CHANGED"],
    [{ code: "functions/failed-precondition", message: "NO_ACTIVE_PLAN" }, "NO_ACTIVE_PLAN"],
    [{ code: "functions/failed-precondition", message: "PLAN_NOT_REPEATABLE" }, "PLAN_NOT_REPEATABLE"],
    [{ code: "functions/aborted", message: "STALE_ACTIVE_PLAN" }, "STALE_ACTIVE_PLAN"],
    [{ code: "functions/aborted", message: "STALE_TARGET" }, "STALE_TARGET"],
    [{ code: "functions/internal", message: "INTERNAL" }, "INTERNAL"],
    [{ code: "functions/unavailable", message: "Failed to fetch" }, "INTERNAL"],
    [{ code: "functions/internal", message: "users/alice/nutrition_v2_plans/plan-1: boom" }, "INTERNAL"],
    // Another callable's code is not this one's.
    [{ code: "functions/failed-precondition", message: "TARGET_POLICY_NOT_CONFIGURED" }, "INTERNAL"],
    [new TypeError("x is undefined"), "INTERNAL"],
    [null, "INTERNAL"],
  ])("maps %j to %s", (thrown, code) => {
    const error = toNutritionPlanCallError(thrown);
    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
  });
});
