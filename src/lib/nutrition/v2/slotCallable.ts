import { getApp } from "firebase/app";
import { getFunctions, httpsCallable, type FunctionsError } from "firebase/functions";
import { FUNCTIONS_REGION } from "@/lib/backend/region";
import {
  NUTRITION_UPDATE_SLOT_CALLABLE,
  isNutritionSlotErrorCode,
  nutritionUpdateSlotRequestSchema,
  nutritionUpdateSlotResultSchema,
  type NutritionSlotErrorCode,
  type NutritionUpdateSlotRequest,
  type NutritionUpdateSlotResult,
} from "@shared/nutrition";

/**
 * The browser's side of `nutritionUpdateSlot` (NUT-10).
 *
 * The request is parsed with the strict shared schema before it leaves, so
 * only ids and the expected revision can be sent: never a uid, a meal name,
 * values, a meal object, an override id or a meal id. The server resolves the
 * replacement from its own data and writes the slot head; this module
 * receives the head's new revision and selection.
 */

/** A refusal or failure, as a stable code. `currentRevision`: STALE_REVISION only. */
export class NutritionSlotCallError extends Error {
  readonly code: NutritionSlotErrorCode;
  readonly currentRevision: number | null;

  constructor(code: NutritionSlotErrorCode, currentRevision: number | null = null) {
    super(code);
    this.name = "NutritionSlotCallError";
    this.code = code;
    this.currentRevision = currentRevision;
  }
}

export const isNutritionSlotCallError = (error: unknown): error is NutritionSlotCallError =>
  error instanceof NutritionSlotCallError;

const revisionIn = (details: unknown): number | null => {
  const value = (details as { currentRevision?: unknown } | null | undefined)?.currentRevision;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
};

/**
 * Any thrown value as one of the stable codes. The server puts its code in the
 * message; anything unrecognised — a network failure, another function's prose
 * — is `INTERNAL` and is never shown as it is.
 */
export const toNutritionSlotCallError = (error: unknown): NutritionSlotCallError => {
  if (isNutritionSlotCallError(error)) return error;
  const callable = error as Partial<FunctionsError> | null | undefined;
  if (callable?.code === "functions/unauthenticated") return new NutritionSlotCallError("UNAUTHENTICATED");
  if (isNutritionSlotErrorCode(callable?.message)) {
    return new NutritionSlotCallError(
      callable.message,
      callable.message === "STALE_REVISION" ? revisionIn(callable.details) : null
    );
  }
  return new NutritionSlotCallError("INTERNAL");
};

/** Ask the server to commit or undo one slot replacement. */
export const callNutritionUpdateSlot = async (request: NutritionUpdateSlotRequest): Promise<NutritionUpdateSlotResult> => {
  // Strict: exactly one of the id-only shapes leaves the browser.
  const payload = nutritionUpdateSlotRequestSchema.parse(request);
  const callable = httpsCallable<NutritionUpdateSlotRequest, unknown>(
    getFunctions(getApp(), FUNCTIONS_REGION),
    NUTRITION_UPDATE_SLOT_CALLABLE
  );

  let data: unknown;
  try {
    data = (await callable(payload)).data;
  } catch (error) {
    throw toNutritionSlotCallError(error);
  }
  const result = nutritionUpdateSlotResultSchema.safeParse(data);
  if (!result.success) throw new NutritionSlotCallError("INTERNAL");
  return result.data;
};
