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
});
