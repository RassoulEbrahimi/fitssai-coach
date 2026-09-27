import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  NUT-10: the browser side of `nutritionUpdateSlot`, and the pure rule for
  when today's slot can be replaced. The request leaves as ids only, and every
  answer becomes a stable code — STALE_REVISION with the server's current
  revision, nothing else from the server's message.
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

import { callNutritionUpdateSlot, NutritionSlotCallError, toNutritionSlotCallError } from "./slotCallable";
import { buildNutritionDayRecordings } from "./dayRecordings";
import { resolveNutritionDay } from "./resolvedPlan";
import { nutritionSlotReplacementBlock, nutritionSlotReplacementChoices } from "./slotReplacement";
import { NUTRITION_SLOT_ERROR_CODES, type NutritionUpdateSlotRequest } from "@shared/nutrition";
import { makePlan, makeSlotHead, plannedMealEntry, removedEntry } from "@/test/nutritionV2Fixtures";

const REQUEST_ID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";
const commit: NutritionUpdateSlotRequest = {
  action: "commit",
  requestId: REQUEST_ID,
  planId: "plan-1",
  date: "2026-09-26",
  slotId: "lunch",
  expectedRevision: 0,
  replacement: { source: "planMeal", sourceMealId: "m-0-lunch" },
};
const ok = { ok: true, planId: "plan-1", date: "2026-09-26", slotId: "lunch", revision: 1, selection: { kind: "base" }, replay: false };

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as NutritionSlotCallError;
  }
  throw new Error("expected a refusal");
};

beforeEach(() => {
  functions.invoke.mockReset();
  functions.httpsCallable.mockClear();
});

describe("callNutritionUpdateSlot", () => {
  it("calls nutritionUpdateSlot in the backend region with exactly the id-only request", async () => {
    functions.invoke.mockResolvedValue({ data: ok });
    await expect(callNutritionUpdateSlot(commit)).resolves.toEqual(ok);
    expect(functions.getFunctions).toHaveBeenCalledWith(expect.anything(), "europe-west3");
    expect(functions.httpsCallable.mock.calls[0][1]).toBe("nutritionUpdateSlot");
    expect(functions.invoke.mock.calls).toEqual([[commit]]);
  });

  it.each([
    ["a uid", { uid: "bob" }],
    ["a meal name", { name: "Pizza" }],
    ["kcal", { kcal: 1 }],
    ["a meal object", { meal: { name: "x" } }],
    ["an override id", { overrideId: "00000000-0000-4000-a000-000000000001" }],
    ["a head", { head: { revision: 3 } }],
  ])("refuses to send %s, before calling", async (_label, extra) => {
    await expect(callNutritionUpdateSlot({ ...commit, ...extra } as never)).rejects.toThrow();
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it("maps STALE_REVISION with the server's current revision, and nothing else it says", async () => {
    functions.invoke.mockRejectedValue(
      Object.assign(new Error("STALE_REVISION"), { code: "functions/aborted", details: { currentRevision: 4, path: "users/x" } })
    );
    const error = await refusal(callNutritionUpdateSlot(commit));
    expect([error.code, error.currentRevision]).toEqual(["STALE_REVISION", 4]);
    expect(JSON.stringify(error)).not.toMatch(/users\/x/);
  });

  it.each(NUTRITION_SLOT_ERROR_CODES.filter((code) => code !== "UNAUTHENTICATED"))("keeps %s as its own code", (code) => {
    const error = toNutritionSlotCallError(Object.assign(new Error(code), { code: "functions/failed-precondition" }));
    expect(error.code).toBe(code);
    expect(error.currentRevision).toBeNull();
  });

  it("maps everything else to INTERNAL or UNAUTHENTICATED, never to prose", async () => {
    expect(toNutritionSlotCallError(new Error("Firestore path users/a/nutrition_v2_slots failed")).code).toBe("INTERNAL");
    expect(toNutritionSlotCallError({ code: "functions/unauthenticated", message: "x" }).code).toBe("UNAUTHENTICATED");
    functions.invoke.mockResolvedValue({ data: { ...ok, meal: { name: "x" } } });
    expect((await refusal(callNutritionUpdateSlot(commit))).code).toBe("INTERNAL");
  });
});

describe("when today's slot can be replaced", () => {
  const plan = makePlan();
  const day = (heads = [makeSlotHead("2026-09-26", "lunch")], entries = [plannedMealEntry("2026-09-26", "dinner")]) => {
    const resolved = resolveNutritionDay(plan, heads, "2026-09-26");
    if (!resolved) throw new Error("fixture");
    return buildNutritionDayRecordings(resolved, entries);
  };
  const slot = (slotId: string, recordings = day()) => recordings.slots.find((s) => s.meal.slotId === slotId)!;

  it("is blocked by an active recording first, then a pending local change, then being offline", () => {
    expect(nutritionSlotReplacementBlock({ online: false, slot: slot("dinner"), pending: { status: "queued" } as never })).toBe("recorded");
    expect(nutritionSlotReplacementBlock({ online: false, slot: slot("lunch"), pending: { status: "queued" } as never })).toBe("pendingRecord");
    expect(nutritionSlotReplacementBlock({ online: false, slot: slot("lunch"), pending: undefined })).toBe("offline");
    expect(nutritionSlotReplacementBlock({ online: true, slot: slot("lunch"), pending: undefined })).toBeNull();
    // A tombstone is no recording.
    const removed = day([], [removedEntry(plannedMealEntry("2026-09-26", "dinner"))]);
    expect(nutritionSlotReplacementBlock({ online: true, slot: slot("dinner", removed), pending: undefined })).toBeNull();
  });

  it("offers the plan's other base meals of the slot, and Undo only for a replaced slot", () => {
    const lunch = nutritionSlotReplacementChoices(plan, slot("lunch"));
    expect(lunch.canUndo).toBe(true);
    expect(lunch.planMeals.map((meal) => meal.mealId)).toEqual([0, 1, 2, 4, 5, 6].map((i) => `m-${i}-lunch`));
    expect(nutritionSlotReplacementChoices(plan, slot("breakfast")).canUndo).toBe(false);
    expect(() => nutritionSlotReplacementChoices(makePlan({ planId: "plan-2" }), slot("lunch"))).toThrow();
  });
});
