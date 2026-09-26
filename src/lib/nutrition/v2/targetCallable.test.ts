import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  NUT-08: the browser side of `nutritionSetTarget`. The request leaves as
  exactly `{ mode, requestId }`, and every answer becomes a stable code —
  field names at most, never a value or a server message.
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

import { callNutritionSetTarget, NutritionTargetCallError, toNutritionTargetCallError } from "./targetCallable";

const REQUEST_ID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as NutritionTargetCallError;
  }
  throw new Error("expected a refusal");
};

beforeEach(() => {
  functions.invoke.mockReset();
  functions.httpsCallable.mockClear();
  functions.getFunctions.mockClear();
});

describe("callNutritionSetTarget", () => {
  it("calls nutritionSetTarget in the backend region with exactly mode and requestId", async () => {
    functions.invoke.mockResolvedValue({ data: { ok: true, targetVersionId: "tv-1", replay: false } });

    const result = await callNutritionSetTarget({ mode: "calculated", requestId: REQUEST_ID });

    expect(result).toEqual({ ok: true, targetVersionId: "tv-1", replay: false });
    expect(functions.getFunctions).toHaveBeenCalledWith(expect.anything(), "europe-west3");
    expect(functions.httpsCallable.mock.calls[0][1]).toBe("nutritionSetTarget");
    expect(functions.invoke.mock.calls).toEqual([[{ mode: "calculated", requestId: REQUEST_ID }]]);
  });

  it("refuses to send anything else, before calling", async () => {
    const withExtras = { mode: "manual", requestId: REQUEST_ID, uid: "bob", weight: 70, manualTargetKcal: 2000 };
    await expect(callNutritionSetTarget(withExtras as never)).rejects.toThrow();
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it("treats a malformed answer as INTERNAL", async () => {
    functions.invoke.mockResolvedValue({ data: { ok: true, targetVersionId: "../evil" } });
    expect((await refusal(callNutritionSetTarget({ mode: "manual", requestId: REQUEST_ID }))).code).toBe("INTERNAL");
  });

  it("maps a server refusal to its code", async () => {
    functions.invoke.mockRejectedValue(
      Object.assign(new Error("TARGET_POLICY_NOT_CONFIGURED"), { code: "functions/failed-precondition" })
    );
    const error = await refusal(callNutritionSetTarget({ mode: "manual", requestId: REQUEST_ID }));
    expect(error).toBeInstanceOf(NutritionTargetCallError);
    expect(error.code).toBe("TARGET_POLICY_NOT_CONFIGURED");
  });
});

describe("toNutritionTargetCallError", () => {
  it("keeps only known field names from PROFILE_INCOMPLETE", () => {
    const error = toNutritionTargetCallError({
      code: "functions/failed-precondition",
      message: "PROFILE_INCOMPLETE",
      details: { missingFields: ["height", "users/alice", 70], invalidFields: ["weight", "bodyFat"] },
    });
    expect(error.code).toBe("PROFILE_INCOMPLETE");
    expect(error.missingFields).toEqual(["height"]);
    expect(error.invalidFields).toEqual(["weight"]);
  });

  it.each([
    [{ code: "functions/unauthenticated", message: "Authentication required." }, "UNAUTHENTICATED"],
    [{ code: "functions/permission-denied", message: "NOT_ELIGIBLE" }, "NOT_ELIGIBLE"],
    [{ code: "functions/invalid-argument", message: "INVALID_REQUEST" }, "INVALID_REQUEST"],
    [{ code: "functions/internal", message: "INTERNAL" }, "INTERNAL"],
    [{ code: "functions/unavailable", message: "Failed to fetch" }, "INTERNAL"],
    [{ code: "functions/internal", message: "users/alice/nutrition_v2_state: boom" }, "INTERNAL"],
    [new TypeError("x is undefined"), "INTERNAL"],
    [null, "INTERNAL"],
  ])("maps %j to %s", (thrown, code) => {
    const error = toNutritionTargetCallError(thrown);
    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
  });
});
