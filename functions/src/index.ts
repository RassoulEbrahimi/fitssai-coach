import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FUNCTIONS_REGION } from "./config";
import { handleCoachBackendStatus } from "./coaching/status";
import { handleGenerateWorkoutPlan } from "./coaching/generatePlan";
import { handleGenerateWeeklyReview } from "./coaching/weeklyReview";
import { createGeminiProvider } from "./coaching/providers/gemini";
import { createFirestoreQuotaStore } from "./quota/firestoreQuotaStore";
import { createFirestoreAiLogWriter } from "./logging/firestoreAiLogWriter";
import { createFirestoreOperationStore } from "./idempotency";
import { isAiError } from "./errors";
import { db } from "./firebase";
import { handleNutritionSetTarget } from "./nutrition/setTarget";
import { toNutritionHttpsError } from "./nutrition/errors";
import { productionTargetPolicyRegistry } from "./nutrition/targetPolicy/registry";
import { handleNutritionRepeatPlan } from "./nutrition/repeatPlan";
import { productionPlanValidationPolicyRegistry } from "./nutrition/planValidation/registry";
import { handleNutritionUpdateSlot } from "./nutrition/updateSlot";
import { handleNutritionRequestPlan } from "./nutrition/requestPlan";
import { productionNutritionGenerationProviderRegistry } from "./nutrition/providers/productionRegistry";
import { NUTRITION_AI_PRODUCTION_ENABLED } from "./nutrition/aiGate";
import { productionInitialSlotConfiguration } from "./nutrition/generationInput";

/**
 * FitssAI Coach backend entry point.
 *
 * Each export is a thin Firebase wrapper around a pure handler: the wrapper
 * owns the runtime concerns (region, secrets, instance limits, the callable
 * protocol) and the handler owns the decisions, so the decisions can be tested
 * without a deployment.
 *
 * Authentication is enforced inside the handlers rather than by configuration.
 * A callable happily runs for an anonymous caller — `request.auth` is simply
 * absent — so refusing that request is code, and code can be tested.
 */

/**
 * The provider API key.
 *
 * A Firebase Functions secret: injected into the runtime at call time, never
 * committed, never in a build artifact, and never prefixed `VITE_` — anything
 * with that prefix is compiled into the browser bundle and readable by every
 * visitor. Set it with `firebase functions:secrets:set GEMINI_API_KEY`.
 */
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

export const coachBackendStatus = onCall(
  {
    region: FUNCTIONS_REGION,
    // A status probe should never be the reason a bill grows.
    maxInstances: 3,
  },
  (request) => handleCoachBackendStatus(request)
);

/**
 * Generate a four-week plan for the signed-in caller.
 *
 * The only input is an opaque request id used for duplicate protection; every
 * generation input is read server-side from the caller's own profile, so the
 * browser cannot dictate what is sent to the model.
 */
export const generateWorkoutPlan = onCall(
  {
    region: FUNCTIONS_REGION,
    secrets: [GEMINI_API_KEY],
    // Each call is a paid model request, so concurrency is capped low.
    maxInstances: 5,
    // A four-week plan takes the model a while; the default 60s is too tight,
    // and a timeout after the provider was billed is the worst outcome.
    timeoutSeconds: 180,
    memory: "512MiB",
  },
  async (request) => {
    const firestore = db();

    try {
      return await handleGenerateWorkoutPlan(request, {
        firestore,
        provider: createGeminiProvider({ apiKey: GEMINI_API_KEY.value() }),
        quota: createFirestoreQuotaStore({ firestore }),
        operations: createFirestoreOperationStore(firestore),
        log: createFirestoreAiLogWriter({ firestore }).writeEntry,
      });
    } catch (error) {
      /*
        Only our own error codes cross this boundary. A provider's message can
        carry endpoints, project quota details and request ids; a Firestore
        error can carry internal paths. The client maps the code to its own
        German copy, so nothing here reaches a user as prose.
      */
      if (isAiError(error)) {
        throw new HttpsError("failed-precondition", error.code, error.details);
      }
      throw new HttpsError("internal", "INTERNAL");
    }
  }
);

/**
 * The weekly review and its one coaching recommendation.
 *
 * Takes no input: the plan, the logs and the two profile fields it uses are
 * read server-side under the caller's own uid, so nothing a browser sends can
 * decide what the review says. It writes nothing to the user's documents —
 * there is no branch in the handler that creates, edits or regenerates a
 * workout plan, and the recommendation is advice the user acts on or ignores.
 *
 * Its quota is `weekly_summary`, separate from plan generation: a rephrased
 * sentence must never eat into somebody's three plans a month.
 */
export const generateWeeklyReview = onCall(
  {
    region: FUNCTIONS_REGION,
    secrets: [GEMINI_API_KEY],
    maxInstances: 5,
    // Three short strings, so the default 60s is generous — but the two
    // Firestore reads happen first, and a cold instance pays for both.
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    const firestore = db();

    try {
      return await handleGenerateWeeklyReview(request, {
        firestore,
        provider: createGeminiProvider({ apiKey: GEMINI_API_KEY.value() }),
        quota: createFirestoreQuotaStore({ firestore }),
        log: createFirestoreAiLogWriter({ firestore }).writeEntry,
      });
    } catch (error) {
      // Same boundary as plan generation: our codes cross, provider prose
      // never does. A weekly review reaches here only if reading the caller's
      // own data failed — every model failure degrades inside the handler.
      if (isAiError(error)) {
        throw new HttpsError("failed-precondition", error.code, error.details);
      }
      throw new HttpsError("internal", "INTERNAL");
    }
  }
);

/**
 * Nutrition V2: generate and activate a plan for the caller (NUT-11).
 *
 * The request is only `{ requestId }`. The lifecycle behind it — one active
 * generation per account, a persistent generation request, a minimized input,
 * at most one repair, and one atomic finalisation through the NUT-09
 * activation core — is complete, and a Vertex AI generator exists (NUT-12B).
 * The backend gate `NUTRITION_AI_PRODUCTION_ENABLED` is on since NUT-14, so an
 * eligible account's new request is generated with everything the gate waited
 * for: the signed `target-alignment` v1 policy and the v1 first-plan slot
 * mapping (NUT-12C.1), the signed Vertex deployment, the execution budget
 * below and the `nutrition_plan_generation` quota — four activated plans per
 * UTC month, reserved with the claim, charged with the activation (NUT-12C.2).
 * With the gate closed again (rollback), a new request answers
 * `NUTRITION_AI_DISABLED` before the generator registry is asked, and writes
 * nothing.
 *
 * No secret (Vertex AI authenticates as the runtime's own identity) and no
 * log. The timeout is sized for one generation plus one repair; see
 * `PRODUCTION_NUTRITION_VERTEX_DEPLOYMENT`.
 */
export const nutritionRequestPlan = onCall(
  {
    region: FUNCTIONS_REGION,
    maxInstances: 5,
    // 240 s: the worst-case provider time (about 181 s) fits inside it, and
    // it ends before the 300-second operation lease does.
    timeoutSeconds: 240,
    memory: "256MiB",
  },
  async (request) => {
    try {
      return await handleNutritionRequestPlan(request, {
        firestore: db(),
        generationEnabled: NUTRITION_AI_PRODUCTION_ENABLED,
        providers: productionNutritionGenerationProviderRegistry,
        policies: productionPlanValidationPolicyRegistry,
        initialSlots: productionInitialSlotConfiguration,
        quota: createFirestoreQuotaStore({ firestore: db() }),
      });
    } catch (error) {
      // Only our codes cross; see nutrition/errors.ts.
      throw toNutritionHttpsError(error);
    }
  }
);

/**
 * Nutrition V2: create the caller's next TARGET version.
 *
 * The request is only `{ mode, requestId }`. The profile is read server-side
 * under the verified uid, and the target and the account state commit in one
 * transaction. The production registry holds the signed TargetPolicy v1
 * (NUT-12C.1): `calculated-target` v1 and `manual-target` v1. Answers the
 * policy supports no target for are refused as `TARGET_INFEASIBLE`.
 *
 * No secret, no provider, no quota and no log: nothing here is paid for, and
 * no profile value is recorded anywhere.
 */
export const nutritionSetTarget = onCall(
  {
    region: FUNCTIONS_REGION,
    maxInstances: 5,
    // Two reads and one small transaction.
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    try {
      return await handleNutritionSetTarget(request, {
        firestore: db(),
        policies: productionTargetPolicyRegistry,
      });
    } catch (error) {
      // Only our codes cross, and field names at most; see nutrition/errors.ts.
      throw toNutritionHttpsError(error);
    }
  }
);

/**
 * Nutrition V2: activate next week as a repeat of the active plan's base
 * content.
 *
 * The request is only `{ requestId }`. The profile, the state, the active
 * plan and the target are read server-side under the verified uid, and the
 * new plan, the superseded old plan and the account state commit in one
 * transaction. The repeated week is validated by the signed
 * `target-alignment` v1 policy (NUT-12C.1) against the current target, unless
 * its source was accepted under that same policy version.
 *
 * No secret, no provider, no quota and no log: nothing here is generated.
 */
export const nutritionRepeatPlan = onCall(
  {
    region: FUNCTIONS_REGION,
    maxInstances: 5,
    // A handful of reads and one small transaction.
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    try {
      return await handleNutritionRepeatPlan(request, {
        firestore: db(),
        policies: productionPlanValidationPolicyRegistry,
      });
    } catch (error) {
      // Only our codes cross; see nutrition/errors.ts.
      throw toNutritionHttpsError(error);
    }
  }
);

/**
 * Nutrition V2: replace one slot's PLANNED meal on one date, or undo the
 * selected replacement (NUT-10).
 *
 * The request names ids only — the slot, the revision the person saw, and a
 * base meal of the plan or a server-held suggestion candidate. The profile,
 * the plan that owns the date, the slot head, the slot's recorded entry and
 * any suggestion set are read server-side under the verified uid, and the head
 * (and a candidate's consumption) commit in one transaction. The base plan,
 * the target and every recorded entry are never written.
 *
 * No secret, no provider, no quota and no log: nothing here is generated. No
 * production code creates suggestion sets yet, so a suggestion commit finds
 * none.
 */
export const nutritionUpdateSlot = onCall(
  {
    region: FUNCTIONS_REGION,
    maxInstances: 5,
    // A handful of reads and one small transaction.
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    try {
      return await handleNutritionUpdateSlot(request, { firestore: db() });
    } catch (error) {
      // Only our codes cross, and a revision number at most; see nutrition/errors.ts.
      throw toNutritionHttpsError(error);
    }
  }
);
