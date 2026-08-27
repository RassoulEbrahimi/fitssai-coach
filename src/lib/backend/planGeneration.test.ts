import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AI_ERROR_CODES,
  PlanGenerationError,
  REQUIRED_PROFILE_FIELDS,
  newRequestId,
  toPlanGenerationError,
  type AiErrorCode,
} from "./planGeneration";
import { PROFILE_FIELD_LABELS, planGenerationErrorMessage } from "./planGenerationCopy";

/*
  The client half of plan generation. Nothing here calls a function — what is
  pinned is that the browser sends nothing but a request id, that every backend
  failure has German copy written in advance by a person, and that no provider
  error, key or model name can reach a user.
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

/**
 * Source files, excluding tests.
 *
 * A guard that scans its own regex finds itself: this file necessarily writes
 * out the strings it forbids, and so do the tests that assert their absence.
 */
const appSources = () => walk("src").filter((file) => !/\.test\.tsx?$/.test(file));

describe("German copy exists for every failure", () => {
  it.each(AI_ERROR_CODES)("%s has a title and a description", (code) => {
    const message = planGenerationErrorMessage(code);

    expect(message.title.length).toBeGreaterThan(0);
    expect(message.description.length).toBeGreaterThan(0);
    expect(`${message.title} ${message.description}`).not.toMatch(/undefined|NaN|\[object/);
  });

  it("names the missing profile answers in the user's own words", () => {
    const message = planGenerationErrorMessage("PROFILE_INCOMPLETE", {
      missingFields: ["fitnessGoal", "daysPerWeek"],
    });

    expect(message.title).toBe("Vervollständige zuerst deine Trainingseinstellungen.");
    expect(message.description).toContain("Trainingsziel");
    expect(message.description).toContain("Trainingstage pro Woche");
  });

  it("labels every required field", () => {
    for (const field of REQUIRED_PROFILE_FIELDS) {
      expect(PROFILE_FIELD_LABELS[field]).toBeTruthy();
      // German labels, not the stored key names.
      expect(PROFILE_FIELD_LABELS[field]).not.toBe(field);
    }
  });

  it("states the real monthly limit", () => {
    expect(planGenerationErrorMessage("QUOTA_EXCEEDED", { limit: 3 }).description).toContain("3");
  });

  it("never exposes a provider, a model or an internal term", () => {
    const everything = AI_ERROR_CODES.map((code) =>
      Object.values(planGenerationErrorMessage(code, { missingFields: [...REQUIRED_PROFILE_FIELDS] })).join(" ")
    ).join(" ");

    expect(everything).not.toMatch(/gemini|google|firestore|firebase|token|api|schema|zod|http|5\d\d/i);
  });

  it("makes no medical or shaming claim", () => {
    const everything = AI_ERROR_CODES.map((code) =>
      Object.values(planGenerationErrorMessage(code)).join(" ")
    ).join(" ");

    expect(everything).not.toMatch(/verletz|schmerz|übertrain|faul|versagt/i);
  });
});

describe("mapping a thrown value onto a code", () => {
  it("reads the backend's code out of the callable error", () => {
    const error = toPlanGenerationError({
      code: "functions/failed-precondition",
      message: "QUOTA_EXCEEDED",
      details: { limit: 3 },
    });

    expect(error.code).toBe("QUOTA_EXCEEDED");
    expect(error.limit).toBe(3);
  });

  it("carries the missing fields through", () => {
    const error = toPlanGenerationError({
      message: "PROFILE_INCOMPLETE",
      details: { missingFields: ["equipment", "not-a-real-field"] },
    });

    // Unknown field names are dropped rather than rendered.
    expect(error.missingFields).toEqual(["equipment"]);
  });

  it("turns anything unrecognised into INTERNAL rather than showing it", () => {
    const leaky = new Error(
      "Request to https://europe-west3-fitssai-coach.cloudfunctions.net failed: quota project 12345"
    );

    const error = toPlanGenerationError(leaky);

    expect(error.code).toBe("INTERNAL");
    expect(planGenerationErrorMessage(error.code).description).not.toContain("12345");
    expect(planGenerationErrorMessage(error.code).description).not.toContain("cloudfunctions");
  });

  it("recognises an unauthenticated callable rejection", () => {
    expect(toPlanGenerationError({ code: "functions/unauthenticated" }).code).toBe(
      "UNAUTHENTICATED"
    );
  });

  it("is a real error, so it survives a throw", () => {
    const error = new PlanGenerationError("QUOTA_EXCEEDED");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PlanGenerationError");
  });
});

describe("what the browser sends", () => {
  it("is a fresh v4 request id and nothing else", () => {
    const source = stripComments(read("src/lib/backend/planGeneration.ts"));

    // The payload type and the invocation, not the whole file: the module also
    // names the profile fields, because it renders which ones are missing.
    expect(source).toMatch(/httpsCallable<\{ requestId: string \}, PlanGenerationResult>/);
    expect(source).toMatch(/callable\(\{ requestId \}\)/);

    // If the browser sent goal or equipment, it would be dictating the prompt.
    const invocation = source.slice(source.indexOf("const generateWorkoutPlan"));
    expect(invocation).not.toMatch(/goal|equipment|daysPerWeek|sessionMinutes|experienceLevel/);
  });

  it("generates a distinct id per attempt", () => {
    expect(newRequestId()).not.toBe(newRequestId());
    expect(newRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("receives a plan id, never a plan the browser could have written", () => {
    const source = stripComments(read("src/lib/backend/planGeneration.ts"));

    expect(source).toContain("planId: string");
    expect(source).not.toMatch(/content\s*:/);
  });
});

describe("no provider secret can reach the browser", () => {
  it("declares no provider SDK in the client dependency tree", () => {
    const pkg = JSON.parse(read("package.json"));
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");

    // The SDK is a dependency of the functions workspace only.
    expect(declared).not.toMatch(/@google\/genai|generative-ai|openai|anthropic|mistral|cohere/i);
  });

  it("names no provider secret anywhere in the client", () => {
    const offenders = appSources().filter((file) =>
      /GEMINI_API_KEY|VITE_GEMINI|VITE_[A-Z_]*(OPENAI|ANTHROPIC|MISTRAL|LLM|MODEL)/.test(
        stripComments(read(file))
      )
    );

    // Anything prefixed VITE_ is compiled into the bundle and readable by
    // every visitor; a model key must never be one.
    expect(offenders).toEqual([]);
  });

  it("imports no provider SDK anywhere in the client", () => {
    const offenders = appSources().filter((file) =>
      /from\s+["']@google\/genai["']/.test(read(file))
    );

    expect(offenders).toEqual([]);
  });

  it("keeps the model id out of the client entirely", () => {
    const offenders = appSources().filter((file) =>
      /gemini-[\d.]+-flash/.test(stripComments(read(file)))
    );

    // The client has no business knowing which model ran, and a model name in
    // the bundle is a model name in an error message.
    expect(offenders).toEqual([]);
  });
});

describe("the surfaces that stay unavailable", () => {
  it("does not generate nutrition plans", () => {
    const nutrition = read("src/views/NutritionView.tsx");

    expect(nutrition).not.toMatch(/generateWorkoutPlan|generateNutrition/);
  });

  it("leaves the exercise-suggestion tab unavailable rather than miswiring it", () => {
    // AIPromptAssist offers exercises for one training day. A four-week plan
    // generator is not that, and wiring one in would be a lie about the button.
    const assist = read("src/components/workout/AIPromptAssist.tsx");

    expect(assist).not.toMatch(/generateWorkoutPlan/);
    expect(assist).toContain("noch nicht verfügbar");
  });

  it("shows no AI usage statistics rather than showing zeros", () => {
    const card = read("src/components/AIAnalyticsCard.tsx");

    expect(card).toContain("noch nicht verfügbar");
    // The authoritative log is server-only; the card must not read anything.
    expect(stripComments(card)).not.toMatch(/ai_logs|useAIAnalytics|firestore|getDocs/i);
  });
});

describe("the old stub is gone", () => {
  it("no longer throws AI_UNAVAILABLE from the plan hook", () => {
    const hook = read("src/hooks/queries/useWorkoutPlan.ts");

    expect(hook).not.toContain("AI_UNAVAILABLE");
    expect(hook).toContain("generateWorkoutPlan");
  });

  it("has no simulated delay anywhere in the generation path", () => {
    for (const file of ["src/hooks/queries/useWorkoutPlan.ts", "src/lib/backend/planGeneration.ts"]) {
      const code = stripComments(read(file));

      // PR46 removed a 1.5s fake "thinking" timer. It does not come back.
      expect(code).not.toMatch(/setTimeout|sleep\(|delay\(/);
    }
  });

  it("reports pending from the real mutation, not a local flag", () => {
    const hook = read("src/hooks/queries/useWorkoutPlan.ts");

    expect(hook).toContain("isGenerating: generateMutation.isPending");
  });
});

describe("code parity with the backend", () => {
  it("knows exactly the codes the backend can send", () => {
    const backend = read("functions/src/errors.ts");
    const codes = [...backend.matchAll(/^\s*"([A-Z_]+)",$/gm)].map((match) => match[1]);
    const backendCodes = codes.filter((code) =>
      (AI_ERROR_CODES as readonly string[]).includes(code)
    );

    // Two lists that must not drift: an unmapped code reaches a user as
    // whatever the default happens to be.
    expect(new Set(backendCodes)).toEqual(new Set(AI_ERROR_CODES as readonly AiErrorCode[]));
  });

  it("knows exactly the profile fields the backend can report missing", () => {
    const backend = read("functions/src/errors.ts");

    for (const field of REQUIRED_PROFILE_FIELDS) {
      expect(backend).toContain(`"${field}"`);
    }
  });
});
