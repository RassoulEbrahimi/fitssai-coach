import { HttpsError, type FunctionsErrorCode } from "firebase-functions/v2/https";
import type { NutritionSetTargetErrorCode, NutritionTargetProfileField } from "../../../shared/nutrition";

/**
 * Failures of the Nutrition callables that are safe to send to a client.
 *
 * Only a code and, for `PROFILE_INCOMPLETE`, the NAMES of the fields that are
 * not answered cross the boundary. Never a stored profile value, a Firestore
 * path, a Firebase error, a stack or a policy's own exception.
 */

export interface NutritionTargetErrorDetails {
  /** PROFILE_INCOMPLETE only: names of required fields with no stored value. */
  missingFields?: NutritionTargetProfileField[];
  /** PROFILE_INCOMPLETE only: names of required fields whose stored value is not an answer. */
  invalidFields?: NutritionTargetProfileField[];
  /** NOT_ELIGIBLE only: the NUT-03 reason code, never the age. */
  reason?: "minor" | "missingAge";
}

export class NutritionTargetError extends Error {
  constructor(
    readonly code: Exclude<NutritionSetTargetErrorCode, "UNAUTHENTICATED">,
    message: string,
    readonly details: NutritionTargetErrorDetails = {}
  ) {
    super(message);
    this.name = "NutritionTargetError";
  }
}

export const isNutritionTargetError = (value: unknown): value is NutritionTargetError =>
  value instanceof NutritionTargetError;

const HTTPS_CODES: Readonly<Record<NutritionTargetError["code"], FunctionsErrorCode>> = {
  INVALID_REQUEST: "invalid-argument",
  NOT_ELIGIBLE: "permission-denied",
  TARGET_POLICY_NOT_CONFIGURED: "failed-precondition",
  PROFILE_INCOMPLETE: "failed-precondition",
  INTERNAL: "internal",
};

/**
 * The one mapping from a thrown value to what the callable answers. An
 * `HttpsError` the handler threw itself (unauthenticated) passes through;
 * anything unrecognised becomes a bare `INTERNAL` with no details.
 */
export const toNutritionHttpsError = (error: unknown): HttpsError => {
  if (error instanceof HttpsError) return error;
  if (isNutritionTargetError(error)) {
    const details = Object.keys(error.details).length > 0 ? error.details : undefined;
    return new HttpsError(HTTPS_CODES[error.code], error.code, details);
  }
  return new HttpsError("internal", "INTERNAL");
};
