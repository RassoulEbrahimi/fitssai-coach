import { z } from "zod";
import {
  NUTRITION_GENERATION_FAILURE_CODES,
  NUTRITION_GENERATION_STALE_CODES,
  generationRequestSchema,
  generationRequestStatusSchema,
  isTerminalGenerationRequestStatus,
  nutritionDocIdSchema,
  nutritionRequestIdSchema,
  type GenerationRequest,
  type GenerationRequestStatus,
} from "./contracts";

/**
 * The `nutritionRequestPlan` callable contract and the one rule a stored
 * generation request may change by, shared by the server and the browser
 * (NUT-11).
 *
 * The request is only the request id. Identity comes from the verified auth
 * token; whether it is a first plan or a regeneration, the base plan, the
 * target, the dates, the slots and every generation input are resolved by the
 * server from the account's own data, so nothing a browser sends can choose
 * any of them — nor a provider, a model, a prompt or a quota.
 */

export const NUTRITION_REQUEST_PLAN_CALLABLE = "nutritionRequestPlan" as const;

/** Strict: exactly `{ requestId }`. A uid, kind, plan, target, profile value or provider is refused, not ignored. */
export const nutritionRequestPlanRequestSchema = z
  .object({
    requestId: nutritionRequestIdSchema,
  })
  .strict();

export type NutritionRequestPlanRequest = z.infer<typeof nutritionRequestPlanRequestSchema>;

/**
 * What a call answers: the state of one generation request. It is the same
 * information the request document holds, so a browser whose response was
 * lost converges by reading that document instead.
 *
 *   requestId     the request this answer describes. Normally the one sent;
 *                 while ANOTHER request of the account is live it is that
 *                 request's id, the status is `queued` or `running`, and
 *                 nothing was created for the id that was sent
 *   status        its lifecycle status
 *   resultPlanId  the activated plan, when succeeded
 *   errorCode     the stable failure or stale code, when failed or discarded
 *   replay        the request had already finished before this call
 */
export const nutritionRequestPlanResultSchema = z
  .object({
    ok: z.literal(true),
    requestId: nutritionRequestIdSchema,
    status: generationRequestStatusSchema,
    resultPlanId: nutritionDocIdSchema.nullable(),
    errorCode: z.union([z.enum(NUTRITION_GENERATION_FAILURE_CODES), z.enum(NUTRITION_GENERATION_STALE_CODES)]).nullable(),
    replay: z.boolean(),
  })
  .strict()
  .superRefine((result, ctx) => {
    const succeeded = result.status === "succeeded";
    if (succeeded !== (result.resultPlanId !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resultPlanId"], message: "a result plan exactly when succeeded" });
    }
    const errored = result.status === "failed" || result.status === "discarded_stale";
    if (errored !== (result.errorCode !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "an error code exactly when failed or discarded" });
    }
  });

export type NutritionRequestPlanResult = z.infer<typeof nutritionRequestPlanResultSchema>;

/**
 * Every refusal `nutritionRequestPlan` can answer with, before anything is
 * written. Stable codes, never prose. A generation that ran and did not
 * produce a plan is not a refusal: it answers `ok` with its terminal status.
 *
 *   UNAUTHENTICATED                        no verified caller
 *   INVALID_REQUEST                        not `{ requestId }`, or the id was
 *                                          used by another operation
 *   NOT_ELIGIBLE                           not an adult with a known age (NUT-03)
 *   GENERATION_PROVIDER_NOT_CONFIGURED     no generation provider is configured
 *                                          — the production answer
 *   PLAN_VALIDATION_POLICY_NOT_CONFIGURED  no plan-validation policy is signed off
 *   NO_CURRENT_TARGET                      the account has no target
 *   PLAN_NOT_ACTIVE                        the active plan pointer names a plan
 *                                          that is not active
 *   PLAN_NOT_REGENERABLE                   the active plan starts tomorrow or
 *                                          later, so a successor from tomorrow
 *                                          would leave it no date
 *   GENERATION_SLOTS_NOT_CONFIGURED        a first plan needs a slot
 *                                          configuration, and none is signed off
 *   INTERNAL                               anything else; nothing internal is exposed
 */
export const NUTRITION_REQUEST_PLAN_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_REQUEST",
  "NOT_ELIGIBLE",
  "GENERATION_PROVIDER_NOT_CONFIGURED",
  "PLAN_VALIDATION_POLICY_NOT_CONFIGURED",
  "NO_CURRENT_TARGET",
  "PLAN_NOT_ACTIVE",
  "PLAN_NOT_REGENERABLE",
  "GENERATION_SLOTS_NOT_CONFIGURED",
  "INTERNAL",
] as const;

export type NutritionRequestPlanErrorCode = (typeof NUTRITION_REQUEST_PLAN_ERROR_CODES)[number];

export const isNutritionRequestPlanErrorCode = (value: unknown): value is NutritionRequestPlanErrorCode =>
  typeof value === "string" && (NUTRITION_REQUEST_PLAN_ERROR_CODES as readonly string[]).includes(value);

/* ------------------------------------------------------------------ *
 * Transition
 * ------------------------------------------------------------------ */

/** The fields fixed when a request is created. */
export const GENERATION_REQUEST_IMMUTABLE_FIELDS = [
  "schemaVersion",
  "requestId",
  "idempotencyKey",
  "kind",
  "basePlanId",
  "targetVersionId",
  "payloadFingerprint",
  "createdAt",
] as const;

export class GenerationRequestTransitionError extends Error {
  constructor(detail: string) {
    super(`Invalid GenerationRequest transition: ${detail}`);
    this.name = "GenerationRequestTransitionError";
  }
}

const STATUS_RANK: Readonly<Record<GenerationRequestStatus, number>> = {
  queued: 0,
  running: 1,
  succeeded: 2,
  failed: 2,
  discarded_stale: 2,
};

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const parseForTransition = (value: unknown, side: string): GenerationRequest => {
  const parsed = generationRequestSchema.safeParse(value);
  if (!parsed.success) throw new GenerationRequestTransitionError(`the ${side} request is not a valid GenerationRequest`);
  return parsed.data;
};

/**
 * The changes a stored request may undergo, forward only:
 *
 *   queued → running → succeeded | failed | discarded_stale  (or straight to one)
 *   terminal → the same, with `acknowledgedAt` set once
 *
 * Never backwards, never from one terminal status to another, never a second
 * outcome, and never a change of an immutable field. Anything else throws a
 * `GenerationRequestTransitionError`; neither input is changed.
 */
export const assertGenerationRequestTransition = (before: unknown, after: unknown): void => {
  const from = parseForTransition(before, "previous");
  const to = parseForTransition(after, "next");

  for (const field of GENERATION_REQUEST_IMMUTABLE_FIELDS) {
    if (!sameJson(from[field], to[field])) throw new GenerationRequestTransitionError(`${field} is immutable`);
  }
  if (STATUS_RANK[to.status] < STATUS_RANK[from.status]) {
    throw new GenerationRequestTransitionError(`${from.status} cannot go back to ${to.status}`);
  }
  if (!isTerminalGenerationRequestStatus(from.status)) return;

  if (to.status !== from.status) throw new GenerationRequestTransitionError(`${from.status} is final`);
  if (to.resultPlanId !== from.resultPlanId || to.errorCode !== from.errorCode || !sameJson(to.finishedAt, from.finishedAt)) {
    throw new GenerationRequestTransitionError("a terminal outcome is final");
  }
  if (from.acknowledgedAt !== null && !sameJson(to.acknowledgedAt, from.acknowledgedAt)) {
    throw new GenerationRequestTransitionError("acknowledgedAt is set once");
  }
};
