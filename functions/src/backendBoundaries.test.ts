import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  FORBIDDEN_PROVIDER_FIELDS,
  planGenerationInputSchema,
  type PlanGenerationInput,
} from "./coaching/planGenerationInput";
import { weeklyReviewInputSchema, type WeeklyReviewInput } from "./coaching/weeklyReviewInput";
import { getCoachProvider } from "./coaching/provider";

/*
  Boundaries the backend has to keep: the vendor stays behind the provider
  seam, personal data stays out of the prompt input, no secret is readable from
  a browser, and the status callable stays inert.

  Every path here is compared in POSIX form. `path.relative` yields the host
  separator, so on Windows these guards used to compare
  `functions\src\coaching\providers\gemini.ts` against a forward-slash
  literal and fail on a correct implementation — a test that only passes on the
  maintainer's operating system is not a guard.
*/

const FUNCTIONS_ROOT = join(__dirname);
const REPO_ROOT = join(__dirname, "..", "..");

/**
 * A repository path in POSIX form, whatever platform produced it.
 *
 * Splits on either separator rather than only `path.sep`, so the result does
 * not depend on the host running the test — a Windows-shaped path normalises
 * correctly on Linux too, which is what makes the fixtures below assert
 * unconditionally. (No file in this repository has a backslash in its name,
 * which is the only case that would mangle.)
 */
export const toPosix = (value: string): string => value.split(/[\\/]/).join("/");

/** The one directory a provider SDK may be imported from. */
export const PROVIDER_DIRECTORY = "functions/src/coaching/providers/";

/**
 * Whether a repository-relative path is a provider implementation.
 *
 * A directory rule rather than a filename list: the second provider should be
 * a new file in `providers/`, and adding it should not mean editing this test.
 * Takes any separator so callers cannot forget to normalise.
 */
export const isProviderImplementation = (path: string): boolean =>
  toPosix(path).startsWith(PROVIDER_DIRECTORY);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.ts$/.test(full) ? [full] : [];
  });

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const backendSources = walk(FUNCTIONS_ROOT).filter(
  (file) => !/\.(test|fixtures)\.ts$/.test(file)
);

const sharedSources = walk(join(REPO_ROOT, "shared"));

/** Repository-relative and POSIX, so names and assertions match everywhere. */
const rel = (file: string) => toPosix(relative(REPO_ROOT, file));

describe("path normalisation", () => {
  it("converts this host's separator to POSIX", () => {
    expect(toPosix(join("functions", "src", "coaching", "providers", "gemini.ts"))).toBe(
      "functions/src/coaching/providers/gemini.ts"
    );
  });

  it("leaves an already-POSIX path alone", () => {
    expect(toPosix("functions/src/index.ts")).toBe("functions/src/index.ts");
  });

  it("normalises a Windows-shaped path on any host", () => {
    expect(toPosix("functions\\src\\coaching\\providers\\gemini.ts")).toBe(
      "functions/src/coaching/providers/gemini.ts"
    );
  });

  it("recognises a provider implementation whatever the separator", () => {
    // The Windows form is the one that used to slip through: `includes("/providers/")`
    // is false for a backslash path, so gemini.ts was not excluded from the
    // "no provider SDK" sweep and a correct implementation failed the guard.
    expect(isProviderImplementation("functions\\src\\coaching\\providers\\gemini.ts")).toBe(true);
    expect(isProviderImplementation("functions/src/coaching/providers/gemini.ts")).toBe(true);
    expect(
      isProviderImplementation(join("functions", "src", "coaching", "providers", "gemini.ts"))
    ).toBe(true);
  });

  it("rejects a Windows-shaped non-provider path too", () => {
    expect(isProviderImplementation("functions\\src\\coaching\\generatePlan.ts")).toBe(false);
  });

  it.each([
    "functions/src/coaching/generatePlan.ts",
    "functions/src/index.ts",
    "functions/src/quota/firestoreQuotaStore.ts",
    "functions/src/logging/firestoreAiLogWriter.ts",
    "functions/src/coaching/provider.ts",
  ])("does not treat %s as a provider implementation", (path) => {
    expect(isProviderImplementation(path)).toBe(false);
  });
});

describe("the vendor stays behind the provider seam", () => {
  it("leaves the generic lookup unconfigured — callables construct explicitly", () => {
    // The provider needs the API key, which only the callable has, so it is
    // built there rather than resolved from here.
    expect(getCoachProvider()).toBeNull();
  });

  it.each(backendSources.map(rel).filter((file) => !isProviderImplementation(file)))(
    "%s names no provider SDK",
    (file) => {
      const code = stripComments(readFileSync(join(REPO_ROOT, file), "utf-8"));

      // The seam is worth having only if the vendor stays behind it. One
      // import of the SDK outside providers/ and swapping vendors becomes a
      // refactor of the callers instead of a new file.
      expect(code).not.toMatch(/openai|anthropic|@google\/gen|generativeai|mistral|cohere|ollama/i);
      expect(code).not.toMatch(/api\.openai\.com|generativelanguage|api\.anthropic\.com/i);
    }
  );

  it("sweeps every non-provider backend source, and does sweep some", () => {
    const swept = backendSources.map(rel).filter((file) => !isProviderImplementation(file));

    // A filter that accidentally excluded everything would make the guard
    // above vacuously green.
    expect(swept.length).toBeGreaterThan(5);
    expect(swept).toContain("functions/src/coaching/generatePlan.ts");
    expect(swept).toContain("functions/src/index.ts");
    expect(swept).not.toContain("functions/src/coaching/providers/gemini.ts");
  });

  it("keeps every provider SDK import inside providers/", () => {
    const importers = backendSources
      .filter((file) => /from\s+["']@google\/genai["']/.test(readFileSync(file, "utf-8")))
      .map(rel);

    expect(importers).not.toEqual([]);
    expect(importers.every(isProviderImplementation)).toBe(true);
    expect(importers).toEqual(["functions/src/coaching/providers/gemini.ts"]);
  });

  it("resolves the importer list identically from Windows-shaped paths", () => {
    // The same list as it would arrive from `path.relative` on Windows.
    const windowsShaped = ["functions\\src\\coaching\\providers\\gemini.ts"];

    expect(windowsShaped.map(toPosix)).toEqual(["functions/src/coaching/providers/gemini.ts"]);
    expect(windowsShaped.every(isProviderImplementation)).toBe(true);
  });

  it("declares exactly one provider package, and not the legacy SDK", () => {
    const pkg = JSON.parse(readFileSync(join(FUNCTIONS_ROOT, "..", "package.json"), "utf-8"));
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    expect(declared).toContain("@google/genai");
    // @google/generative-ai is the superseded SDK and receives no new features.
    expect(declared).toEqual(
      expect.not.arrayContaining([
        "openai",
        "@anthropic-ai/sdk",
        "@google/generative-ai",
        "@mistralai/mistralai",
        "cohere-ai",
      ])
    );
  });

  it("keeps the provider package out of the client entirely", () => {
    const client = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
    const declared = Object.keys({ ...client.dependencies, ...client.devDependencies });

    // A provider SDK in the client is a provider call from the browser, which
    // means the key is in the browser.
    expect(declared).not.toContain("@google/genai");
    expect(declared.join(" ")).not.toMatch(/genai|generative-ai|openai|anthropic|mistral|cohere/i);
  });

  it("treats provider output as unknown, so the caller must validate it", () => {
    const source = readFileSync(join(FUNCTIONS_ROOT, "coaching/provider.ts"), "utf-8");

    // A typed plan return would make the provider the validation boundary.
    expect(source).toMatch(/generatePlan\(input: PlanGenerationInput\): Promise<unknown>/);
    expect(source).toMatch(/summariseWeeklyReview\([^)]*\): Promise<unknown>/);
    expect(source).not.toMatch(/Promise<WorkoutPlanContent>/);
  });
});

describe("plan-generation input is minimised", () => {
  const valid: PlanGenerationInput = {
    goal: "gainMuscle",
    experienceLevel: "intermediate",
    equipment: ["dumbbells"],
    daysPerWeek: 3,
    sessionMinutes: 60,
  };

  it("accepts the minimum a coach actually needs", () => {
    expect(planGenerationInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([...FORBIDDEN_PROVIDER_FIELDS])("rejects an input carrying %s", (field) => {
    const parsed = planGenerationInputSchema.safeParse({ ...valid, [field]: "value" });

    // Strict, so a well-meaning caller cannot smuggle personal data through as
    // an extra key that the schema silently strips and the provider still sees.
    expect(parsed.success).toBe(false);
  });

  it("names no personal field in its own shape", () => {
    const keys = Object.keys(planGenerationInputSchema.shape);

    expect(keys.sort()).toEqual([
      "daysPerWeek",
      "equipment",
      "experienceLevel",
      "goal",
      "sessionMinutes",
    ]);
    expect(keys.join(" ")).not.toMatch(/name|mail|uid|height|weight|birth/i);
  });

  it("requires a goal and at least one piece of equipment", () => {
    expect(planGenerationInputSchema.safeParse({ ...valid, equipment: [] }).success).toBe(false);
    expect(
      planGenerationInputSchema.safeParse({ ...valid, goal: "getRipped" }).success
    ).toBe(false);
  });
});

describe("weekly-review input is minimised", () => {
  const valid: WeeklyReviewInput = {
    weekNumber: 2,
    scheduledDays: 3,
    completedDays: 2,
    missedDays: 1,
    completionPercent: 67,
    category: "maintain",
    focus: "on-track",
  };

  it("accepts the minimum a weekly recommendation actually needs", () => {
    expect(weeklyReviewInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([...FORBIDDEN_PROVIDER_FIELDS])("rejects an input carrying %s", (field) => {
    // Strict, so a well-meaning caller cannot add personal context as an extra
    // key that the schema silently strips and the provider still receives.
    expect(weeklyReviewInputSchema.safeParse({ ...valid, [field]: "value" }).success).toBe(false);
  });

  it("names no personal field and no plan content in its own shape", () => {
    const keys = Object.keys(weeklyReviewInputSchema.shape).sort();

    // Counts and a conclusion. Nothing a workout could be described with, and
    // nothing that identifies the person the week belongs to.
    expect(keys).toEqual([
      "category",
      "completedDays",
      "completionPercent",
      "experienceLevel",
      "focus",
      "goal",
      "measuredDurationMinutes",
      "measuredSessionCount",
      "missedDays",
      "previousWeekCompletionPercent",
      "scheduledDays",
      "weekNumber",
    ]);
    expect(keys.join(" ")).not.toMatch(/name|mail|uid|height|weight|birth/i);
    expect(keys.join(" ")).not.toMatch(/exercise|\bsets\b|\breps\b|content/i);
  });

  it("bounds every number to what a four-week plan can produce", () => {
    expect(weeklyReviewInputSchema.safeParse({ ...valid, weekNumber: 5 }).success).toBe(false);
    expect(weeklyReviewInputSchema.safeParse({ ...valid, scheduledDays: 8 }).success).toBe(false);
    expect(weeklyReviewInputSchema.safeParse({ ...valid, completionPercent: 120 }).success).toBe(false);
  });

  it("requires the category and the focus, so a model chooses neither", () => {
    const { category: _noCategory, ...withoutCategory } = valid;
    const { focus: _noFocus, ...withoutFocus } = valid;

    expect(weeklyReviewInputSchema.safeParse(withoutCategory).success).toBe(false);
    expect(weeklyReviewInputSchema.safeParse(withoutFocus).success).toBe(false);
  });

  it("carries no field for effort, fatigue, recovery or sleep", () => {
    const keys = Object.keys(weeklyReviewInputSchema.shape).join(" ");

    /*
      The app persists none of these, so there is nothing truthful to send —
      and a model that cannot see a fatigue field cannot reason from one. The
      count of completed sessions is adherence data and is not a proxy for any
      of them.
    */
    expect(keys).not.toMatch(/rpe|effort|anstrengung|fatigue|müdigkeit|recovery|erholung|sleep|schlaf|readiness|soreness/i);
  });
});

describe("the weekly review never writes to a user's documents", () => {
  const reviewSources = ["src/coaching/weeklyReview.ts", "src/coaching/weeklyReviewData.ts"];

  it.each(reviewSources)("functions/%s performs no document write", (file) => {
    const code = stripComments(readFileSync(join(FUNCTIONS_ROOT, "..", file), "utf-8"));

    /*
      The product promise is that a review changes nothing. The handler's own
      quota and log writes go through injected stores, so the review pipeline
      itself contains no write call at all — and a future edit that adds one is
      caught here rather than in production.
    */
    expect(code).not.toMatch(/\.(set|create|update|delete)\(|writeBatch|bulkWriter/);
  });

  it("reads workout_plans and never addresses it for a write", () => {
    const code = stripComments(
      readFileSync(join(FUNCTIONS_ROOT, "coaching/weeklyReviewData.ts"), "utf-8")
    );

    expect(code).toContain('collection("workout_plans")');
    expect(code).toMatch(/\.get\(\)/);
  });

  it("wires the weekly-review callable to no plan-writing collaborator", () => {
    const code = stripComments(readFileSync(join(FUNCTIONS_ROOT, "index.ts"), "utf-8"));
    const wiring = code.slice(code.indexOf("export const generateWeeklyReview"));

    // No operation store and no plan id: the two things plan generation needs
    // precisely because it persists something.
    expect(wiring).toContain("handleGenerateWeeklyReview(request");
    expect(wiring).not.toMatch(/operations|newPlanId|workout_plans/);
  });
});

describe("no secret ever reaches the client bundle", () => {
  it.each([...backendSources, ...sharedSources].map(rel))("%s reads no VITE_ variable", (file) => {
    const code = readFileSync(join(REPO_ROOT, file), "utf-8");

    // A VITE_ variable is compiled into the browser bundle and is readable by
    // anyone. A provider key must never be one.
    expect(code).not.toMatch(/VITE_[A-Z_]*(OPENAI|GEMINI|ANTHROPIC|MISTRAL|API_KEY|SECRET|TOKEN)/);
  });

  it.each([...backendSources.map(rel)])("%s hardcodes no key-shaped literal", (file) => {
    const code = stripComments(readFileSync(join(REPO_ROOT, file), "utf-8"));

    expect(code).not.toMatch(/sk-[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}/);
  });
});

describe("the status callable is inert", () => {
  const statusSources = ["src/coaching/status.ts", "src/auth.ts", "src/config.ts", "src/index.ts"];

  it.each(statusSources)("functions/%s performs no Firestore write", (file) => {
    const code = stripComments(readFileSync(join(FUNCTIONS_ROOT, "..", file), "utf-8"));

    expect(code).not.toMatch(/\b(set|add|update|delete)\(|writeBatch|firestore\(\)/);
    expect(code).not.toMatch(/firebase-admin/);
  });

  it.each(statusSources.filter((file) => file !== "src/index.ts"))(
    "functions/%s consumes no quota and writes no log",
    (file) => {
      const code = stripComments(readFileSync(join(FUNCTIONS_ROOT, "..", file), "utf-8"));

      expect(code).not.toMatch(/createQuotaService|\.consume\(|\.reserve\(|AiLogWriter|aiLogCollectionPath/);
    }
  );

  it("wires the status callable to nothing but its own handler", () => {
    // index.ts now also hosts the generation callable, which legitimately
    // builds quota and log stores. What must stay true is that the status
    // callable does not touch them.
    const code = stripComments(readFileSync(join(FUNCTIONS_ROOT, "index.ts"), "utf-8"));
    const statusWiring = code.slice(
      code.indexOf("export const coachBackendStatus"),
      code.indexOf("export const generateWorkoutPlan")
    );

    expect(statusWiring).toContain("handleCoachBackendStatus(request)");
    expect(statusWiring).not.toMatch(/quota|Quota|log|Log|provider|Provider|secrets/);
  });
});

describe("no production data is migrated", () => {
  it.each([...backendSources, ...sharedSources].map(rel))("%s runs no migration", (file) => {
    const code = stripComments(readFileSync(join(REPO_ROOT, file), "utf-8"));
    const declaresMigration = /\b(function|const|let)\s+\w*(migrate|backfill)\w*/i.test(code);

    expect(declaresMigration).toBe(false);
  });

  it("deploys only the targets this repository actually owns", () => {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, "firebase.json"), "utf-8"));

    // Firestore rules became version-controlled in PR54, captured from
    // production and tested against the emulator. Storage and hosting are
    // still nobody's here — GitHub Pages hosts the client — and a target that
    // does not exist cannot be deployed by accident.
    expect(config.firestore).toEqual({ rules: "firestore.rules" });
    expect(config.storage).toBeUndefined();
    expect(config.hosting).toBeUndefined();
    expect(config.database).toBeUndefined();
  });
});
