import { requireAuth, type AuthContextLike } from "../auth";
import { BACKEND_CAPABILITIES, BACKEND_NAME, FUNCTIONS_REGION, type BackendCapabilities } from "../config";

/**
 * The one thing the backend can do today: confirm that a signed-in client
 * reaches verified server-side code.
 *
 * It exists to prove the boundary — client auth → callable → verified auth
 * context → response — and nothing else. It reads no user document, writes
 * nothing, calls no provider and consumes no quota, so it is safe to call
 * from a developer seam without spending anything or leaving a trace in a
 * user's history.
 */

export interface CoachBackendStatus {
  ok: true;
  backend: string;
  region: string;
  /**
   * The caller's own uid, as the server resolved it from the verified token.
   *
   * Echoed back deliberately: it is the observable proof that identity came
   * from the token and not from the request payload. Nothing else about the
   * user is returned — no email, no name, no profile.
   */
  uid: string;
  capabilities: BackendCapabilities;
}

/**
 * Pure handler. Takes only what it needs, returns a plain object, touches no
 * global — so the auth rules can be tested without a Firebase runtime.
 */
export const handleCoachBackendStatus = (request: AuthContextLike): CoachBackendStatus => {
  const caller = requireAuth(request);

  return {
    ok: true,
    backend: BACKEND_NAME,
    region: FUNCTIONS_REGION,
    uid: caller.uid,
    capabilities: { ...BACKEND_CAPABILITIES },
  };
};
