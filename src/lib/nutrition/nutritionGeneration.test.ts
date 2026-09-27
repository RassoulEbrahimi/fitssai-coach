import { describe, expect, it } from "vitest";
import {
  GENERATION_REQUEST_KINDS,
  GENERATION_REQUEST_STATUSES,
  NUTRITION_GENERATION_FAILURE_CODES,
  NUTRITION_GENERATION_STALE_CODES,
  NUTRITION_REQUEST_PLAN_CALLABLE,
  assertGenerationRequestTransition,
  generationRequestSchema,
  isTerminalGenerationRequestStatus,
  nutritionGenerationIdempotencyKey,
  nutritionRequestPlanRequestSchema,
  nutritionRequestPlanResultSchema,
  type GenerationRequest,
} from "@shared/nutrition";

/*
  NUT-11: the one GenerationRequest contract. Forward-only lifecycle, strict
  combinations, no prompt or provider payload, and a callable that takes
  exactly `{ requestId }`.
*/

const RID = "00000000-0000-4000-8000-000000000011";
const T0 = { seconds: 1_790_000_000, nanoseconds: 0 };
const T1 = { seconds: 1_790_000_060, nanoseconds: 0 };
const T2 = { seconds: 1_790_000_120, nanoseconds: 0 };

const running = (overrides: Partial<Record<keyof GenerationRequest, unknown>> = {}) => ({
  schemaVersion: 2,
  requestId: RID,
  idempotencyKey: `nutritionPlan:${RID}`,
  kind: "regenerate",
  basePlanId: "plan-1",
  targetVersionId: "target-1",
  payloadFingerprint: "d".repeat(64),
  status: "running",
  resultPlanId: null,
  errorCode: null,
  createdAt: T0,
  finishedAt: null,
  acknowledgedAt: null,
  ...overrides,
});

const succeeded = (overrides = {}) => running({ status: "succeeded", resultPlanId: "plan-2", finishedAt: T1, ...overrides });
const failed = (overrides = {}) => running({ status: "failed", errorCode: "PROVIDER_FAILED", finishedAt: T1, ...overrides });
const discarded = (overrides = {}) => running({ status: "discarded_stale", errorCode: "STALE_ACTIVE_PLAN", finishedAt: T1, ...overrides });

const parses = (value: unknown) => generationRequestSchema.safeParse(value).success;

describe("the GenerationRequest contract", () => {
  it("has exactly the canonical kinds and statuses — no cancelled, paused, draft, retrying or superseded", () => {
    expect([...GENERATION_REQUEST_KINDS]).toEqual(["initial", "regenerate"]);
    expect([...GENERATION_REQUEST_STATUSES]).toEqual(["queued", "running", "succeeded", "failed", "discarded_stale"]);
    for (const status of ["cancelled", "paused", "draft", "retrying", "superseded"]) {
      expect(parses(running({ status })), status).toBe(false);
    }
  });

  it("parses every canonical status in its valid shape", () => {
    expect(parses(running({ status: "queued" }))).toBe(true);
    expect(parses(running())).toBe(true);
    expect(parses(succeeded())).toBe(true);
    expect(parses(failed())).toBe(true);
    expect(parses(discarded())).toBe(true);
  });

  it("parses both kinds, and ties the base plan to the kind", () => {
    expect(parses(running({ kind: "initial", basePlanId: null }))).toBe(true);
    expect(parses(running({ kind: "initial", basePlanId: "plan-1" }))).toBe(false);
    expect(parses(running({ kind: "regenerate", basePlanId: null }))).toBe(false);
  });

  it.each(["requestId", "idempotencyKey", "kind", "basePlanId", "targetVersionId", "payloadFingerprint", "createdAt", "status", "schemaVersion"])(
    "requires %s",
    (field) => {
      const request: Record<string, unknown> = running();
      delete request[field];
      expect(parses(request)).toBe(false);
    }
  );

  it("keys the request as nutritionPlan:{requestId}, in lower-case UUID form", () => {
    expect(nutritionGenerationIdempotencyKey(RID)).toBe(`nutritionPlan:${RID}`);
    expect(parses(running({ idempotencyKey: RID }))).toBe(false);
    expect(parses(running({ idempotencyKey: `workoutPlan:${RID}` }))).toBe(false);
    const upper = "3F1A6F28-9C4E-4A1B-8F2D-77C0B5E1A9D4";
    expect(parses(running({ requestId: upper, idempotencyKey: `nutritionPlan:${upper}` }))).toBe(false);
    expect(parses(running({ requestId: "gen-1", idempotencyKey: "nutritionPlan:gen-1" }))).toBe(false);
  });

  it("keeps the fingerprint a SHA-256 hex digest", () => {
    expect(parses(running({ payloadFingerprint: "D".repeat(64) }))).toBe(false);
    expect(parses(running({ payloadFingerprint: "d".repeat(63) }))).toBe(false);
    expect(parses(running({ payloadFingerprint: '{"target":{"kcal":1800}}' }))).toBe(false);
  });

  it("a succeeded request names its result plan, a new one, and carries no error", () => {
    expect(parses(succeeded({ resultPlanId: null }))).toBe(false);
    expect(parses(succeeded({ resultPlanId: "plan-1" }))).toBe(false);
    expect(parses(succeeded({ errorCode: "PROVIDER_FAILED" }))).toBe(false);
  });

  it("a failed request carries a stable failure code and no result plan", () => {
    for (const code of NUTRITION_GENERATION_FAILURE_CODES) expect(parses(failed({ errorCode: code })), code).toBe(true);
    expect(parses(failed({ errorCode: null }))).toBe(false);
    expect(parses(failed({ errorCode: "STALE_TARGET" }))).toBe(false);
    expect(parses(failed({ errorCode: "Gemini said: quota exceeded for project 123" }))).toBe(false);
    expect(parses(failed({ resultPlanId: "plan-2" }))).toBe(false);
  });

  it("a discarded request carries a stale code and no result plan", () => {
    expect([...NUTRITION_GENERATION_STALE_CODES]).toEqual([
      "STALE_ACTIVE_PLAN",
      "STALE_TARGET",
      "STALE_GENERATION",
      "INPUT_CHANGED",
      "ELIGIBILITY_CHANGED",
    ]);
    for (const code of NUTRITION_GENERATION_STALE_CODES) expect(parses(discarded({ errorCode: code })), code).toBe(true);
    // An eligibility change is a stale precondition, never a provider or validation failure.
    expect(parses(failed({ errorCode: "ELIGIBILITY_CHANGED" }))).toBe(false);
    expect((NUTRITION_GENERATION_FAILURE_CODES as readonly string[]).includes("ELIGIBILITY_CHANGED")).toBe(false);
    expect(parses(discarded({ errorCode: "PROVIDER_FAILED" }))).toBe(false);
    expect(parses(discarded({ resultPlanId: "plan-2" }))).toBe(false);
  });

  it("an unfinished request has not finished, has no outcome and is not acknowledged", () => {
    for (const status of ["queued", "running"]) {
      expect(parses(running({ status, finishedAt: T1 }))).toBe(false);
      expect(parses(running({ status, resultPlanId: "plan-2" }))).toBe(false);
      expect(parses(running({ status, errorCode: "PROVIDER_FAILED" }))).toBe(false);
      expect(parses(running({ status, acknowledgedAt: T1 }))).toBe(false);
    }
  });

  it("a terminal request has finished, not before it was created; it is acknowledged, if at all, after", () => {
    expect(parses(succeeded({ finishedAt: null }))).toBe(false);
    expect(parses(succeeded({ finishedAt: { seconds: T0.seconds - 1, nanoseconds: 0 } }))).toBe(false);
    expect(parses(succeeded({ acknowledgedAt: T2 }))).toBe(true);
    expect(parses(succeeded({ acknowledgedAt: T0 }))).toBe(false);
  });

  it.each([
    ["an ISO string", "2026-09-28T09:15:00Z"],
    ["epoch millis", 1_790_000_000_000],
    ["fractional seconds", { seconds: 1.5, nanoseconds: 0 }],
    ["out-of-range nanoseconds", { seconds: 1, nanoseconds: 1_000_000_000 }],
  ])("refuses a timestamp as %s", (_label, createdAt) => {
    expect(parses(running({ createdAt }))).toBe(false);
  });

  it.each(["prompt", "response", "providerResponse", "payload", "input", "rawOutput", "model", "provider", "uid", "profile", "quota", "claimToken", "leaseExpiresAt"])(
    "refuses a %s field: nothing but the contract is stored",
    (field) => {
      expect(parses({ ...running(), [field]: "x" })).toBe(false);
    }
  );

  it("names the terminal statuses", () => {
    expect(GENERATION_REQUEST_STATUSES.filter(isTerminalGenerationRequestStatus)).toEqual(["succeeded", "failed", "discarded_stale"]);
  });
});

describe("the forward-only lifecycle", () => {
  const ok = (before: unknown, after: unknown) => expect(() => assertGenerationRequestTransition(before, after)).not.toThrow();
  const refused = (before: unknown, after: unknown) => expect(() => assertGenerationRequestTransition(before, after)).toThrow();

  it("moves queued → running → one terminal status, or straight to one", () => {
    ok(running({ status: "queued" }), running());
    ok(running(), succeeded());
    ok(running(), failed());
    ok(running(), discarded());
    ok(running({ status: "queued" }), failed());
  });

  it("never goes back, and never from one outcome to another", () => {
    refused(running(), running({ status: "queued" }));
    refused(succeeded(), running());
    refused(failed(), running());
    refused(failed(), succeeded());
    refused(discarded(), failed({ errorCode: "INTERNAL" }));
    refused(failed(), failed({ errorCode: "INTERNAL" }));
    refused(succeeded(), succeeded({ resultPlanId: "plan-3" }));
    refused(succeeded(), succeeded({ finishedAt: T2 }));
  });

  it("acknowledges a terminal request once", () => {
    ok(succeeded(), succeeded({ acknowledgedAt: T2 }));
    ok(succeeded({ acknowledgedAt: T2 }), succeeded({ acknowledgedAt: T2 }));
    refused(succeeded({ acknowledgedAt: T2 }), succeeded({ acknowledgedAt: { seconds: T2.seconds + 1, nanoseconds: 0 } }));
    refused(succeeded({ acknowledgedAt: T2 }), succeeded());
  });

  it.each([
    ["requestId", { requestId: "00000000-0000-4000-8000-000000000012", idempotencyKey: "nutritionPlan:00000000-0000-4000-8000-000000000012" }],
    ["kind", { kind: "initial", basePlanId: null }],
    ["basePlanId", { basePlanId: "plan-9" }],
    ["targetVersionId", { targetVersionId: "target-2" }],
    ["payloadFingerprint", { payloadFingerprint: "e".repeat(64) }],
    ["createdAt", { createdAt: T1 }],
  ])("never rewrites %s — not for a profile change, a new target, another plan or a takeover", (_field, change) => {
    refused(running(), running(change));
    refused(running(), succeeded(change));
  });

  it("refuses a side that is not a valid request", () => {
    refused(running({ status: "cancelled" }), failed());
    refused(running(), { ...failed(), prompt: "x" });
  });
});

describe("the nutritionRequestPlan callable contract", () => {
  it("is named nutritionRequestPlan and takes exactly one lower-case request id", () => {
    expect(NUTRITION_REQUEST_PLAN_CALLABLE).toBe("nutritionRequestPlan");
    expect(nutritionRequestPlanRequestSchema.safeParse({ requestId: RID }).success).toBe(true);
    expect(nutritionRequestPlanRequestSchema.safeParse({ requestId: "3F1A6F28-9C4E-4A1B-8F2D-77C0B5E1A9D4" }).success).toBe(false);
    for (const extra of ["uid", "kind", "basePlanId", "targetVersionId", "stateRevision", "profile", "planId", "provider", "prompt", "quota"]) {
      expect(nutritionRequestPlanRequestSchema.safeParse({ requestId: RID, [extra]: "x" }).success, extra).toBe(false);
    }
  });

  it("answers a request's state, with a plan exactly when succeeded and a code exactly when failed or discarded", () => {
    const base = { ok: true, requestId: RID, resultPlanId: null, errorCode: null, replay: false };
    const valid = (value: unknown) => nutritionRequestPlanResultSchema.safeParse(value).success;
    expect(valid({ ...base, status: "running" })).toBe(true);
    expect(valid({ ...base, status: "succeeded", resultPlanId: "plan-2" })).toBe(true);
    expect(valid({ ...base, status: "succeeded" })).toBe(false);
    expect(valid({ ...base, status: "failed", errorCode: "PLAN_VALIDATION_FAILED" })).toBe(true);
    expect(valid({ ...base, status: "failed" })).toBe(false);
    expect(valid({ ...base, status: "discarded_stale", errorCode: "STALE_TARGET" })).toBe(true);
    expect(valid({ ...base, status: "discarded_stale", errorCode: "ELIGIBILITY_CHANGED" })).toBe(true);
    expect(valid({ ...base, status: "failed", errorCode: "ELIGIBILITY_CHANGED" })).toBe(false);
    expect(valid({ ...base, status: "running", errorCode: "STALE_TARGET" })).toBe(false);
    expect(valid({ ...base, status: "running", prompt: "x" })).toBe(false);
  });
});
