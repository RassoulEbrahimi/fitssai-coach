import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_STATE_DOC_ID,
  buildRepeatedPlanContent,
  getNutritionEligibility,
  nutritionDateAt,
  nutritionRepeatPlanRequestSchema,
  parseNutritionProfile,
  type NutritionRepeatPlanResult,
} from "../../../shared/nutrition";
import { requireAuth, type AuthContextLike } from "../auth";
import { NutritionPlanError } from "./errors";
import {
  activateNutritionPlan,
  findAppliedRepeatPlan,
  parseNutritionStateSnapshot,
  requireStoredPlan,
  requireStoredTarget,
} from "./planActivation";
import type { PlanValidationPolicyRegistry } from "./planValidation/types";

/**
 * `nutritionRepeatPlan`: activate next week as a repeat of the active plan's
 * BASE content.
 *
 * The order is fixed, and everything that can refuse runs before anything is
 * written:
 *
 *   1. the verified caller (never a uid from the request)
 *   2. the request: exactly `{ requestId }`
 *   3. the caller's own profile
 *   4. NUT-03 adult eligibility
 *   5. the account state; an already-applied request id answers with the plan
 *      it created, whatever changed since
 *   6. a current target (NO_CURRENT_TARGET) and an active plan (NO_ACTIVE_PLAN)
 *   7. the active plan, strict: stored under its own id, and active
 *      (PLAN_NOT_ACTIVE)
 *   8. made for the current target (TARGET_CHANGED) — a week planned for an
 *      earlier target is never reused under a new one
 *   9. the current target version, strict
 *  10. a plan-validation policy in force (PLAN_VALIDATION_POLICY_NOT_CONFIGURED)
 *  11. the repeated week: the day after the source ends, never before today in
 *      Berlin (PLAN_NOT_REPEATABLE) — never shifted, skipped or stretched
 *  12. the one activation transaction (`./planActivation`), which checks the
 *      ledger, the pointers and the validation again and writes the new plan,
 *      the superseded source and the state together
 *
 * Only the base plan is read. Slot heads, overrides, recorded entries,
 * pending offline intents and generation state are neither read nor copied.
 *
 * No provider, no quota, no `_ai_operations` record and no logging: the state
 * ledger is the only idempotency record.
 */

export interface NutritionRepeatPlanDeps {
  firestore: Firestore;
  policies: PlanValidationPolicyRegistry;
  now?: () => Date;
  /** Mints the new plan id. Server-side only; never the request id. */
  newPlanId?: () => string;
}

export interface NutritionRepeatPlanCallRequest extends AuthContextLike {
  data?: unknown;
}

const internal = (message: string) => new NutritionPlanError("INTERNAL", message);

/** Firestore failures become INTERNAL; typed refusals pass through. */
const guard = async <T>(read: () => Promise<T>, message: string): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NutritionPlanError) throw error;
    throw internal(message);
  }
};

export const handleNutritionRepeatPlan = async (
  request: NutritionRepeatPlanCallRequest,
  deps: NutritionRepeatPlanDeps
): Promise<NutritionRepeatPlanResult> => {
  const now = deps.now ?? (() => new Date());

  // 1. Identity from the verified token only.
  const { uid } = requireAuth(request);

  // 2. Exactly `{ requestId }`. Anything else is refused, not ignored.
  const parsedRequest = nutritionRepeatPlanRequestSchema.safeParse(request.data);
  if (!parsedRequest.success) throw new NutritionPlanError("INVALID_REQUEST", "Expected { requestId }.");
  const { requestId } = parsedRequest.data;

  const userRef = deps.firestore.collection("users").doc(uid);
  const stateRef = userRef.collection(NUTRITION_V2_COLLECTIONS.state).doc(NUTRITION_V2_STATE_DOC_ID);
  const planRef = (planId: string) => userRef.collection(NUTRITION_V2_COLLECTIONS.plans).doc(planId);
  const targetRef = (targetVersionId: string) => userRef.collection(NUTRITION_V2_COLLECTIONS.targets).doc(targetVersionId);

  // 3–4. Adults only, by the NUT-03 rule. The age itself is never reported.
  const profileData = await guard(async () => (await userRef.get()).data(), "Failed to read the profile.");
  const eligibility = getNutritionEligibility(parseNutritionProfile(profileData));
  if (!eligibility.eligible) {
    throw new NutritionPlanError("NOT_ELIGIBLE", "Nutrition is for adults with a known age.", {
      reason: eligibility.reason,
    });
  }

  // 5. The state; an applied request answers with what it created.
  const state = await guard(async () => parseNutritionStateSnapshot(await stateRef.get()), "Failed to read the Nutrition state.");
  const applied = findAppliedRepeatPlan(state, requestId);
  if (applied) {
    await guard(
      async () => requireStoredPlan(await planRef(applied.resultPlanId).get(), applied.resultPlanId),
      "Failed to read the plan an applied request created."
    );
    return { ok: true, planId: applied.resultPlanId, replay: true };
  }

  // 6. Something to repeat, for a target.
  const currentTargetVersionId = state?.currentTargetVersionId ?? null;
  if (currentTargetVersionId === null) throw new NutritionPlanError("NO_CURRENT_TARGET", "No target is set.");
  const activePlanId = state?.activePlanId ?? null;
  if (activePlanId === null) throw new NutritionPlanError("NO_ACTIVE_PLAN", "No plan is active.");

  // 7. The source: exactly the active plan, strict.
  const source = await guard(
    async () => requireStoredPlan(await planRef(activePlanId).get(), activePlanId),
    "Failed to read the active plan."
  );
  if (source.lifecycle.status !== "active") throw new NutritionPlanError("PLAN_NOT_ACTIVE", "The plan is not active.");

  // 8. Made for the target that is current now.
  if (source.targetVersionId !== currentTargetVersionId) {
    throw new NutritionPlanError("TARGET_CHANGED", "The plan was made for an earlier target.");
  }

  // 9. The current target version, strict.
  await guard(
    async () => requireStoredTarget(await targetRef(currentTargetVersionId).get(), currentTargetVersionId),
    "Failed to read the current target."
  );

  // 10. A signed-off policy. None is configured in production.
  if (!deps.policies.current()) {
    throw new NutritionPlanError("PLAN_VALIDATION_POLICY_NOT_CONFIGURED", "No plan-validation policy is in force.");
  }

  // 11. The next week, exactly. A week that would start before today is refused.
  const content = buildRepeatedPlanContent(source);
  const at = now();
  if (content.startDate < nutritionDateAt(at)) {
    throw new NutritionPlanError("PLAN_NOT_REPEATABLE", "The repeated week would start in the past.");
  }

  // 12. One activation. The plan id is minted once, so a transaction retry
  //     writes the id the first attempt would have written.
  const result = await activateNutritionPlan(
    { firestore: deps.firestore, policies: deps.policies },
    {
      uid,
      planId: (deps.newPlanId ?? randomUUID)(),
      content,
      origin: { source: "repeated", repeatedFromPlanId: source.planId },
      targetVersionId: currentTargetVersionId,
      expectedActivePlanId: source.planId,
      reusableValidation: source.validation,
      request: { requestId, operation: "repeatPlan" },
      now: at,
    }
  );
  return { ok: true, planId: result.planId, replay: result.kind === "replay" };
};
