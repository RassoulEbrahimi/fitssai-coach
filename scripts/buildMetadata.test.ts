import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAppVersion, resolveBuildSha } from "./buildMetadata";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const declaredVersion = (
  JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  }
).version;

const CI_SHA = "533255f51666f86fce533226c96ee111bf2bcb49";

/** A directory that is neither the repo nor a Git checkout. */
const scratchDir = (): string => mkdtempSync(path.join(tmpdir(), "fitssai-build-"));

describe("resolveBuildSha", () => {
  it("embeds the commit GitHub Actions supplies", () => {
    expect(resolveBuildSha({ GITHUB_SHA: CI_SHA })).toBe(CI_SHA);
  });

  it("accepts an explicit VITE_BUILD_SHA when GITHUB_SHA is absent", () => {
    expect(resolveBuildSha({ VITE_BUILD_SHA: CI_SHA })).toBe(CI_SHA);
  });

  it("ignores an empty CI value instead of embedding a blank commit", () => {
    // No env commit and no Git: the local fallback is what has to answer here.
    expect(resolveBuildSha({ GITHUB_SHA: "  " }, scratchDir())).toBe("unknown");
  });

  it("falls back to the local checkout's commit in development", () => {
    expect(resolveBuildSha({}, repoRoot)).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reports 'unknown' rather than a fabricated commit outside a checkout", () => {
    // buildInfo renders "unknown" as "dev", so a commit-less build cannot pass
    // itself off as a release.
    expect(resolveBuildSha({}, scratchDir())).toBe("unknown");
  });
});

describe("resolveAppVersion", () => {
  it("derives the canonical version from the root package.json", () => {
    expect(resolveAppVersion(repoRoot)).toBe(declaredVersion);
  });

  it("needs no version environment variable to do it", () => {
    // The only inputs are the manifest and the directory it lives in; there is
    // no env override that could go missing in CI and change the answer.
    expect(resolveAppVersion(repoRoot)).toBe(declaredVersion);
    expect(resolveAppVersion(repoRoot)).not.toBe("0.0.0");
  });

  it("fails the build when the manifest cannot be read", () => {
    expect(() => resolveAppVersion(scratchDir())).toThrow(/Cannot read the app version/);
  });

  it("fails the build rather than substituting 0.0.0 for a missing version", () => {
    const dir = scratchDir();
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }), "utf8");

    expect(() => resolveAppVersion(dir)).toThrow(/declares no "version"/);
  });
});

describe("release build identity", () => {
  it("matches what a GitHub Actions build embeds", () => {
    expect({
      version: resolveAppVersion(repoRoot),
      sha: resolveBuildSha({ GITHUB_SHA: CI_SHA }),
    }).toEqual({ version: declaredVersion, sha: CI_SHA });
  });

  it("cannot silently produce 0.0.0 while the package version is non-zero", () => {
    expect(declaredVersion).not.toBe("0.0.0");
    expect(resolveAppVersion(repoRoot)).not.toBe("0.0.0");
  });
});
