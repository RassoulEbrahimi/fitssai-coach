import {
  createGoogleGenAiClient,
  defaultSleep,
  extractGenAiText,
  extractGenAiUsage,
  genAiErrorStatus,
  parseGenAiJson,
  runWithTransportRetry,
  type GoogleGenAiClient,
  type TokenUsage,
} from "../../ai/googleGenai";
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
 *
 * Since NUT-12B the SDK itself sits behind the server-wide transport in
 * `ai/googleGenai.ts`, which Nutrition's adapter uses too. Only the transport
 * moved: the model, the API key, the prompts, the schemas, the settings and the
 * retry bound below are Training's own, and unchanged.
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

export type { TokenUsage };

export interface ProviderResult {
  /** Untrusted. The caller validates before anything is persisted. */
  output: unknown;
  /** Only what the provider actually reported. Never estimated. */
  usage: TokenUsage;
}

/** The slice of the SDK this provider uses, so tests need no network. */
export type GeminiClient = GoogleGenAiClient;

export interface GeminiProviderOptions {
  apiKey: string;
  /** Injected in tests. Production builds the real SDK client. */
  client?: GeminiClient;
  /** Transport retries for 429/5xx only. Bounded, and separate from repair. */
  maxTransportAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TRANSPORT_ATTEMPTS = 2;

/** Pull only numeric usage fields. Absent stays absent — nothing is inferred. */
export const extractUsage = (response: unknown): TokenUsage => extractGenAiUsage(response);

/**
 * Map a provider failure onto our own vocabulary.
 *
 * The original message is dropped on purpose: it can carry endpoints, project
 * quota details and request ids, none of which belong in a browser.
 */
export const classifyProviderError = (error: unknown): AiError => {
  const status = genAiErrorStatus(error);
  if (status === 429) {
    return new AiError("PROVIDER_RATE_LIMITED", "Provider rate limited the request.");
  }
  if (status !== undefined && status >= 500) {
    return new AiError("PROVIDER_UNAVAILABLE", `Provider returned ${status}.`);
  }
  return new AiError("PROVIDER_UNAVAILABLE", "Provider request failed.");
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
  const sleep = options.sleep ?? defaultSleep;

  const client: GeminiClient =
    options.client ?? createGoogleGenAiClient({ kind: "developerApi", apiKey: options.apiKey });

  const call = async (prompt: string, shape: CallShape): Promise<ProviderResult> => {
    const outcome = await runWithTransportRetry(
      async (): Promise<ProviderResult> => {
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

        const text = extractGenAiText(response);
        if (text === undefined) {
          // A response with no text is not a transport problem; retrying it
          // would just buy the same nothing again.
          return { output: undefined, usage: extractUsage(response) };
        }

        // Not JSON despite the schema comes back as undefined. Untrusted output
        // stays untrusted; the caller's validation will reject it.
        return { output: parseGenAiJson(text), usage: extractUsage(response) };
      },
      { maxAttempts, sleep }
    );

    if (outcome.ok) return outcome.value;
    throw classifyProviderError(outcome.error);
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
