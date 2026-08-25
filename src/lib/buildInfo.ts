/**
 * Build identity, injected at build time from the Git commit being deployed.
 *
 * Exists so the running browser/PWA can be checked against the latest deploy —
 * the service worker can serve a precached shell, so "is this actually the new
 * build?" is otherwise hard to answer. Read-only, never hand-edited.
 */

declare const __FITSSAI_BUILD_SHA__: string;

/** Trim a commit SHA to the conventional short form. */
export const shortenSha = (sha: string | null | undefined): string => {
  if (typeof sha !== "string") return "dev";
  const trimmed = sha.trim();
  if (trimmed === "" || trimmed === "unknown") return "dev";
  // Only treat it as a SHA if it actually looks like one.
  if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) return "dev";
  return trimmed.slice(0, 7).toLowerCase();
};

/** e.g. "Build 348328c", or "Build dev" outside a Git checkout. */
export const formatBuildLabel = (sha: string | null | undefined): string =>
  `Build ${shortenSha(sha)}`;

const injected = typeof __FITSSAI_BUILD_SHA__ === "string" ? __FITSSAI_BUILD_SHA__ : null;

export const BUILD_SHA = shortenSha(injected);
export const BUILD_LABEL = formatBuildLabel(injected);
