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
