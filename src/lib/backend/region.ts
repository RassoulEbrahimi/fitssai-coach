/**
 * Region the callable functions are deployed to.
 *
 * Must match `FUNCTIONS_REGION` in functions/src/config.ts: the client builds
 * the callable URL from this value, so a mismatch produces a 404 that looks
 * like a missing function rather than a misconfigured one. A test pins the two
 * together.
 */
export const FUNCTIONS_REGION = "europe-west3";
