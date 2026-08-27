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
 * Both are false, and they are false in code rather than in a comment, because
 * the client is entitled to ask rather than assume. PR50 builds the execution
 * layer; it does not add a model. Flipping either of these without shipping
 * the capability behind it would be the same untruth PR46 removed from the UI.
 */
export interface BackendCapabilities {
  /** Server-side generation of a four-week plan. */
  planGeneration: boolean;
  /** Model-written prose over the deterministic weekly review. */
  weeklySummaryAI: boolean;
}

export const BACKEND_CAPABILITIES: Readonly<BackendCapabilities> = Object.freeze({
  planGeneration: false,
  weeklySummaryAI: false,
});
