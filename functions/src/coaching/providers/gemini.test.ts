import { describe, it, expect } from "vitest";
import {
  GEMINI_MODEL_ID,
  GEMINI_PROVIDER_ID,
  GENERATION_CONFIG,
  classifyProviderError,
  createGeminiProvider,
  extractUsage,
  type GeminiClient,
} from "./gemini";
import { planResponseSchema } from "../planResponseSchema";
import { weeklyReviewResponseSchema } from "../weeklyReviewResponseSchema";
import type { PlanGenerationInput } from "../planGenerationInput";
import type { WeeklyReviewInput } from "../weeklyReviewInput";

/*
  The provider is exercised against a fake client. A real call would cost money
  and would make the suite depend on a third party being up — neither belongs
  in CI, and neither would test anything this does not.
*/

const INPUT: PlanGenerationInput = {
  goal: "gainMuscle",
  experienceLevel: "intermediate",
  equipment: ["dumbbells"],
  daysPerWeek: 3,
  sessionMinutes: 60,
};

const respondWith = (body: unknown, usage?: Record<string, number>) => {
  const calls: Array<Record<string, unknown>> = [];
  const client: GeminiClient = {
    models: {
      generateContent: async (request) => {
        calls.push(request);
        return {
          text: typeof body === "string" ? body : JSON.stringify(body),
          ...(usage ? { usageMetadata: usage } : {}),
        };
      },
    },
  };
  return { client, calls };
};

describe("the model identity", () => {
  it("is the verified production model", () => {
    expect(GEMINI_MODEL_ID).toBe("gemini-3.7-flash");
  });

  it("is not the deprecated 2.5 generation", () => {
    // gemini-2.5-flash carried an announced shutdown when this was written.
    expect(GEMINI_MODEL_ID).not.toMatch(/^gemini-2\./);
  });

  it("is sent to the provider verbatim", async () => {
    const { client, calls } = respondWith({});
    await createGeminiProvider({ apiKey: "test", client }).generatePlan(INPUT);

    expect(calls[0].model).toBe(GEMINI_MODEL_ID);
  });
});

describe("what the provider sends", () => {
  it("asks for structured output against the shared plan shape", async () => {
    const { client, calls } = respondWith({});
    await createGeminiProvider({ apiKey: "test", client }).generatePlan(INPUT);

    const config = calls[0].config as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema).toBe(planResponseSchema);
  });

  it("uses the cost-controlled generation config", async () => {
    const { client, calls } = respondWith({});
    await createGeminiProvider({ apiKey: "test", client }).generatePlan(INPUT);

    const config = calls[0].config as Record<string, unknown>;
    expect(config.candidateCount).toBe(1);
    expect(config.temperature).toBe(GENERATION_CONFIG.temperature);
    expect(config.maxOutputTokens).toBe(GENERATION_CONFIG.maxOutputTokens);
  });

  it("sends only the five minimised inputs and nothing personal", async () => {
    const { client, calls } = respondWith({});
    await createGeminiProvider({ apiKey: "test", client }).generatePlan(INPUT);

    const sent = JSON.stringify(calls[0]);
    for (const forbidden of ["uid", "email", "@", "fullName", "Alice", "height", "weight"]) {
      expect(sent).not.toContain(forbidden);
    }
    // What it does contain is the five inputs, in German.
    expect(sent).toContain("Kurzhanteln");
    expect(sent).toContain("3");
  });

  it("never sends the API key in the request body", async () => {
    const { client, calls } = respondWith({});
    await createGeminiProvider({ apiKey: "super-secret-key", client }).generatePlan(INPUT);

    expect(JSON.stringify(calls[0])).not.toContain("super-secret-key");
  });
});

describe("what the provider returns", () => {
  it("returns parsed output as unknown, without validating it", async () => {
    const { client } = respondWith({ nonsense: true });
    const result = await createGeminiProvider({ apiKey: "t", client }).generatePlan(INPUT);

    // Garbage comes straight back. Validation is the caller's job.
    expect(result).toEqual({ nonsense: true });
  });

  it("returns undefined rather than throwing when the model emits non-JSON", async () => {
    const { client } = respondWith("Guten Tag! Hier ist dein Plan.");
    const result = await createGeminiProvider({ apiKey: "t", client }).generatePlan(INPUT);

    expect(result).toBeUndefined();
  });

  it("captures token usage when the provider reports it", async () => {
    const { client } = respondWith(
      {},
      { promptTokenCount: 120, candidatesTokenCount: 4000, totalTokenCount: 4120 }
    );
    const result = await createGeminiProvider({ apiKey: "t", client }).generatePlanWithUsage(INPUT);

    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 4000, totalTokens: 4120 });
  });

  it("leaves usage absent when the provider reports none", async () => {
    const { client } = respondWith({});
    const result = await createGeminiProvider({ apiKey: "t", client }).generatePlanWithUsage(INPUT);

    // Absent, not zero: "not reported" and "zero tokens" are different facts.
    expect(result.usage).toEqual({});
    expect(extractUsage({})).toEqual({});
  });
});

describe("transport failures", () => {
  const failing = (error: unknown, succeedOnAttempt?: number) => {
    let attempts = 0;
    const client: GeminiClient = {
      models: {
        generateContent: async () => {
          attempts += 1;
          if (succeedOnAttempt && attempts >= succeedOnAttempt) return { text: "{}" };
          throw error;
        },
      },
    };
    return { client, attempts: () => attempts };
  };

  it("maps 429 to PROVIDER_RATE_LIMITED", async () => {
    const { client } = failing({ status: 429 });
    const provider = createGeminiProvider({ apiKey: "t", client, sleep: async () => {} });

    await expect(provider.generatePlan(INPUT)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });
  });

  it("maps 5xx to PROVIDER_UNAVAILABLE", async () => {
    const { client } = failing({ status: 503 });
    const provider = createGeminiProvider({ apiKey: "t", client, sleep: async () => {} });

    await expect(provider.generatePlan(INPUT)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("retries a transient failure, bounded", async () => {
    const { client, attempts } = failing({ status: 503 }, 2);
    const provider = createGeminiProvider({ apiKey: "t", client, sleep: async () => {} });

    await provider.generatePlan(INPUT);

    expect(attempts()).toBe(2);
  });

  it("does not retry a non-retryable failure", async () => {
    const { client, attempts } = failing({ status: 400 });
    const provider = createGeminiProvider({ apiKey: "t", client, sleep: async () => {} });

    await expect(provider.generatePlan(INPUT)).rejects.toThrow();
    expect(attempts()).toBe(1);
  });

  it("never lets the provider's own message reach the caller", async () => {
    const raw = "quota project 12345 exceeded at https://internal.googleapis.example/v1";
    const mapped = classifyProviderError({ status: 429, message: raw });

    expect(mapped.message).not.toContain("12345");
    expect(mapped.message).not.toContain("googleapis");
    expect(mapped.code).toBe("PROVIDER_RATE_LIMITED");
  });
});

describe("weekly summaries", () => {
  const REVIEW_INPUT: WeeklyReviewInput = {
    weekNumber: 2,
    scheduledDays: 3,
    completedDays: 2,
    missedDays: 1,
    completionPercent: 67,
    category: "maintain",
  };

  const answer = {
    category: "maintain",
    headline: "Solide Woche",
    message: "Zwei von drei Einheiten sind abgeschlossen. Bleib beim aktuellen Umfang.",
    reason: "Zwei der drei geplanten Trainingstage sind erledigt.",
  };

  it("asks for the weekly shape, not the plan shape", async () => {
    const { client, calls } = respondWith(answer);
    const provider = createGeminiProvider({ apiKey: "t", client });

    await provider.summariseWeeklyReviewWithUsage(REVIEW_INPUT);
    const config = calls[0].config as Record<string, unknown>;

    // The plan schema would let a model hand back exercises from a surface
    // that must never produce plan content.
    expect(config.responseSchema).toBe(weeklyReviewResponseSchema);
    expect(config.responseSchema).not.toBe(planResponseSchema);
    expect(config.responseMimeType).toBe("application/json");
  });

  it("returns the model's answer unvalidated, for the caller to check", async () => {
    const { client } = respondWith({ category: "increase", headline: "Nope" });
    const provider = createGeminiProvider({ apiKey: "t", client });

    // A provider that filtered here would have become the validation boundary.
    const result = await provider.summariseWeeklyReviewWithUsage(REVIEW_INPUT);

    expect(result.output).toEqual({ category: "increase", headline: "Nope" });
  });

  it("sends the computed numbers and no personal data", async () => {
    const { client, calls } = respondWith(answer);
    const provider = createGeminiProvider({ apiKey: "t", client });

    await provider.summariseWeeklyReviewWithUsage({ ...REVIEW_INPUT, goal: "gainMuscle" });
    const prompt = String(calls[0].contents);

    expect(prompt).toContain("67 %");
    expect(prompt).toContain("maintain");
    expect(prompt).not.toMatch(/@|uid|E-Mail|Gewicht|Grösse|Größe|Geburt/i);
  });

  it("caps its output far below the plan budget", async () => {
    const { client, calls } = respondWith(answer);
    const provider = createGeminiProvider({ apiKey: "t", client });

    await provider.summariseWeeklyReviewWithUsage(REVIEW_INPUT);
    const config = calls[0].config as Record<string, unknown>;

    expect(config.maxOutputTokens).toBeLessThan(GENERATION_CONFIG.maxOutputTokens);
  });

  it("identifies itself in logs without naming a key", () => {
    expect(GEMINI_PROVIDER_ID).toBe("google-gemini");
  });
});
