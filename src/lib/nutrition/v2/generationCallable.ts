import { getApp } from "firebase/app";
import { getFunctions, httpsCallable, type FunctionsError } from "firebase/functions";
import { FUNCTIONS_REGION } from "@/lib/backend/region";
import {
  NUTRITION_REQUEST_PLAN_CALLABLE,
  NUTRITION_REQUEST_PLAN_CLIENT_TIMEOUT_MS,
  isNutritionRequestPlanErrorCode,
  nutritionRequestPlanRequestSchema,
  nutritionRequestPlanResultSchema,
  type NutritionRequestPlanErrorCode,
  type NutritionRequestPlanRequest,
  type NutritionRequestPlanResult,
} from "@shared/nutrition";

/**
 * The browser's side of `nutritionRequestPlan` (NUT-11).
 *
 * It sends `{ requestId }` and nothing else: the request is parsed with the
 * strict shared schema before it leaves, so a uid, a kind, a plan, a target, a
 * profile value, a provider or a prompt cannot be sent even by mistake. The
 * server decides everything about the generation and writes every document;
 * this module receives the request's state.
 *
 * Nothing here cancels: a call that is abandoned by the browser still runs to
 * its end on the server, and the request document says how it ended.
 */

/** A refusal before anything was written, as a stable code. */
export class NutritionRequestPlanCallError extends Error {
  readonly code: NutritionRequestPlanErrorCode;

  constructor(code: NutritionRequestPlanErrorCode) {
    super(code);
    this.name = "NutritionRequestPlanCallError";
    this.code = code;
  }
}

export const isNutritionRequestPlanCallError = (error: unknown): error is NutritionRequestPlanCallError =>
  error instanceof NutritionRequestPlanCallError;

/**
 * Any thrown value as one of the stable codes. The server puts its code in
 * the message; anything unrecognised — a network failure, another function's
 * prose — is `INTERNAL` and is never shown as it is.
 */
export const toNutritionRequestPlanCallError = (error: unknown): NutritionRequestPlanCallError => {
  if (isNutritionRequestPlanCallError(error)) return error;
  const callable = error as Partial<FunctionsError> | null | undefined;
  if (callable?.code === "functions/unauthenticated") return new NutritionRequestPlanCallError("UNAUTHENTICATED");
  if (isNutritionRequestPlanErrorCode(callable?.message)) return new NutritionRequestPlanCallError(callable.message);
  return new NutritionRequestPlanCallError("INTERNAL");
};

/** Ask the server to generate a plan. The answer is the request's state. */
export const callNutritionRequestPlan = async (request: NutritionRequestPlanRequest): Promise<NutritionRequestPlanResult> => {
  // Strict: exactly `{ requestId }` leaves the browser.
  const payload = nutritionRequestPlanRequestSchema.parse(request);
  // This callable's own timeout: a generation outlasts the SDK's default, and
  // the browser must not give up while the server's claim is still live.
  const callable = httpsCallable<NutritionRequestPlanRequest, unknown>(
    getFunctions(getApp(), FUNCTIONS_REGION),
    NUTRITION_REQUEST_PLAN_CALLABLE,
    { timeout: NUTRITION_REQUEST_PLAN_CLIENT_TIMEOUT_MS }
  );

  let data: unknown;
  try {
    data = (await callable(payload)).data;
  } catch (error) {
    throw toNutritionRequestPlanCallError(error);
  }
  const result = nutritionRequestPlanResultSchema.safeParse(data);
  if (!result.success) throw new NutritionRequestPlanCallError("INTERNAL");
  return result.data;
};
