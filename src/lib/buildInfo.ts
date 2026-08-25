/**
 * Build identity, injected at build time.
 *
 * Exists so the running browser/PWA can be checked against the latest deploy —
 * the service worker can serve a precached shell, so "is this actually the new
 * build?" is otherwise hard to answer. Both values come from the build
 * (package.json and Git); neither is ever hand-edited here.
 */

declare const __FITSSAI_BUILD_SHA__: string;
declare const __FITSSAI_APP_VERSION__: string;

/** Trim a commit SHA to the conventional short form. */
export const shortenSha = (sha: string | null | undefined): string => {
  if (typeof sha !== "string") return "dev";
  const trimmed = sha.trim();
  if (trimmed === "" || trimmed === "unknown") return "dev";
  // Only treat it as a SHA if it actually looks like one.
  if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) return "dev";
  return trimmed.slice(0, 7).toLowerCase();
};

/** Fall back to the package.json default rather than inventing a version. */
export const normalizeVersion = (version: string | null | undefined): string => {
  if (typeof version !== "string") return "0.0.0";
  const trimmed = version.trim();
  return trimmed === "" ? "0.0.0" : trimmed;
};

/** e.g. "Build 348328c" — kept for callers that only need the commit. */
export const formatBuildLabel = (sha: string | null | undefined): string =>
  `Build ${shortenSha(sha)}`;

/**
 * e.g. "Version 0.0.0 · 4a9741f", or "Version 0.0.0 · dev" outside a Git
 * checkout. The separator is a middle dot, not a hyphen, so the version and
 * the commit stay visually distinct.
 */
export const formatVersionLabel = (
  version: string | null | undefined,
  sha: string | null | undefined
): string => `Version ${normalizeVersion(version)} · ${shortenSha(sha)}`;

const injectedSha = typeof __FITSSAI_BUILD_SHA__ === "string" ? __FITSSAI_BUILD_SHA__ : null;
const injectedVersion =
  typeof __FITSSAI_APP_VERSION__ === "string" ? __FITSSAI_APP_VERSION__ : null;

export const BUILD_SHA = shortenSha(injectedSha);
export const APP_VERSION = normalizeVersion(injectedVersion);
export const BUILD_LABEL = formatBuildLabel(injectedSha);
export const VERSION_LABEL = formatVersionLabel(injectedVersion, injectedSha);
