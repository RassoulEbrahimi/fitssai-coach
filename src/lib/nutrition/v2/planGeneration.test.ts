import { describe, expect, it } from "vitest";
import {
  NUTRITION_REQUEST_PLAN_ERROR_CODES,
  parseNutritionProfile,
  type GenerationRequest,
  type NutritionPlan,
  type TargetVersion,
} from "@shared/nutrition";
import deMessages from "@/messages/de.json";
import { intentUuid, makePlan, makeTarget } from "@/test/nutritionV2Fixtures";
import {
  deriveNutritionV2GenerationAction,
  nutritionV2GenerationRefusalMessage,
  nutritionV2GenerationResultMessage,
  type NutritionV2GenerationInputs,
} from "./planGeneration";

/*
  NUT-14: when the Today view offers the explicit plan-generation action.
  Pure: every precondition the product can see, fail-closed on anything
  unknown. The server stays the authority for everything it decides.
*/

const TODAY = "2026-09-26";

const PROFILE = parseNutritionProfile({
  age: 30,
  height: 172,
  weight: 68,
  fitnessGoal: "loseFat",
  dietaryPreference: "vegetarian",
  biologicalSex: "female",
  activityLevel: "moderatelyActive",
  mealsPerDay: 3,
});

const request = (status: GenerationRequest["status"]) =>
  ({ requestId: intentUuid(3), status }) as unknown as GenerationRequest;

const ready = (overrides: Partial<NutritionV2GenerationInputs> = {}): NutritionV2GenerationInputs => ({
  capability: true,
  access: { status: "eligible", uid: "alice" },
  profile: PROFILE,
  target: { status: "success", data: makeTarget() as TargetVersion },
  freshness: { status: "fresh" },
  activePlan: { status: "success", data: null },
  activeRequest: { status: "success", data: null },
  online: true,
  today: TODAY,
  ...overrides,
});

describe("deriveNutritionV2GenerationAction", () => {
  it("offers the first plan when everything holds", () => {
    expect(deriveNutritionV2GenerationAction(ready())).toEqual({ status: "available", kind: "initial" });
  });

  it("offers a regeneration over an active plan that owns today", () => {
    const plan = makePlan({ startDate: "2026-09-23" }) as NutritionPlan;
    expect(deriveNutritionV2GenerationAction(ready({ activePlan: { status: "success", data: plan } }))).toEqual({
      status: "available",
      kind: "regenerate",
    });
  });

  it.each<[string, Partial<NutritionV2GenerationInputs>]>([
    ["the backend does not offer it", { capability: false }],
    ["signed out", { access: { status: "signedOut" } }],
    ["the profile is still loading", { access: { status: "pending" } }],
    ["the profile could not be read", { access: { status: "error" } }],
    ["a minor", { access: { status: "ineligible", reason: "minor" } }],
    ["a missing age", { access: { status: "ineligible", reason: "missingAge" } }],
    ["no profile", { profile: null }],
    ["an incomplete profile", { profile: parseNutritionProfile({ age: 30 }) }],
    ["no target", { target: { status: "success", data: null } }],
    ["the target is loading", { target: { status: "pending" } }],
    ["the target could not be read", { target: { status: "error", error: new Error("x") } }],
    ["freshness still being checked", { freshness: { status: "checking" } }],
    ["freshness could not be checked", { freshness: { status: "unavailable" } }],
    ["the generation status is loading", { activeRequest: { status: "pending" } }],
    ["the generation status could not be read", { activeRequest: { status: "error", error: new Error("x") } }],
    ["a queued request", { activeRequest: { status: "success", data: request("queued") } }],
    ["a running request", { activeRequest: { status: "success", data: request("running") } }],
    ["the active plan is loading", { activePlan: { status: "pending" } }],
    ["the active plan could not be read", { activePlan: { status: "error", error: new Error("x") } }],
    ["the active plan starts tomorrow", { activePlan: { status: "success", data: makePlan({ startDate: "2026-09-27" }) as NutritionPlan } }],
    [
      "the pointer names a superseded plan",
      {
        activePlan: {
          status: "success",
          data: { ...makePlan(), lifecycle: { status: "superseded", effectiveUntil: TODAY, supersededByPlanId: "p2" } } as unknown as NutritionPlan,
        },
      },
    ],
  ])("hides the action: %s", (_label, overrides) => {
    expect(deriveNutritionV2GenerationAction(ready(overrides))).toEqual({ status: "hidden" });
  });

  it("a finished request does not block a new one", () => {
    for (const status of ["succeeded", "failed", "discarded_stale"] as const) {
      expect(deriveNutritionV2GenerationAction(ready({ activeRequest: { status: "success", data: request(status) } }))).toEqual({
        status: "available",
        kind: "initial",
      });
    }
  });

  it("a stale or uncomparable target is checked first", () => {
    expect(deriveNutritionV2GenerationAction(ready({ freshness: { status: "stale" } }))).toEqual({ status: "targetNeedsReview" });
    expect(deriveNutritionV2GenerationAction(ready({ freshness: { status: "cannotCompare" } }))).toEqual({ status: "targetNeedsReview" });
    // Only when generation is offered at all.
    expect(deriveNutritionV2GenerationAction(ready({ capability: false, freshness: { status: "stale" } }))).toEqual({ status: "hidden" });
  });

  it("keto is said, never substituted", () => {
    const keto = parseNutritionProfile({ ...PROFILE_DOC, dietaryPreference: "keto" });
    expect(deriveNutritionV2GenerationAction(ready({ profile: keto }))).toEqual({ status: "dietNotSupported" });
  });

  it("offline keeps the action visible but unavailable", () => {
    expect(deriveNutritionV2GenerationAction(ready({ online: false }))).toEqual({ status: "offline", kind: "initial" });
  });
});

const PROFILE_DOC = {
  age: 30,
  height: 172,
  weight: 68,
  fitnessGoal: "loseFat",
  biologicalSex: "female",
  activityLevel: "moderatelyActive",
  mealsPerDay: 3,
};

describe("what the person is told", () => {
  const copy = (key: string): unknown =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], deMessages.nutritionV2.generation);

  it("has fixed German copy for every refusal code and offline", () => {
    for (const code of [...NUTRITION_REQUEST_PLAN_ERROR_CODES, "offline"]) {
      const message = nutritionV2GenerationRefusalMessage(code);
      expect(message).toEqual({ tone: "error", key: `refusal.${code}` });
      expect(typeof copy(message.key), code).toBe("string");
    }
  });

  it("maps an unknown code to INTERNAL, never to its own text", () => {
    expect(nutritionV2GenerationRefusalMessage("functions/deadline-exceeded")).toEqual({ tone: "error", key: "refusal.INTERNAL" });
  });

  it("says each answer by status, for the kind asked for", () => {
    const base = { ok: true as const, requestId: intentUuid(1), replay: false };
    expect(nutritionV2GenerationResultMessage({ ...base, status: "succeeded", resultPlanId: "p", errorCode: null }, "initial").key).toBe("result.succeeded");
    expect(nutritionV2GenerationResultMessage({ ...base, status: "succeeded", resultPlanId: "p", errorCode: null }, "regenerate").key).toBe(
      "result.succeededRegenerate"
    );
    expect(nutritionV2GenerationResultMessage({ ...base, status: "failed", resultPlanId: null, errorCode: "PROVIDER_FAILED" }, "initial").key).toBe(
      "result.failed"
    );
    expect(
      nutritionV2GenerationResultMessage({ ...base, status: "discarded_stale", resultPlanId: null, errorCode: "STALE_TARGET" }, "initial").key
    ).toBe("result.discarded");
    expect(nutritionV2GenerationResultMessage({ ...base, status: "running", resultPlanId: null, errorCode: null }, "initial").key).toBe(
      "result.inProgress"
    );
  });

  it("makes no medical, safety, optimality or allergy promise, and names no internal counter", () => {
    const all = JSON.stringify(deMessages.nutritionV2.generation);
    expect(all).not.toMatch(/optimal|gesund(?!heit)|sicher für|medizinisch empfohlen|allergenfrei|garantiert frei|\d+ ?von ?\d+|Zähler|ledger/i);
    expect(copy("refusal.QUOTA_EXCEEDED")).toMatch(/Monat/);
    expect(copy("refusal.DIETARY_PREFERENCE_NOT_SUPPORTED")).toMatch(/Keto/);
    expect(copy("refusal.NUTRITION_AI_DISABLED")).toMatch(/vorübergehend/);
    expect(copy("refusal.NUTRITION_AI_DISABLED")).not.toMatch(/Gate|KI|AI|deaktiviert/);
    expect(copy("refusal.INTERNAL")).toMatch(/später noch einmal/);
  });
});
