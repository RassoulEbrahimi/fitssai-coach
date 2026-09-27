import { getApp } from "firebase/app";
import { getFunctions, httpsCallable, type FunctionsError } from "firebase/functions";
import { FUNCTIONS_REGION } from "@/lib/backend/region";
import {
  NUTRITION_SET_TARGET_CALLABLE,
  isNutritionSetTargetErrorCode,
  isNutritionTargetProfileField,
  nutritionSetTargetRequestSchema,
  nutritionSetTargetResultSchema,
  type NutritionSetTargetErrorCode,
  type NutritionSetTargetRequest,
  type NutritionSetTargetResult,
  type NutritionTargetProfileField,
} from "@shared/nutrition";

/**
 * The browser's side of `nutritionSetTarget` — the one Nutrition V2 callable.
 *
 * It sends `{ mode, requestId }` and nothing else: the request is parsed with
 * the strict shared schema before it leaves, so a profile value, a uid or a
 * target value cannot be sent even by mistake. The server reads the profile
 * itself and writes the target and the state; this module receives an id.
 */

/** A refusal or failure, as a stable code. Field names only, never values. */
export class NutritionTargetCallError extends Error {
  readonly code: NutritionSetTargetErrorCode;
  readonly missingFields: NutritionTargetProfileField[];
  readonly invalidFields: NutritionTargetProfileField[];

  constructor(
    code: NutritionSetTargetErrorCode,
    fields: { missingFields?: NutritionTargetProfileField[]; invalidFields?: NutritionTargetProfileField[] } = {}
  ) {
    super(code);
    this.name = "NutritionTargetCallError";
    this.code = code;
    this.missingFields = fields.missingFields ?? [];
    this.invalidFields = fields.invalidFields ?? [];
  }
}

export const isNutritionTargetCallError = (error: unknown): error is NutritionTargetCallError =>
  error instanceof NutritionTargetCallError;

const readFieldNames = (details: unknown, key: "missingFields" | "invalidFields"): NutritionTargetProfileField[] => {
  const fields = (details as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(fields) ? fields.filter(isNutritionTargetProfileField) : [];
};

/**
 * Any thrown value as one of the stable codes. The server puts its code in
 * the message; anything unrecognised — a network failure, another function's
 * prose — is `INTERNAL` and is never shown as it is.
 */
export const toNutritionTargetCallError = (error: unknown): NutritionTargetCallError => {
  if (isNutritionTargetCallError(error)) return error;
  const callable = error as (Partial<FunctionsError> & { details?: unknown }) | null | undefined;
  if (callable?.code === "functions/unauthenticated") return new NutritionTargetCallError("UNAUTHENTICATED");
  if (isNutritionSetTargetErrorCode(callable?.message)) {
    return new NutritionTargetCallError(callable.message, {
      missingFields: readFieldNames(callable.details, "missingFields"),
      invalidFields: readFieldNames(callable.details, "invalidFields"),
    });
  }
  return new NutritionTargetCallError("INTERNAL");
};

/** Ask the server to create the caller's next target version. */
export const callNutritionSetTarget = async (request: NutritionSetTargetRequest): Promise<NutritionSetTargetResult> => {
  // Strict: exactly `{ mode, requestId }` leaves the browser.
  const payload = nutritionSetTargetRequestSchema.parse(request);
  const callable = httpsCallable<NutritionSetTargetRequest, unknown>(
    getFunctions(getApp(), FUNCTIONS_REGION),
    NUTRITION_SET_TARGET_CALLABLE
  );

  let data: unknown;
  try {
    data = (await callable(payload)).data;
  } catch (error) {
    throw toNutritionTargetCallError(error);
  }
  const result = nutritionSetTargetResultSchema.safeParse(data);
  if (!result.success) throw new NutritionTargetCallError("INTERNAL");
  return result.data;
};
