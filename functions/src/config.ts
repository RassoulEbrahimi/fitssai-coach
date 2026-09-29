/**
 * Backend identity and deployment constants.
 *
 * Deliberately free of secrets. Every value here is either a public identifier
 * or a deployment choice that belongs in review, not in an environment
 * variable nobody can audit.
 */

/**
 * Cloud Functions region.
 *
 * FitssAI's users are in Germany, so the backend runs in Frankfurt rather than
 * a US default: it is the closest supported region, and it keeps request
 * handling inside the EU. If the Firebase project's Firestore location turns
 * out to be elsewhere, this is the one place to change — see
 * docs/dev/firebase-backend.md.
 */
export const FUNCTIONS_REGION = "europe-west3";

/** Identifies this backend in responses. Not a secret, not a project id. */
export const BACKEND_NAME = "fitssai-coach";

/**
 * What the backend can actually do today.
 *
 * These are answered in code rather than in a comment, because the client is
 * entitled to ask rather than assume. Flipping either without shipping the
 * capability behind it would be the same untruth PR46 removed from the UI, so
 * each one moved only when the callable behind it did.
 */
export interface BackendCapabilities {
  /** Server-side generation of a four-week plan. */
  planGeneration: boolean;
  /**
   * Model-written wording over the deterministic weekly review.
   *
   * Wording only. The metrics and the recommendation category are computed by
   * the backend either way, and no plan is ever changed by either path.
   */
  weeklySummaryAI: boolean;
  /**
   * Setting a Nutrition V2 target. `nutritionSetTarget` runs the signed
   * TargetPolicy v1 for both modes (NUT-12C.1). The browser offers target setup
   * only while the deployed backend answers true here (NUT-14), so this flag is
   * the product exposure switch: false hides the action without touching any
   * stored target. It is not a server gate — the callable itself stays an
   * authenticated, deterministic endpoint either way.
   */
  nutritionTargets: boolean;
  /**
   * Generating a Nutrition V2 plan through `nutritionRequestPlan` (NUT-11)
   * and its signed Vertex AI deployment (NUT-12B/C). True only together with
   * the backend gate `NUTRITION_AI_PRODUCTION_ENABLED` (NUT-14): a configured
   * generator behind a closed gate is not the capability being available. The
   * browser offers generation only while the deployed backend answers true.
   */
  nutritionGeneration: boolean;
}

export const BACKEND_CAPABILITIES: Readonly<BackendCapabilities> = Object.freeze({
  // True from PR55: `generateWorkoutPlan` is a real callable backed by a real
  // model. It stays true only while that remains so.
  planGeneration: true,
  // True from PR58: `generateWeeklyReview` asks a real model to phrase the
  // recommendation the deterministic rules chose. It stays true only while
  // that remains so — and a false here would still leave the review working,
  // because the wording falls back to the app's own.
  weeklySummaryAI: true,
  // True from NUT-14, the reviewed enablement signed off on 2026-09-29. The
  // signed target policies have been registered since NUT-12C.1. Rollback:
  // false, and deploy `coachBackendStatus`; target history is untouched.
  nutritionTargets: true,
  // True from NUT-14, together with the backend gate
  // `NUTRITION_AI_PRODUCTION_ENABLED`: the Vertex deployment, the
  // plan-validation policy, first-plan slots and the quota are signed
  // (NUT-12C). Rollback: false together with the gate, and deploy
  // `nutritionRequestPlan` and `coachBackendStatus`.
  nutritionGeneration: true,
});
