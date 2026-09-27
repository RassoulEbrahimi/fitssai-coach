import { HttpsError, type FunctionsErrorCode } from "firebase-functions/v2/https";
import type {
  NutritionPlanErrorCode,
  NutritionRequestPlanErrorCode,
  NutritionSetTargetErrorCode,
  NutritionSlotErrorCode,
  NutritionTargetProfileField,
} from "../../../shared/nutrition";

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

export interface NutritionPlanErrorDetails {
  /** NOT_ELIGIBLE only: the NUT-03 reason code, never the age. */
  reason?: "minor" | "missingAge";
}

/**
 * A refusal or failure of a Nutrition plan operation (NUT-09 repeat, and the
 * shared activation core). `STALE_ACTIVE_PLAN` and `STALE_TARGET` are typed
 * outcomes a later caller (generation finalisation) can map to its own
 * "discard as stale" without reading a message.
 */
export class NutritionPlanError extends Error {
  constructor(
    readonly code: Exclude<NutritionPlanErrorCode, "UNAUTHENTICATED">,
    message: string,
    readonly details: NutritionPlanErrorDetails = {}
  ) {
    super(message);
    this.name = "NutritionPlanError";
  }
}

export const isNutritionPlanError = (value: unknown): value is NutritionPlanError => value instanceof NutritionPlanError;

export interface NutritionSlotErrorDetails {
  /** NOT_ELIGIBLE only: the NUT-03 reason code, never the age. */
  reason?: "minor" | "missingAge";
  /** STALE_REVISION only: the slot head's revision now (0: no head), for the client to refetch. */
  currentRevision?: number;
}

/**
 * A refusal or failure of `nutritionUpdateSlot` (NUT-10). Semantic conflicts —
 * a stale revision, a recorded slot, a plan that no longer owns the date, a
 * consumed candidate — each have their own code and never collapse into
 * INTERNAL.
 */
export class NutritionSlotError extends Error {
  constructor(
    readonly code: Exclude<NutritionSlotErrorCode, "UNAUTHENTICATED">,
    message: string,
    readonly details: NutritionSlotErrorDetails = {}
  ) {
    super(message);
    this.name = "NutritionSlotError";
  }
}

export const isNutritionSlotError = (value: unknown): value is NutritionSlotError => value instanceof NutritionSlotError;

export interface NutritionGenerationErrorDetails {
  /** NOT_ELIGIBLE only: the NUT-03 reason code, never the age. */
  reason?: "minor" | "missingAge";
}

/**
 * A refusal of `nutritionRequestPlan` (NUT-11), raised before anything is
 * written. A generation that ran and produced no plan is not one of these: it
 * is a terminal generation request, answered as such.
 */
export class NutritionGenerationError extends Error {
  constructor(
    readonly code: Exclude<NutritionRequestPlanErrorCode, "UNAUTHENTICATED">,
    message: string,
    readonly details: NutritionGenerationErrorDetails = {}
  ) {
    super(message);
    this.name = "NutritionGenerationError";
  }
}

export const isNutritionGenerationError = (value: unknown): value is NutritionGenerationError =>
  value instanceof NutritionGenerationError;

const HTTPS_CODES: Readonly<Record<NutritionTargetError["code"], FunctionsErrorCode>> = {
  INVALID_REQUEST: "invalid-argument",
  NOT_ELIGIBLE: "permission-denied",
  TARGET_POLICY_NOT_CONFIGURED: "failed-precondition",
  PROFILE_INCOMPLETE: "failed-precondition",
  INTERNAL: "internal",
};

const PLAN_HTTPS_CODES: Readonly<Record<NutritionPlanError["code"], FunctionsErrorCode>> = {
  INVALID_REQUEST: "invalid-argument",
  NOT_ELIGIBLE: "permission-denied",
  NO_CURRENT_TARGET: "failed-precondition",
  NO_ACTIVE_PLAN: "failed-precondition",
  PLAN_NOT_ACTIVE: "failed-precondition",
  TARGET_CHANGED: "failed-precondition",
  PLAN_NOT_REPEATABLE: "failed-precondition",
  PLAN_VALIDATION_POLICY_NOT_CONFIGURED: "failed-precondition",
  PLAN_VALIDATION_FAILED: "failed-precondition",
  // Another request changed the state first; the caller may read and retry.
  STALE_ACTIVE_PLAN: "aborted",
  STALE_TARGET: "aborted",
  INTERNAL: "internal",
};

const SLOT_HTTPS_CODES: Readonly<Record<NutritionSlotError["code"], FunctionsErrorCode>> = {
  INVALID_REQUEST: "invalid-argument",
  NOT_ELIGIBLE: "permission-denied",
  DATE_FROZEN: "failed-precondition",
  SLOT_NOT_CONFIGURED: "failed-precondition",
  SLOT_HAS_RECORD: "failed-precondition",
  NOTHING_TO_UNDO: "failed-precondition",
  INVALID_SOURCE_MEAL: "failed-precondition",
  SUGGESTION_NOT_FOUND: "not-found",
  CANDIDATE_NOT_FOUND: "not-found",
  SUGGESTION_EXPIRED: "failed-precondition",
  // Another request changed the slot, the plan or the candidate first; the
  // client refreshes and the person decides again.
  PLAN_CHANGED_FOR_DATE: "aborted",
  STALE_REVISION: "aborted",
  SUGGESTION_ALREADY_CONSUMED: "aborted",
  INTERNAL: "internal",
};

const GENERATION_HTTPS_CODES: Readonly<Record<NutritionGenerationError["code"], FunctionsErrorCode>> = {
  INVALID_REQUEST: "invalid-argument",
  NOT_ELIGIBLE: "permission-denied",
  GENERATION_PROVIDER_NOT_CONFIGURED: "failed-precondition",
  PLAN_VALIDATION_POLICY_NOT_CONFIGURED: "failed-precondition",
  NO_CURRENT_TARGET: "failed-precondition",
  PLAN_NOT_ACTIVE: "failed-precondition",
  PLAN_NOT_REGENERABLE: "failed-precondition",
  GENERATION_SLOTS_NOT_CONFIGURED: "failed-precondition",
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
  if (isNutritionPlanError(error)) {
    const details = Object.keys(error.details).length > 0 ? error.details : undefined;
    return new HttpsError(PLAN_HTTPS_CODES[error.code], error.code, details);
  }
  if (isNutritionSlotError(error)) {
    const details = Object.keys(error.details).length > 0 ? error.details : undefined;
    return new HttpsError(SLOT_HTTPS_CODES[error.code], error.code, details);
  }
  if (isNutritionGenerationError(error)) {
    const details = Object.keys(error.details).length > 0 ? error.details : undefined;
    return new HttpsError(GENERATION_HTTPS_CODES[error.code], error.code, details);
  }
  return new HttpsError("internal", "INTERNAL");
};
