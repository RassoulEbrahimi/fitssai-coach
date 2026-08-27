import { onCall } from "firebase-functions/v2/https";
import { FUNCTIONS_REGION } from "./config";
import { handleCoachBackendStatus } from "./coaching/status";

/**
 * FitssAI Coach backend entry point.
 *
 * Each export here is a thin Firebase wrapper around a pure handler: the
 * wrapper owns the runtime concerns (region, instance limits, the callable
 * protocol) and the handler owns the decisions, so the decisions can be tested
 * without a deployment.
 *
 * Authentication is enforced inside the handler rather than by configuration.
 * A callable happily runs for an anonymous caller — `request.auth` is simply
 * absent — so refusing that request is code, and code can be tested.
 *
 * No provider SDK is imported, no model is called and no API key is read.
 * This PR builds the execution layer; the capability comes later.
 */

export const coachBackendStatus = onCall(
  {
    region: FUNCTIONS_REGION,
    // A status probe should never be the reason a bill grows.
    maxInstances: 3,
  },
  (request) => handleCoachBackendStatus(request)
);
