import { getApp } from "firebase/app";
import { getFunctions, httpsCallable, type FunctionsError } from "firebase/functions";
import { FUNCTIONS_REGION } from "@/lib/backend/region";
import {
  NUTRITION_REPEAT_PLAN_CALLABLE,
  isNutritionPlanErrorCode,
  nutritionRepeatPlanRequestSchema,
  nutritionRepeatPlanResultSchema,
  type NutritionPlanErrorCode,
  type NutritionRepeatPlanRequest,
  type NutritionRepeatPlanResult,
} from "@shared/nutrition";

/**
 * The browser's side of `nutritionRepeatPlan` (NUT-09).
 *
 * It sends `{ requestId }` and nothing else: the request is parsed with the
 * strict shared schema before it leaves, so a uid, a plan id, a target, a date
 * or meal content cannot be sent even by mistake. The server resolves the plan
 * to repeat, validates and activates it, and writes the plans and the state;
 * this module receives an id.
 */

/** A refusal or failure, as a stable code. */
export class NutritionPlanCallError extends Error {
  readonly code: NutritionPlanErrorCode;

  constructor(code: NutritionPlanErrorCode) {
    super(code);
    this.name = "NutritionPlanCallError";
    this.code = code;
  }
}

export const isNutritionPlanCallError = (error: unknown): error is NutritionPlanCallError =>
  error instanceof NutritionPlanCallError;

/**
 * Any thrown value as one of the stable codes. The server puts its code in
 * the message; anything unrecognised — a network failure, another function's
 * prose — is `INTERNAL` and is never shown as it is.
 */
export const toNutritionPlanCallError = (error: unknown): NutritionPlanCallError => {
  if (isNutritionPlanCallError(error)) return error;
  const callable = error as Partial<FunctionsError> | null | undefined;
  if (callable?.code === "functions/unauthenticated") return new NutritionPlanCallError("UNAUTHENTICATED");
  if (isNutritionPlanErrorCode(callable?.message)) return new NutritionPlanCallError(callable.message);
  return new NutritionPlanCallError("INTERNAL");
};

/** Ask the server to activate next week as a repeat of the active plan. */
export const callNutritionRepeatPlan = async (request: NutritionRepeatPlanRequest): Promise<NutritionRepeatPlanResult> => {
  // Strict: exactly `{ requestId }` leaves the browser.
  const payload = nutritionRepeatPlanRequestSchema.parse(request);
  const callable = httpsCallable<NutritionRepeatPlanRequest, unknown>(
    getFunctions(getApp(), FUNCTIONS_REGION),
    NUTRITION_REPEAT_PLAN_CALLABLE
  );

  let data: unknown;
  try {
    data = (await callable(payload)).data;
  } catch (error) {
    throw toNutritionPlanCallError(error);
  }
  const result = nutritionRepeatPlanResultSchema.safeParse(data);
  if (!result.success) throw new NutritionPlanCallError("INTERNAL");
  return result.data;
};
