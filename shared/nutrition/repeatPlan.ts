import { z } from "zod";
import { nutritionDocIdSchema, nutritionRequestIdSchema } from "./contracts";

/**
 * The `nutritionRepeatPlan` callable contract, shared by the server and the
 * browser.
 *
 * The request is only the request id. Identity comes from the verified auth
 * token, and the plan to repeat, the target, the dates and every meal are
 * resolved by the server from the account's own state, so nothing a browser
 * sends can choose a uid, a plan, a target, a date or a meal.
 */

export const NUTRITION_REPEAT_PLAN_CALLABLE = "nutritionRepeatPlan" as const;

/** Strict: a uid, a plan id, a target, a date or meal content in the request is refused, not ignored. */
export const nutritionRepeatPlanRequestSchema = z
  .object({
    requestId: nutritionRequestIdSchema,
  })
  .strict();

export type NutritionRepeatPlanRequest = z.infer<typeof nutritionRepeatPlanRequestSchema>;

/**
 * What a successful call answers: the id of the plan the request created and
 * activated. `replay`: the request id had already been applied, and this is
 * the plan that first call created.
 */
export const nutritionRepeatPlanResultSchema = z
  .object({
    ok: z.literal(true),
    planId: nutritionDocIdSchema,
    replay: z.boolean(),
  })
  .strict();

export type NutritionRepeatPlanResult = z.infer<typeof nutritionRepeatPlanResultSchema>;

/**
 * Every failure a Nutrition plan callable can report. Stable codes, never
 * prose:
 *
 *   UNAUTHENTICATED                        no verified caller
 *   INVALID_REQUEST                        the request is not `{ requestId }`, or
 *                                          the id was used by another operation
 *   NOT_ELIGIBLE                           not an adult with a known age (NUT-03)
 *   NO_CURRENT_TARGET                      the account has no target
 *   NO_ACTIVE_PLAN                         the account has no active plan
 *   PLAN_NOT_ACTIVE                        the plan to repeat is not active
 *   TARGET_CHANGED                         the plan was made for an earlier target
 *   PLAN_NOT_REPEATABLE                    repeating it would start the new week
 *                                          before today (Berlin)
 *   PLAN_VALIDATION_POLICY_NOT_CONFIGURED  no plan-validation policy is signed off
 *   PLAN_VALIDATION_FAILED                 the policy did not accept the plan
 *   STALE_ACTIVE_PLAN                      another plan was activated meanwhile
 *   STALE_TARGET                           the target changed meanwhile
 *   INTERNAL                               anything else; nothing internal is exposed
 */
export const NUTRITION_PLAN_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_REQUEST",
  "NOT_ELIGIBLE",
  "NO_CURRENT_TARGET",
  "NO_ACTIVE_PLAN",
  "PLAN_NOT_ACTIVE",
  "TARGET_CHANGED",
  "PLAN_NOT_REPEATABLE",
  "PLAN_VALIDATION_POLICY_NOT_CONFIGURED",
  "PLAN_VALIDATION_FAILED",
  "STALE_ACTIVE_PLAN",
  "STALE_TARGET",
  "INTERNAL",
] as const;

export type NutritionPlanErrorCode = (typeof NUTRITION_PLAN_ERROR_CODES)[number];

export const isNutritionPlanErrorCode = (value: unknown): value is NutritionPlanErrorCode =>
  typeof value === "string" && (NUTRITION_PLAN_ERROR_CODES as readonly string[]).includes(value);
