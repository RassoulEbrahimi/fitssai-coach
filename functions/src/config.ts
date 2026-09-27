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
   * Setting a Nutrition V2 target. False: `nutritionSetTarget` exists, but no
   * target policy is signed off, so it can only answer
   * `TARGET_POLICY_NOT_CONFIGURED`.
   */
  nutritionTargets: boolean;
  /**
   * Generating a Nutrition V2 plan. False: `nutritionRequestPlan` and its
   * lifecycle exist (NUT-11) and a Vertex AI generator is implemented
   * (NUT-12B), but the backend gate `NUTRITION_AI_PRODUCTION_ENABLED` is off
   * and no deployment or plan-validation policy is configured, so it can only
   * answer `NUTRITION_AI_DISABLED`. A generator existing in code is not the
   * capability being available.
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
  // False from NUT-08: the target plumbing is deployed, but the production
  // policy registry is empty, so no target can actually be set. It moves only
  // with a signed-off policy.
  nutritionTargets: false,
  // False from NUT-11: the generation infrastructure is deployed, but the
  // production generator and plan-validation registries are empty, so no plan
  // can actually be generated. It moves only with a real generator and a
  // signed-off policy. NUT-12B adds the generator code behind a closed backend
  // gate, which changes none of that.
  nutritionGeneration: false,
});
