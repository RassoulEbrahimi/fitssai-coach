import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

/**
 * The server's own view of who is calling.
 *
 * The only trustworthy source of a caller's identity is the verified ID token
 * Firebase attaches to the request. Anything in the request payload was typed
 * by the caller and can say whatever the caller likes.
 */
export interface AuthenticatedCaller {
  uid: string;
}

/**
 * The minimum shape this module needs from a callable request.
 *
 * Narrowed on purpose so the guard can be exercised without constructing a
 * real Firebase request object in tests.
 */
export interface AuthContextLike {
  auth?: { uid?: string | null } | null;
}

/**
 * Resolve the caller, or refuse.
 *
 * Reads `request.auth.uid` and nothing else. A `uid` in the request data is
 * ignored — not merged, not preferred, not used as a fallback — so a signed-in
 * user cannot address the backend as somebody else by putting another id in
 * the payload. The same applies to any claim of being an admin: role decisions
 * belong to verified token claims, never to request data.
 */
export const requireAuth = (request: AuthContextLike): AuthenticatedCaller => {
  const uid = request.auth?.uid;

  if (typeof uid !== "string" || uid.trim() === "") {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  return { uid };
};

export type { CallableRequest };
