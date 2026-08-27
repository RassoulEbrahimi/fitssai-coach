import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
  The backend must compile and test from its own dependency tree alone.

  It did not, at first: `shared/` has no node_modules, so a bare import from it
  resolved by walking up into the client's root install — present on a
  developer's machine, absent in the backend CI job — and vitest found the
  client's PostCSS config the same way. Both passed locally and failed in CI.
  These guards encode the rule the CI job enforces, so the next such import is
  caught before the push.
*/

const FUNCTIONS_DIR = join(__dirname, "..");
const SHARED_DIR = join(FUNCTIONS_DIR, "..", "shared");

const readJsonWithComments = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, ""));

/** Bare package names imported anywhere under shared/. */
const sharedBareImports = (): string[] => {
  const names = new Set<string>();
  for (const file of readdirSync(SHARED_DIR).filter((entry) => entry.endsWith(".ts"))) {
    const code = readFileSync(join(SHARED_DIR, file), "utf-8");
    for (const match of code.matchAll(/(?:from|import)\s+["']([^"'.][^"']*)["']/g)) {
      names.add(match[1]);
    }
  }
  return [...names];
};

describe("the backend workspace is self-contained", () => {
  const tsconfig = readJsonWithComments(join(FUNCTIONS_DIR, "tsconfig.json"));
  const options = tsconfig.compilerOptions as Record<string, unknown>;
  const paths = (options.paths ?? {}) as Record<string, string[]>;
  const pkg = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "package.json"), "utf-8"));

  it("finds something to check", () => {
    expect(sharedBareImports().length).toBeGreaterThan(0);
  });

  it.each(sharedBareImports())(
    "maps '%s' to this workspace so shared/ never borrows the client install",
    (name) => {
      expect(paths[name]).toBeDefined();
      expect(paths[name][0]).toMatch(/^node_modules\//);
    }
  );

  it.each(sharedBareImports())("declares '%s' as its own dependency", (name) => {
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };

    // The runtime resolves it by walking up to functions/node_modules, which is
    // what gets deployed — so it has to be declared here, not just mapped.
    expect(Object.keys(declared)).toContain(name);
  });

  it("processes no CSS, so no client config is searched for", () => {
    const config = readFileSync(join(FUNCTIONS_DIR, "vitest.config.mts"), "utf-8");

    expect(config).toMatch(/postcss:\s*\{\s*plugins:\s*\[\]\s*\}/);
  });

  it("runs its tests in a node environment", () => {
    const config = readFileSync(join(FUNCTIONS_DIR, "vitest.config.mts"), "utf-8");

    expect(config).toMatch(/environment:\s*["']node["']/);
  });
});
