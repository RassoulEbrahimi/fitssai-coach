import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { nutritionTargetFingerprintMaterial } from "../../../shared/nutrition";
import { BACKEND_CAPABILITIES } from "../config";
import { nodeSha256Hex } from "./sha256";

/*
  NUT-08 boundaries on source: fixture target policies can never reach the
  deployed backend, the production policy seam carries no formula, and the
  target callable stays free of providers, quota, `_ai_operations` and logs.
*/

const FUNCTIONS_ROOT = join(__dirname, "..", "..");
const SRC = join(FUNCTIONS_ROOT, "src");
const REPO_ROOT = join(FUNCTIONS_ROOT, "..");

const posix = (value: string) => value.split(/[\\/]/).join("/");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.ts$/.test(full) ? [full] : [];
  });
const rel = (file: string) => posix(relative(FUNCTIONS_ROOT, file));
const code = (file: string) =>
  readFileSync(file, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Everything the Functions build compiles: not a test, not a fixture, not src/testing. */
const productionSources = walk(SRC).filter((file) => {
  const path = rel(file);
  return !/\.(test|fixtures)\.ts$/.test(path) && !path.startsWith("src/testing/");
});

const nutritionSources = productionSources.filter((file) => rel(file).startsWith("src/nutrition/"));

describe("fixture target policies stay out of production", () => {
  it("are imported by no module the build compiles", () => {
    const importers = productionSources.filter((file) => /from\s+["'][^"']*testing\//.test(readFileSync(file, "utf-8")));
    expect(importers.map(rel)).toEqual([]);
  });

  it("live only in src/testing/, which the build excludes", () => {
    const definers = walk(SRC).filter((file) => /FIXTURE_\w+_POLICY\s*=/.test(readFileSync(file, "utf-8")));
    expect(definers.map(rel)).toEqual(["src/testing/fixtureTargetPolicies.ts"]);

    const build = JSON.parse(
      readFileSync(join(FUNCTIONS_ROOT, "tsconfig.json"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "")
    ) as { exclude: string[] };
    expect(build.exclude).toContain("src/testing/**");
  });

  it("are not named by the entry point or the production registry", () => {
    for (const file of ["src/index.ts", "src/nutrition/targetPolicy/registry.ts"]) {
      expect(code(join(FUNCTIONS_ROOT, file)), file).not.toMatch(/fixture|testing/i);
    }
  });

  it("the deployed callable is wired to the production registry only", () => {
    const index = code(join(SRC, "index.ts"));
    const wiring = index.slice(index.indexOf("export const nutritionSetTarget"));

    expect(wiring).toContain("handleNutritionSetTarget(request");
    expect(wiring).toContain("policies: productionTargetPolicyRegistry");
    expect(wiring).not.toMatch(/secrets|GEMINI|provider|Provider|quota|Quota|operations|log\(|Log/);
  });
});

describe("the production target seam carries no formula", () => {
  it("sweeps the nutrition sources", () => {
    expect(nutritionSources.map(rel).sort()).toEqual([
      "src/nutrition/errors.ts",
      "src/nutrition/setTarget.ts",
      "src/nutrition/sha256.ts",
      "src/nutrition/targetPolicy/registry.ts",
      "src/nutrition/targetPolicy/types.ts",
    ]);
  });

  it.each(nutritionSources.map(rel))("%s names no energy equation or target constant", (file) => {
    const source = code(join(FUNCTIONS_ROOT, file));
    expect(source).not.toMatch(/mifflin|st\.? ?jeor|harris|benedict|katch|\bbmr\b|\btdee\b|\bpal\b|multiplier|deficit|surplus/i);
    expect(source).not.toMatch(/per ?kg|perKg|\bkcalPer|proteinPer|fatPer|carbRemainder/i);
  });

  it.each(nutritionSources.map(rel))("%s uses no provider, quota, AI operation record or logging", (file) => {
    const source = code(join(FUNCTIONS_ROOT, file));
    expect(source).not.toMatch(/_ai_operations|OPERATION_COLLECTION|createFirestoreOperationStore/);
    expect(source).not.toMatch(/quota|provider|gemini|AiLog|console\./i);
  });

  it("writes the target with create, never set or merge", () => {
    const source = code(join(SRC, "nutrition", "setTarget.ts"));
    expect(source).toMatch(/tx\.create\(targetRef\(targetVersionId\), target\)/);
    expect(source).not.toMatch(/merge/);
    expect(source).not.toMatch(/\.(update|delete)\(/);
  });
});

describe("capabilities stay truthful", () => {
  it("does not claim Nutrition targets or generation", () => {
    expect(BACKEND_CAPABILITIES.nutritionTargets).toBe(false);
    expect(BACKEND_CAPABILITIES.nutritionGeneration).toBe(false);
  });
});

describe("the fingerprint hash is environment-independent", () => {
  /*
    The same material and digest are pinned in the client suite, where Web
    Crypto computes it (src/lib/nutrition/nutritionFingerprint.test.ts), and
    the value was cross-checked with `sha256sum`. A drift in either
    environment's material or digest fails one of the two.
  */
  const PINNED_MATERIAL =
    '["fitssai.nutrition.targetFingerprint",1,"calculated",["pin-policy",3],["biologicalSex","height","weight"],[["biologicalSex","notSpecified"],["height",180],["weight",70.5]]]';
  const PINNED_HASH = "d640ab6e8e902feed3eeb9856f075c4bb9eeae8cd0f1d33309b0ed60ef14128a";

  it("builds the pinned material and hashes it with Node's SHA-256", async () => {
    const material = nutritionTargetFingerprintMaterial({
      mode: "calculated",
      policy: { id: "pin-policy", version: 3 },
      fields: ["weight", "height", "biologicalSex"],
      values: { weight: 70.5, height: 180, biologicalSex: "notSpecified" },
    });
    expect(material).toBe(PINNED_MATERIAL);
    expect(await nodeSha256Hex(material)).toBe(PINNED_HASH);
  });

  it("is pinned to the same value in the client suite", () => {
    const client = readFileSync(join(REPO_ROOT, "src", "lib", "nutrition", "nutritionFingerprint.test.ts"), "utf-8");
    expect(client).toContain(PINNED_HASH);
  });
});
