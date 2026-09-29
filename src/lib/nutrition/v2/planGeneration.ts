import {
  NUTRITION_REQUEST_PLAN_ERROR_CODES,
  answeredValue,
  isTerminalGenerationRequestStatus,
  type GenerationRequest,
  type NutritionDate,
  type NutritionPlan,
  type NutritionProfile,
  type NutritionRequestPlanErrorCode,
  type NutritionRequestPlanResult,
  type TargetVersion,
} from "@shared/nutrition";
import type { NutritionV2Access, NutritionV2Read } from "./readStatus";
import { getNutritionProfileCompleteness } from "./profileCompletion";

/**
 * Whether the Today view offers an explicit "create a plan" action (NUT-14),
 * derived only from what the app already read. Pure: no React, no Firestore,
 * no callable.
 *
 * The action is offered only when every precondition the product can see
 * holds, so a person is never sent to the server just to learn one of them:
 *
 *   the deployed backend offers generation   (live `coachBackendStatus`)
 *   a signed-in, eligible adult              (NUT-03)
 *   a complete Nutrition profile
 *   a dietary preference generation supports (keto is not, NUT-12C.2)
 *   a current target that matches the profile (a stale or uncomparable target
 *                                            is checked first — the server's
 *                                            target policy is not changed)
 *   no live generation request               (the status says it is running)
 *   a regenerable active plan, if there is one (it owns a date before tomorrow)
 *   online
 *
 * Every read still loading or failed hides the action: it fails closed. The
 * server stays the authority — it decides initial or regeneration, the base
 * plan, the dates and the input, and refuses anything this missed. `kind` is
 * only which label the action shows.
 */

export type NutritionV2GenerationKind = "initial" | "regenerate";

export type NutritionV2GenerationAction =
  /** Nothing is shown: unavailable, or another section says what to do. */
  | { status: "hidden" }
  /** The target no longer matches the profile: check it first. */
  | { status: "targetNeedsReview" }
  /** The profile's dietary preference (keto) is not one generation supports. */
  | { status: "dietNotSupported" }
  /** Everything holds but the connection. */
  | { status: "offline"; kind: NutritionV2GenerationKind }
  | { status: "available"; kind: NutritionV2GenerationKind };

/** The target freshness states the product can see; only `fresh` lets generation through. */
export type NutritionV2GenerationFreshness = { status: string };

export interface NutritionV2GenerationInputs {
  /** The deployed backend's `nutritionGeneration`, fail-closed. */
  capability: boolean;
  access: NutritionV2Access;
  /** The NUT-03 view of the cached profile; `null` while it is unknown. */
  profile: NutritionProfile | null;
  target: NutritionV2Read<TargetVersion | null>;
  freshness: NutritionV2GenerationFreshness;
  /** The plan the state pointer names: the one a regeneration would follow. */
  activePlan: NutritionV2Read<NutritionPlan | null>;
  activeRequest: NutritionV2Read<GenerationRequest | null>;
  online: boolean;
  /** Berlin today, as the server counts it. */
  today: NutritionDate;
}

const HIDDEN: NutritionV2GenerationAction = { status: "hidden" };

export const deriveNutritionV2GenerationAction = (input: NutritionV2GenerationInputs): NutritionV2GenerationAction => {
  const { capability, access, profile, target, freshness, activePlan, activeRequest, online, today } = input;
  if (!capability || access.status !== "eligible" || profile === null) return HIDDEN;
  // The profile section asks for the missing answers.
  if (getNutritionProfileCompleteness(profile).status !== "complete") return HIDDEN;
  // No target: the target section's setup is the next action.
  if (target.status !== "success" || target.data === null) return HIDDEN;
  if (freshness.status === "stale" || freshness.status === "cannotCompare") return { status: "targetNeedsReview" };
  if (freshness.status !== "fresh") return HIDDEN;
  if (answeredValue(profile.dietaryPreference) === "keto") return { status: "dietNotSupported" };
  // A live request is shown by the generation status; a second is never offered.
  if (activeRequest.status !== "success") return HIDDEN;
  if (activeRequest.data !== null && !isTerminalGenerationRequestStatus(activeRequest.data.status)) return HIDDEN;
  if (activePlan.status !== "success") return HIDDEN;

  const plan = activePlan.data;
  let kind: NutritionV2GenerationKind = "initial";
  if (plan !== null) {
    // A successor starts tomorrow, so the plan it follows must be active and
    // own a date before then — the server refuses anything else.
    if (plan.lifecycle.status !== "active" || plan.startDate > today) return HIDDEN;
    kind = "regenerate";
  }
  return online ? { status: "available", kind } : { status: "offline", kind };
};

/* ------------------------------------------------------------------ *
 * What the person is told
 * ------------------------------------------------------------------ */

/**
 * The copy key (under `nutritionV2.generation`) for an answer or a refusal.
 * Only stable codes ever reach the copy: a provider's text, a Firebase error
 * or a stack trace is never shown.
 */
export type NutritionV2GenerationMessage =
  | { tone: "success"; key: "result.succeeded" | "result.succeededRegenerate" }
  | { tone: "info"; key: "result.inProgress" }
  | { tone: "error"; key: "result.failed" | "result.discarded" | `refusal.${NutritionRequestPlanErrorCode}` | "refusal.offline" };

/** An answer of `nutritionRequestPlan`, for the kind of plan the action asked for. */
export const nutritionV2GenerationResultMessage = (
  result: NutritionRequestPlanResult,
  kind: NutritionV2GenerationKind
): NutritionV2GenerationMessage => {
  switch (result.status) {
    case "succeeded":
      return { tone: "success", key: kind === "regenerate" ? "result.succeededRegenerate" : "result.succeeded" };
    case "failed":
      return { tone: "error", key: "result.failed" };
    case "discarded_stale":
      return { tone: "error", key: "result.discarded" };
    default:
      // Queued or running — this request, or one already live for the account.
      return { tone: "info", key: "result.inProgress" };
  }
};

/** A refusal before anything was written; an unknown code is `INTERNAL`. */
export const nutritionV2GenerationRefusalMessage = (code: string): NutritionV2GenerationMessage => {
  if (code === "offline") return { tone: "error", key: "refusal.offline" };
  const known = (NUTRITION_REQUEST_PLAN_ERROR_CODES as readonly string[]).includes(code)
    ? (code as NutritionRequestPlanErrorCode)
    : "INTERNAL";
  return { tone: "error", key: `refusal.${known}` };
};
