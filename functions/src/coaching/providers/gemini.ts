import { GoogleGenAI } from "@google/genai";
import { AiError } from "../../errors";
import { SYSTEM_INSTRUCTION, buildPlanPrompt } from "../prompt";
import { planResponseSchema, type ProviderSchema } from "../planResponseSchema";
import {
  WEEKLY_REVIEW_SYSTEM_INSTRUCTION,
  buildWeeklyReviewPrompt,
} from "../weeklyReviewPrompt";
import { weeklyReviewResponseSchema } from "../weeklyReviewResponseSchema";
import type { PlanGenerationInput } from "../planGenerationInput";
import type { WeeklyReviewInput } from "../weeklyReviewInput";
import type { CoachProvider, WeeklyReviewFacts } from "../provider";

/**
 * The Gemini implementation of the provider seam.
 *
 * It calls the model and hands back whatever came out, typed `unknown`. It
 * does not touch Firestore, does not know about quota, does not log, and does
 * not decide whether the result is a plan — all of that belongs to the caller,
 * which is what keeps this file swappable and the validation boundary in one
 * place.
 */

/**
 * The production model.
 *
 * Verified against Google's official model and pricing documentation on
 * 2026-08-27. Kept as a single exported constant so a migration is one line
 * with a test to prove it landed: Google retires Flash generations on roughly
 * annual cycles, and the previous choice — gemini-2.5-flash — was already
 * deprecated with an announced shutdown when this was written.
 *
 * Paid promotional pricing at time of writing: $0.75 per million input tokens
 * and $3.75 per million output tokens through 2026-12-31, rising afterwards.
 * That is what the three-generations-per-month quota is sized against.
 */
export const GEMINI_MODEL_ID = "gemini-3.7-flash";

/** Identifies the implementation in `_ai_logs`. Never a key or an endpoint. */
export const GEMINI_PROVIDER_ID = "google-gemini";

/**
 * Cost controls, deliberately conservative.
 *
 * A four-week plan is a bounded document, so the output cap is generous enough
 * for seven days times four weeks of exercises and no more. Temperature is low
 * because this is structured generation, not writing — variety in the JSON
 * shape is only a way to fail validation. One candidate: alternatives would be
 * billed and discarded.
 */
export const GENERATION_CONFIG = Object.freeze({
  temperature: 0.4,
  maxOutputTokens: 8192,
  candidateCount: 1,
});

/**
 * The weekly recommendation is three short strings, so it gets its own cap.
 *
 * A tenth of the plan's output budget is still several times what the schema
 * allows, and it bounds what a runaway response can cost. Temperature stays
 * low: this is a rewording of a fixed conclusion, and variety here only means
 * more ways to fail the category check.
 */
export const WEEKLY_REVIEW_GENERATION_CONFIG = Object.freeze({
  temperature: 0.4,
  maxOutputTokens: 512,
  candidateCount: 1,
});

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProviderResult {
  /** Untrusted. The caller validates before anything is persisted. */
  output: unknown;
  /** Only what the provider actually reported. Never estimated. */
  usage: TokenUsage;
}

/** The slice of the SDK this provider uses, so tests need no network. */
export interface GeminiClient {
  models: {
    generateContent(request: Record<string, unknown>): Promise<unknown>;
  };
}

export interface GeminiProviderOptions {
  apiKey: string;
  /** Injected in tests. Production builds the real SDK client. */
  client?: GeminiClient;
  /** Transport retries for 429/5xx only. Bounded, and separate from repair. */
  maxTransportAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TRANSPORT_ATTEMPTS = 2;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Pull only numeric usage fields. Absent stays absent — nothing is inferred. */
export const extractUsage = (response: unknown): TokenUsage => {
  const metadata = (response as { usageMetadata?: Record<string, unknown> } | null)
    ?.usageMetadata;
  if (!metadata) return {};

  return {
    inputTokens: readNumber(metadata.promptTokenCount),
    outputTokens: readNumber(metadata.candidatesTokenCount),
    totalTokens: readNumber(metadata.totalTokenCount),
  };
};

/** The model's text, wherever this SDK version puts it. */
const extractText = (response: unknown): string | undefined => {
  const direct = (response as { text?: unknown }).text;
  if (typeof direct === "string") return direct;

  const parts = (
    response as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
    }
  ).candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
  return text === "" ? undefined : text;
};

const statusOf = (error: unknown): number | undefined => {
  const candidate = error as { status?: unknown; code?: unknown };
  return readNumber(candidate.status) ?? readNumber(candidate.code);
};

/**
 * Map a provider failure onto our own vocabulary.
 *
 * The original message is dropped on purpose: it can carry endpoints, project
 * quota details and request ids, none of which belong in a browser.
 */
export const classifyProviderError = (error: unknown): AiError => {
  const status = statusOf(error);
  if (status === 429) {
    return new AiError("PROVIDER_RATE_LIMITED", "Provider rate limited the request.");
  }
  if (status !== undefined && status >= 500) {
    return new AiError("PROVIDER_UNAVAILABLE", `Provider returned ${status}.`);
  }
  return new AiError("PROVIDER_UNAVAILABLE", "Provider request failed.");
};

const isRetryable = (error: unknown): boolean => {
  const status = statusOf(error);
  return status === 429 || (status !== undefined && status >= 500);
};

export interface GeminiProvider extends CoachProvider {
  /** Plan generation with the usage the provider reported alongside it. */
  generatePlanWithUsage(
    input: PlanGenerationInput,
    repairInstruction?: string
  ): Promise<ProviderResult>;

  /** Weekly wording with the usage the provider reported alongside it. */
  summariseWeeklyReviewWithUsage(input: WeeklyReviewInput): Promise<ProviderResult>;
}

/** The per-call shape of a structured-output request. */
interface CallShape {
  systemInstruction: string;
  responseSchema: ProviderSchema;
  generationConfig: Readonly<Record<string, number>>;
}

const PLAN_CALL: CallShape = {
  systemInstruction: SYSTEM_INSTRUCTION,
  responseSchema: planResponseSchema,
  generationConfig: GENERATION_CONFIG,
};

const WEEKLY_REVIEW_CALL: CallShape = {
  systemInstruction: WEEKLY_REVIEW_SYSTEM_INSTRUCTION,
  responseSchema: weeklyReviewResponseSchema,
  generationConfig: WEEKLY_REVIEW_GENERATION_CONFIG,
};

export const createGeminiProvider = (options: GeminiProviderOptions): GeminiProvider => {
  const maxAttempts = options.maxTransportAttempts ?? DEFAULT_TRANSPORT_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const client: GeminiClient =
    options.client ?? (new GoogleGenAI({ apiKey: options.apiKey }) as unknown as GeminiClient);

  const call = async (prompt: string, shape: CallShape): Promise<ProviderResult> => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await client.models.generateContent({
          model: GEMINI_MODEL_ID,
          contents: prompt,
          config: {
            ...shape.generationConfig,
            systemInstruction: shape.systemInstruction,
            responseMimeType: "application/json",
            responseSchema: shape.responseSchema,
          },
        });

        const text = extractText(response);
        if (text === undefined) {
          // A response with no text is not a transport problem; retrying it
          // would just buy the same nothing again.
          return { output: undefined, usage: extractUsage(response) };
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Not JSON despite the schema. Untrusted output stays untrusted; the
          // caller's validation will reject it.
          parsed = undefined;
        }

        return { output: parsed, usage: extractUsage(response) };
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === maxAttempts) break;
        await sleep(250 * attempt);
      }
    }

    throw classifyProviderError(lastError);
  };

  return {
    id: GEMINI_PROVIDER_ID,

    generatePlanWithUsage: (input, repairInstruction) => {
      const prompt = repairInstruction
        ? `${buildPlanPrompt(input)}\n\n${repairInstruction}`
        : buildPlanPrompt(input);
      return call(prompt, PLAN_CALL);
    },

    generatePlan: async (input) => (await call(buildPlanPrompt(input), PLAN_CALL)).output,

    summariseWeeklyReviewWithUsage: (input) =>
      call(buildWeeklyReviewPrompt(input), WEEKLY_REVIEW_CALL),

    summariseWeeklyReview: async (input: WeeklyReviewFacts) =>
      (await call(buildWeeklyReviewPrompt(input), WEEKLY_REVIEW_CALL)).output,
  };
};
