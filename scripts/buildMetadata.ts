/**
 * Build identity, resolved once at build time.
 *
 * Lives outside vite.config.ts so the rules that decide what a bundle claims
 * about itself can be exercised directly by a test, rather than inferred from
 * a built artifact. vite.config.ts is the only production caller.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Commit being built. CI supplies GITHUB_SHA; locally we ask Git. When neither
 * answers we return "unknown", which the app renders as "dev" — a build with no
 * commit behind it must not look like a release.
 */
export const resolveBuildSha = (
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): string => {
  const fromCi = env.GITHUB_SHA || env.VITE_BUILD_SHA;
  if (fromCi && fromCi.trim() !== "") return fromCi.trim();
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
};

/**
 * App version, read from the root package.json — the single source of truth.
 *
 * Deliberately throws rather than falling back: a bundle that cannot read its
 * own version has nothing truthful to display, and the scaffold default 0.0.0
 * that used to be substituted here is indistinguishable from a real release.
 * Failing the build is the honest outcome.
 *
 * `rootDir` is passed in rather than derived from this module's own location,
 * because Vite bundles the config into a temporary file and rewrites
 * `import.meta.url`/`__dirname` to the config's path — anchoring on anything
 * else would resolve differently under Vite than under the test runner.
 */
export const resolveAppVersion = (rootDir: string): string => {
  const manifestPath = path.join(rootDir, "package.json");

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (cause) {
    throw new Error(`Cannot read the app version: ${manifestPath} is unreadable.`, {
      cause,
    });
  }

  const version = (JSON.parse(raw) as { version?: unknown }).version;
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error(`Cannot read the app version: ${manifestPath} declares no "version".`);
  }

  return version.trim();
};
