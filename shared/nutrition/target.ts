import { z } from "zod";
import {
  nutritionDocIdSchema,
  nutritionRequestIdSchema,
  nutritionTargetModeSchema,
  type NutritionTargetMode,
  type TargetVersion,
} from "./contracts";
import type { NutritionDate } from "./dates";

/**
 * The `nutritionSetTarget` callable contract, shared by the server and the
 * browser, and the one rule for which target applies to a date.
 *
 * The request names only the mode and the request id. Identity comes from the
 * verified auth token and every profile input is read by the server from the
 * caller's own profile, so nothing a browser sends can choose a uid, an input
 * or a target value.
 */

export const NUTRITION_SET_TARGET_CALLABLE = "nutritionSetTarget" as const;

/** Strict: a uid, a profile or a target value in the request is refused, not ignored. */
export const nutritionSetTargetRequestSchema = z
  .object({
    mode: nutritionTargetModeSchema,
    requestId: nutritionRequestIdSchema,
  })
  .strict();

export type NutritionSetTargetRequest = z.infer<typeof nutritionSetTargetRequestSchema>;

/**
 * What a successful call answers. `replay`: the request id had already been
 * applied, and this is the target that first call created.
 */
export const nutritionSetTargetResultSchema = z
  .object({
    ok: z.literal(true),
    targetVersionId: nutritionDocIdSchema,
    replay: z.boolean(),
  })
  .strict();

export type NutritionSetTargetResult = z.infer<typeof nutritionSetTargetResultSchema>;

/**
 * Every failure the callable can report. Stable codes, never prose:
 *
 *   UNAUTHENTICATED               no verified caller
 *   INVALID_REQUEST               the request is not `{ mode, requestId }`
 *   NOT_ELIGIBLE                  not an adult with a known age (NUT-03)
 *   TARGET_POLICY_NOT_CONFIGURED  no signed-off policy exists for the mode
 *   PROFILE_INCOMPLETE            the policy's profile fields are not all
 *                                 answered; details name the fields only
 *   TARGET_INFEASIBLE             the answers are complete and valid, but the
 *                                 policy supports no target for them; no
 *                                 detail, value or bound is exposed
 *   INTERNAL                      anything else; nothing internal is exposed
 */
export const NUTRITION_SET_TARGET_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_REQUEST",
  "NOT_ELIGIBLE",
  "TARGET_POLICY_NOT_CONFIGURED",
  "PROFILE_INCOMPLETE",
  "TARGET_INFEASIBLE",
  "INTERNAL",
] as const;

export type NutritionSetTargetErrorCode = (typeof NUTRITION_SET_TARGET_ERROR_CODES)[number];

export const isNutritionSetTargetErrorCode = (value: unknown): value is NutritionSetTargetErrorCode =>
  typeof value === "string" && (NUTRITION_SET_TARGET_ERROR_CODES as readonly string[]).includes(value);

/** The modes a target can be set in, for callers that list them. */
export const NUTRITION_SET_TARGET_MODES: readonly NutritionTargetMode[] = nutritionTargetModeSchema.options;

/* ------------------------------------------------------------------ *
 * Target history
 * ------------------------------------------------------------------ */

/**
 * The target version in effect on `date`: the latest one with
 * `effectiveFrom <= date`, and of several on the same date the one with the
 * highest `effectiveOrder`. `null` when none had started yet. Pure; the
 * versions are not changed or reordered.
 */
export const selectEffectiveTargetVersion = <T extends Pick<TargetVersion, "effectiveFrom" | "effectiveOrder">>(
  versions: readonly T[],
  date: NutritionDate
): T | null => {
  let best: T | null = null;
  for (const version of versions) {
    if (version.effectiveFrom > date) continue;
    if (
      best === null ||
      version.effectiveFrom > best.effectiveFrom ||
      (version.effectiveFrom === best.effectiveFrom && version.effectiveOrder > best.effectiveOrder)
    ) {
      best = version;
    }
  }
  return best;
};
