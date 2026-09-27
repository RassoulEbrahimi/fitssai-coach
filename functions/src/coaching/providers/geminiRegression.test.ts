import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SYSTEM_INSTRUCTION, buildPlanPrompt } from "../prompt";
import { planResponseSchema } from "../planResponseSchema";
import { WEEKLY_REVIEW_SYSTEM_INSTRUCTION } from "../weeklyReviewPrompt";
import { weeklyReviewResponseSchema } from "../weeklyReviewResponseSchema";
import type { PlanGenerationInput } from "../planGenerationInput";
import type { WeeklyReviewInput } from "../weeklyReviewInput";
import {
  GEMINI_MODEL_ID,
  GEMINI_PROVIDER_ID,
  GENERATION_CONFIG,
  WEEKLY_REVIEW_GENERATION_CONFIG,
  classifyProviderError,
  createGeminiProvider,
  type GeminiClient,
} from "./gemini";

/*
  NUT-12B moved Training's SDK access behind the shared transport
  (`ai/googleGenai.ts`). Nothing Training does may change with it: the model,
  the API-key path, the prompts, the schemas, the settings, the request shape,
  the retry bound and back-off, and the error vocabulary are pinned here as
  they were before the move.
*/

const FUNCTIONS_ROOT = join(__dirname, "..", "..", "..");
const code = (file: string) =>
  readFileSync(join(FUNCTIONS_ROOT, file), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const INPUT: PlanGenerationInput = {
  goal: "gainMuscle",
  experienceLevel: "intermediate",
  equipment: ["dumbbells"],
  daysPerWeek: 3,
  sessionMinutes: 60,
};

const REVIEW_INPUT: WeeklyReviewInput = {
  weekNumber: 2,
  scheduledDays: 3,
  completedDays: 2,
  missedDays: 1,
  completionPercent: 67,
  category: "maintain",
  focus: "on-track",
};

const scripted = (steps: Array<{ status: number } | { text: string }>) => {
  const requests: Array<Record<string, unknown>> = [];
  let index = 0;
  const client: GeminiClient = {
    models: {
      generateContent: async (request) => {
        requests.push(request);
        const step = steps[Math.min(index, steps.length - 1)];
        index += 1;
        if ("status" in step) throw Object.assign(new Error("raw provider text"), { status: step.status });
        return { text: step.text };
      },
    },
  };
  return { client, requests };
};

describe("Training's provider after the transport extraction", () => {
  it("keeps its model, provider id and settings exactly", () => {
    expect(GEMINI_MODEL_ID).toBe("gemini-3.7-flash");
    expect(GEMINI_PROVIDER_ID).toBe("google-gemini");
    expect(GENERATION_CONFIG).toEqual({ temperature: 0.4, maxOutputTokens: 8192, candidateCount: 1 });
    expect(WEEKLY_REVIEW_GENERATION_CONFIG).toEqual({ temperature: 0.4, maxOutputTokens: 512, candidateCount: 1 });
  });

  it("sends exactly the request it sent before: model, prompt, instruction, settings and responseSchema — nothing of Nutrition's", async () => {
    const { client, requests } = scripted([{ text: "{}" }]);
    await createGeminiProvider({ apiKey: "t", client }).generatePlan(INPUT);

    expect(requests[0]).toEqual({
      model: "gemini-3.7-flash",
      contents: buildPlanPrompt(INPUT),
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        candidateCount: 1,
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: planResponseSchema,
      },
    });
  });

  it("sends the weekly review exactly as before", async () => {
    const { client, requests } = scripted([{ text: "{}" }]);
    await createGeminiProvider({ apiKey: "t", client }).summariseWeeklyReviewWithUsage(REVIEW_INPUT);
    const config = requests[0].config as Record<string, unknown>;
    expect(Object.keys(config).sort()).toEqual(["candidateCount", "maxOutputTokens", "responseMimeType", "responseSchema", "systemInstruction", "temperature"]);
    expect(config.systemInstruction).toBe(WEEKLY_REVIEW_SYSTEM_INSTRUCTION);
    expect(config.responseSchema).toBe(weeklyReviewResponseSchema);
  });

  it("retries 429/5xx twice in total by default, pausing 250 ms, and maps the result to its own codes", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);

    const limited = scripted([{ status: 429 }]);
    await expect(createGeminiProvider({ apiKey: "t", client: limited.client, sleep }).generatePlan(INPUT)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      message: "Provider rate limited the request.",
    });
    expect(limited.requests).toHaveLength(2);
    expect(sleeps).toEqual([250]);

    const down = scripted([{ status: 503 }]);
    await expect(createGeminiProvider({ apiKey: "t", client: down.client, sleep }).generatePlan(INPUT)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: "Provider returned 503.",
    });
    expect(down.requests).toHaveLength(2);

    const refused = scripted([{ status: 400 }]);
    await expect(createGeminiProvider({ apiKey: "t", client: refused.client, sleep }).generatePlan(INPUT)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: "Provider request failed.",
    });
    expect(refused.requests).toHaveLength(1);
  });

  it("honours an explicit attempt bound as before", async () => {
    const { client, requests } = scripted([{ status: 503 }]);
    await expect(createGeminiProvider({ apiKey: "t", client, maxTransportAttempts: 3, sleep: async () => undefined }).generatePlan(INPUT)).rejects.toThrow();
    expect(requests).toHaveLength(3);
  });

  it("classifies failures as before, dropping the provider's message", () => {
    expect(classifyProviderError({ status: 429, message: "raw" })).toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    expect(classifyProviderError({ code: 500 })).toMatchObject({ code: "PROVIDER_UNAVAILABLE", message: "Provider returned 500." });
    expect(classifyProviderError(new Error("raw"))).toMatchObject({ code: "PROVIDER_UNAVAILABLE", message: "Provider request failed." });
  });

  it("still builds a Gemini Developer API client from its API key, and never Vertex", () => {
    const gemini = code("src/coaching/providers/gemini.ts");
    expect(gemini).toMatch(/createGoogleGenAiClient\(\{ kind: "developerApi", apiKey: options\.apiKey \}\)/);
    expect(gemini).not.toMatch(/vertex|project|location|nutrition/i);
  });

  it("is still wired to the GEMINI_API_KEY secret, for exactly its two callables", () => {
    const index = code("src/index.ts");
    expect(index).toMatch(/export const GEMINI_API_KEY = defineSecret\("GEMINI_API_KEY"\);/);
    expect([...index.matchAll(/createGeminiProvider\(\{ apiKey: GEMINI_API_KEY\.value\(\) \}\)/g)]).toHaveLength(2);
    const users = [...index.matchAll(/export const (\w+) = onCall\(\s*\{[^}]*secrets: \[GEMINI_API_KEY\]/g)].map((match) => match[1]);
    expect(users.sort()).toEqual(["generateWeeklyReview", "generateWorkoutPlan"]);
  });

  it("shares no product code with Nutrition: no Nutrition import, and Nutrition imports nothing of Coaching", () => {
    expect(code("src/coaching/providers/gemini.ts")).not.toMatch(/nutrition/i);
    for (const file of ["src/nutrition/providers/vertexGemini.ts", "src/nutrition/providers/prompt.ts", "src/nutrition/providers/responseContract.ts", "src/nutrition/providers/productionRegistry.ts", "src/ai/googleGenai.ts"]) {
      expect(code(file), file).not.toMatch(/coaching\/|from\s+["'][^"']*coaching/);
    }
    expect(code("src/ai/googleGenai.ts")).not.toMatch(/nutrition|coaching|\bprompt\b|systemInstruction|MODEL_ID|gemini-|responseSchema/i);
  });
});
