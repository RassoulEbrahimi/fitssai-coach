import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DAYS_PER_WEEK,
  PLAN_TOTAL_WEEKS,
  PLAN_WEEK_KEYS,
  validateWorkoutPlanContent,
} from "@shared/workoutPlan";
import { PLAN_TOTAL_WEEKS as CLIENT_PLAN_TOTAL_WEEKS } from "@/lib/planLifecycle";
import { FUNCTIONS_REGION } from "./region";

/*
  The client half of the backend boundary. Nothing here calls a function — the
  point is that the seam exists, matches the server, and cannot leak a secret
  into a browser bundle.
*/

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf-8");

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel);
    return /\.tsx?$/.test(entry) ? [rel] : [];
  });

describe("client and server agree", () => {
  it("targets the same region the functions deploy to", () => {
    const serverConfig = read("functions/src/config.ts");

    expect(serverConfig).toContain(`FUNCTIONS_REGION = "${FUNCTIONS_REGION}"`);
  });

  it("keeps FitssAI's backend in Europe", () => {
    expect(FUNCTIONS_REGION.startsWith("europe-")).toBe(true);
  });

  it("shares one plan contract rather than two copies", () => {
    expect(PLAN_TOTAL_WEEKS).toBe(CLIENT_PLAN_TOTAL_WEEKS);
    expect(PLAN_WEEK_KEYS).toHaveLength(PLAN_TOTAL_WEEKS);
    expect(DAYS_PER_WEEK).toBe(7);
  });

  it("has exactly one definition of the plan schema", () => {
    const duplicates = walk("src").filter((file) => {
      const code = read(file);
      return /workoutPlanContentSchema\s*=/.test(code) || /planWeekSchema\s*=/.test(code);
    });

    // The schema is defined in shared/ and imported. A second definition here
    // is the thing that drifts, and the drifted copy is the one that lets a
    // malformed plan through.
    expect(duplicates).toEqual([]);
  });
});

describe("the shared schema accepts what the client already stores", () => {
  const week = () =>
    ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"].map(
      (day, index) => ({
        day,
        exercises:
          index % 2 === 0
            ? [{ name: "Bankdrücken", sets: 4, reps: "8-10", weight: "60 kg", completed: false }]
            : [],
      })
    );

  it("parses a plan in the shape the app writes", () => {
    const content = {
      "Week 1": week(),
      "Week 2": week(),
      "Week 3": week(),
      "Week 4": week(),
    };

    expect(validateWorkoutPlanContent(content).ok).toBe(true);
  });

  it("still rejects a fifth week from the client side too", () => {
    const content = {
      "Week 1": week(),
      "Week 2": week(),
      "Week 3": week(),
      "Week 4": week(),
      "Week 5": week(),
    };

    expect(validateWorkoutPlanContent(content).ok).toBe(false);
  });
});

describe("the client seam stays a seam", () => {
  it("is not called automatically anywhere in the app", () => {
    const callers = walk("src").filter(
      (file) => !file.startsWith("src/lib/backend") && /fetchCoachBackendStatus/.test(read(file))
    );

    // A status probe on render would be a paid network request per user per
    // view, to learn something that does not change.
    expect(callers).toEqual([]);
  });

  it("adds no user-facing AI affordance", () => {
    const source = read("src/lib/backend/index.ts");

    expect(source).not.toMatch(/generatePlan|Neue Pläne|KI-Vorschlag/);
  });

  it("carries no secret and no provider", () => {
    const source = stripComments(read("src/lib/backend/index.ts"));

    expect(source).not.toMatch(/apiKey|api_key|secret|token|openai|anthropic|gemini|mistral/i);
  });
});

describe("the backend gate is wired up", () => {
  const pkg = JSON.parse(read("package.json"));
  const workflow = read(".github/workflows/deploy.yml");

  it("makes the canonical typecheck cover the functions workspace", () => {
    // Otherwise `npm run typecheck` stays green while the backend is broken.
    expect(pkg.scripts.typecheck).toContain("typecheck:functions");
    expect(pkg.scripts["typecheck:functions"]).toContain("functions");
  });

  it("validates the backend in CI", () => {
    for (const step of ["Functions typecheck", "Functions tests", "Functions build"]) {
      expect(workflow).toContain(step);
    }
  });

  it("holds the Pages deployment until the backend and the rules pass", () => {
    expect(workflow).toMatch(/needs:\s*\[build, backend, rules\]/);
  });

  it("runs the Firestore rules against the emulator in CI", () => {
    // The only check that can prove an access-control claim. If it stops
    // running, a rules regression ships silently.
    expect(workflow).toContain("Firestore rules tests");
    expect(workflow).toContain("npm run test:rules");
    expect(pkg.scripts["test:rules"]).toContain("emulators:exec");
    expect(pkg.scripts["test:rules"]).toContain("--only firestore");
  });

  it("never points the emulator at a real project", () => {
    // A "demo-" id is Firebase's guarantee that no credentials are used and no
    // real project can be reached.
    expect(pkg.scripts["test:rules"]).toMatch(/--project demo-/);
  });

  it("deploys no Firebase resource from CI", () => {
    // Deploying functions would need a long-lived credential in the repo.
    expect(workflow).not.toMatch(/firebase deploy|FIREBASE_TOKEN|service_account|GOOGLE_APPLICATION_CREDENTIALS/);
  });
});

describe("no provider secret can reach the browser", () => {
  it("declares no provider SDK in the client dependency tree", () => {
    const pkg = JSON.parse(read("package.json"));
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");

    expect(declared).not.toMatch(/openai|anthropic|generative-ai|mistral|cohere|ollama/i);
  });

  it("reads no VITE_ provider variable anywhere in the client", () => {
    // Tests are excluded: a guard that scans its own regex finds itself.
    const offenders = walk("src")
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) => /VITE_[A-Z_]*(OPENAI|GEMINI|ANTHROPIC|MISTRAL|MODEL|LLM)/.test(read(file)));

    // Anything prefixed VITE_ is compiled into the bundle and readable by
    // every visitor. A model key must never be one.
    expect(offenders).toEqual([]);
  });

  it("commits no service-account key and ignores the usual filenames", () => {
    const gitignore = read(".gitignore");

    for (const pattern of ["service_account.json", "serviceAccountKey.json", "*-firebase-adminsdk-*.json"]) {
      expect(gitignore).toContain(pattern);
    }
  });
});

describe("the weekly review is advice, and the client keeps it that way", () => {
  const reviewSources = [
    "src/lib/backend/weeklyReview.ts",
    "src/components/dashboard/CoachingRecommendation.tsx",
    "src/components/dashboard/WeeklyReview.tsx",
    "src/lib/coaching/reviewMetrics.ts",
  ];

  it.each(reviewSources)("%s writes nothing to Firestore", (file) => {
    const code = stripComments(read(file));

    /*
      The product promise is that a review changes nothing. No path from the
      weekly review reaches a write — not to a plan, not to a log, not to
      anything — and a future edit that adds one fails here rather than in
      somebody's training week.
    */
    expect(code).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|writeBatch|updatePlanContent/);
    expect(code).not.toMatch(/generatePlan|useWorkoutPlan|newRequestId/);
  });

  it("is requested from exactly one place, on an explicit action", () => {
    const callers = walk("src").filter(
      (file) => !file.startsWith("src/lib/backend") && /fetchWeeklyReview/.test(read(file))
    );

    // A review fetched on render would be a paid model call per user per view,
    // to reword something already on the screen.
    expect(callers.sort()).toEqual([
      "src/components/dashboard/CoachingRecommendation.test.tsx",
      "src/components/dashboard/CoachingRecommendation.tsx",
    ]);
  });

  it("sends no request body at all", () => {
    const code = stripComments(read("src/lib/backend/weeklyReview.ts"));

    // Every input is read server-side under the caller's own uid, so there is
    // nothing here for a browser to shape the answer with.
    expect(code).toMatch(/httpsCallable<undefined,/);
    expect(code).toMatch(/await callable\(\)/);
  });

  it("carries no secret and no provider", () => {
    const code = stripComments(read("src/lib/backend/weeklyReview.ts"));

    expect(code).not.toMatch(/apiKey|api_key|secret|token|openai|anthropic|gemini|mistral/i);
  });

  it("has exactly one definition of the recommendation rules", () => {
    // The rules live in shared/ and are the same code the backend runs. A
    // second copy here is the one that drifts, and the drifted copy is the one
    // that puts a different conclusion on screen than the model was told.
    const duplicates = walk("src").filter((file) => {
      const code = read(file);
      return /recommendCategory\s*=/.test(code) || /describeRecommendation\s*=/.test(code);
    });

    expect(duplicates).toEqual([]);
  });
});
