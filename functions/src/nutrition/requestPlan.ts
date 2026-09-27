import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  nutritionRequestPlanRequestSchema,
  nutritionRequestPlanResultSchema,
  type GenerationRequest,
  type NutritionRequestPlanResult,
} from "../../../shared/nutrition";
import { requireAuth, type AuthContextLike } from "../auth";
import { NUTRITION_PLAN_OPERATIONS, createOperationRecordStore } from "../operationRecords";
import { NutritionGenerationError, isNutritionGenerationError, isNutritionPlanError } from "./errors";
import { generateNutritionPlanCandidate } from "./generationCandidate";
import type { NutritionInitialSlotConfiguration } from "./generationInput";
import {
  claimNutritionGeneration,
  failNutritionGeneration,
  failureCodeForActivationError,
  finalizeNutritionGeneration,
  type NutritionGenerationContext,
  type NutritionGenerationFinish,
} from "./generationLifecycle";
import type { NutritionGenerationProviderRegistry } from "./generationProvider";
import { prepareNutritionPlanActivation } from "./planActivation";
import type { PlanValidationPolicyRegistry } from "./planValidation/types";
import { nodeSha256Hex } from "./sha256";

/**
 * `nutritionRequestPlan`: generate and activate a Nutrition V2 plan for the
 * signed-in account (NUT-11).
 *
 *   1. the verified caller (never a uid from the request)
 *   2. the request: exactly `{ requestId }`
 *
 * Then the lifecycle (`./generationLifecycle`):
 *
 *   3. ONE claim transaction, which reads the caller's profile, the request,
 *      its record and the state together. An existing request is answered
 *      from what is stored — a finished one as it ended, a live one (this or
 *      another of the account) as running — whatever is configured now.
 *   4. Only new work goes further, and is refused before anything is written
 *      unless: the backend AI gate is on (NUTRITION_AI_DISABLED — in
 *      production it is off, so a new deployed request ends here: no request,
 *      no state pointer, no plan, no operation record, no quota, and the
 *      generator registry is not even asked); the profile read in THAT
 *      transaction is an eligible adult (NOT_ELIGIBLE); a generator is
 *      configured (GENERATION_PROVIDER_NOT_CONFIGURED); a plan-validation
 *      policy is in force (PLAN_VALIDATION_POLICY_NOT_CONFIGURED); and the
 *      account's own preconditions hold.
 *   5. The claim writes the request document (running), its `nutritionPlan`
 *      operation record with a reserved plan id, and the state's
 *      `activeGenerationRequestId`. Kind, base plan, target, dates and slots
 *      are the server's: `initial` from today without an active plan,
 *      `regenerate` from tomorrow with one.
 *   7. the generator, with the minimized input only, then structure, the
 *      requested dates and slots, and the policy — at most one repair
 *   8. ONE finalisation transaction — the plan activated through the NUT-09
 *      core and the request succeeded; or discarded_stale when another plan
 *      or target became current meanwhile — or ONE failure transaction
 *
 * The request document is the convergence source: a lost response, a closed
 * browser or a retry does not change what happens to it, and nothing cancels
 * it. No prompt, input or answer is persisted or logged, and no quota is taken.
 */

export interface NutritionRequestPlanDeps {
  firestore: Firestore;
  /**
   * The backend AI gate (NUT-12B). Required and explicit: production passes
   * `NUTRITION_AI_PRODUCTION_ENABLED` (false); a test that exercises the
   * lifecycle passes `true` itself. Nothing derives it from the environment.
   */
  generationEnabled: boolean;
  /** The generator registry. Asked only for new work with the gate on. Production: the lazy Vertex registry, unconfigured. */
  providers: NutritionGenerationProviderRegistry;
  /** The plan-validation policy in force. Production: none. */
  policies: PlanValidationPolicyRegistry;
  /** The slots of a first plan. Production: no mapping. */
  initialSlots: NutritionInitialSlotConfiguration;
  now?: () => Date;
  /** Mints a plan id for a request's first claim. Server-side only; never the request id. */
  newPlanId?: () => string;
  /** Mints a claim token. */
  newClaimToken?: () => string;
}

export interface NutritionRequestPlanCallRequest extends AuthContextLike {
  data?: unknown;
}

/** Typed refusals pass through; anything else is INTERNAL, with nothing of it exposed. */
const asGenerationError = (error: unknown): Error => {
  if (isNutritionGenerationError(error)) return error;
  if (isNutritionPlanError(error) && error.code === "PLAN_NOT_ACTIVE") {
    return new NutritionGenerationError("PLAN_NOT_ACTIVE", "The active plan is not active.");
  }
  return new NutritionGenerationError("INTERNAL", "Plan generation failed.");
};

const guard = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw asGenerationError(error);
  }
};

/** The answer for a request, as its document says. */
const answer = (request: GenerationRequest, replay: boolean): NutritionRequestPlanResult => {
  const parsed = nutritionRequestPlanResultSchema.safeParse({
    ok: true,
    requestId: request.requestId,
    status: request.status,
    resultPlanId: request.resultPlanId,
    errorCode: request.errorCode,
    replay,
  });
  if (!parsed.success) throw new NutritionGenerationError("INTERNAL", "The request cannot be answered.");
  return parsed.data;
};

export const handleNutritionRequestPlan = async (
  call: NutritionRequestPlanCallRequest,
  deps: NutritionRequestPlanDeps
): Promise<NutritionRequestPlanResult> => {
  const now = deps.now ?? (() => new Date());

  // 1. Identity from the verified token only.
  const { uid } = requireAuth(call);

  // 2. Exactly `{ requestId }`. Anything else is refused, not ignored.
  const parsedRequest = nutritionRequestPlanRequestSchema.safeParse(call.data);
  if (!parsedRequest.success) throw new NutritionGenerationError("INVALID_REQUEST", "Expected { requestId }.");
  const { requestId } = parsedRequest.data;

  const ctx: NutritionGenerationContext = {
    firestore: deps.firestore,
    uid,
    records: createOperationRecordStore({ firestore: deps.firestore, namespace: NUTRITION_PLAN_OPERATIONS }),
    policies: deps.policies,
    initialSlots: deps.initialSlots,
    sha256Hex: nodeSha256Hex,
  };

  // 3–6. One claim transaction: the profile, the request, its record and the
  //      state, read together. Eligibility and the configuration are judged
  //      there, and only for new work. Ids are minted before the transaction,
  //      so a retried transaction writes what its first attempt would have.
  const claim = await guard(() =>
    claimNutritionGeneration(ctx, {
      requestId,
      at: now(),
      newPlanId: (deps.newPlanId ?? randomUUID)(),
      claimToken: (deps.newClaimToken ?? randomUUID)(),
      generationEnabled: deps.generationEnabled,
      providers: deps.providers,
    })
  );
  if (claim.kind === "inProgress") return answer(claim.request, false);
  if (claim.kind === "finished") return answer(claim.request, claim.replay);

  // 7. The generator: the minimized input only. Nothing it says is kept.
  const outcome = await generateNutritionPlanCandidate({
    provider: claim.setup.provider,
    input: claim.input,
    policy: claim.policy,
    target: claim.target,
  });

  // 8. One finalisation, or one failure.
  let finish: NutritionGenerationFinish;
  if (outcome.ok) {
    const at = now();
    try {
      finish = await finalizeNutritionGeneration(ctx, {
        requestId,
        claimToken: claim.claimToken,
        at,
        activation: prepareNutritionPlanActivation({
          uid,
          planId: claim.planId,
          content: outcome.content,
          origin: { source: "generated", generationRequestId: requestId },
          targetVersionId: claim.request.targetVersionId,
          expectedActivePlanId: claim.request.basePlanId,
          reusableValidation: outcome.validation,
          request: null,
          now: at,
          completesGenerationRequestId: requestId,
        }),
      });
    } catch (error) {
      // The finalisation wrote nothing. End the request, if it is still ours.
      finish = await guard(() =>
        failNutritionGeneration(ctx, {
          requestId,
          claimToken: claim.claimToken,
          code: failureCodeForActivationError(error),
          at: now(),
        })
      );
    }
  } else {
    finish = await guard(() =>
      failNutritionGeneration(ctx, { requestId, claimToken: claim.claimToken, code: outcome.code, at: now() })
    );
  }

  // Lost: another invocation owns or ended the request; its document is the answer.
  return answer(finish.request, false);
};
