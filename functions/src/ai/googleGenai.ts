import { GoogleGenAI } from "@google/genai";

/**
 * The one module that imports the Google GenAI SDK (NUT-12B).
 *
 * Low-level transport only, shared by product adapters that must not share
 * anything else: Training's Gemini Developer API adapter
 * (`coaching/providers/gemini.ts`) and Nutrition's Vertex AI adapter
 * (`nutrition/providers/vertexGemini.ts`). Nothing here knows a prompt, a
 * response schema, a model id, a generation setting, a quota or a log; each
 * adapter owns its own, and neither imports the other.
 *
 * What lives here:
 *
 *   - building an SDK client for one explicit connection — an API key for the
 *     Gemini Developer API, or a project and a location for Vertex AI, where
 *     the runtime's own identity (Application Default Credentials) signs the
 *     request and no key exists
 *   - reading the model's text and the usage it reported from a response
 *   - reading an HTTP status from a failure, and whether it is transient
 *   - one bounded retry loop over transient failures
 *
 * The SDK's own retry is left off (no `retryOptions` is ever passed), so the
 * loop below is the only retry and its bound is the adapter's.
 */

/** The slice of the SDK an adapter uses, so tests inject a fake and make no network call. */
export interface GoogleGenAiClient {
  models: {
    generateContent(request: Record<string, unknown>): Promise<unknown>;
  };
}

/**
 * Where a client sends its requests, and how it is authenticated. Always
 * explicit: nothing here falls back to an environment variable, a default
 * project or a default location.
 */
export type GoogleGenAiConnection =
  /** The Gemini Developer API, authenticated by an API key. */
  | { kind: "developerApi"; apiKey: string }
  /** Vertex AI, authenticated by the runtime's own IAM identity (ADC). No key. */
  | { kind: "vertex"; project: string; location: string };

/** A real SDK client for `connection`. Constructing one makes no request. */
export const createGoogleGenAiClient = (connection: GoogleGenAiConnection): GoogleGenAiClient => {
  if (connection.kind === "developerApi") {
    return new GoogleGenAI({ apiKey: connection.apiKey }) as unknown as GoogleGenAiClient;
  }
  return new GoogleGenAI({
    vertexai: true,
    project: connection.project,
    location: connection.location,
  }) as unknown as GoogleGenAiClient;
};

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Pull only numeric usage fields. Absent stays absent — nothing is inferred. */
export const extractGenAiUsage = (response: unknown): TokenUsage => {
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
export const extractGenAiText = (response: unknown): string | undefined => {
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

/** The text as JSON, or undefined when it is not JSON. Untrusted either way. */
export const parseGenAiJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The HTTP status a failure carries, if any. Never its message. */
export const genAiErrorStatus = (error: unknown): number | undefined => {
  const candidate = error as { status?: unknown; code?: unknown };
  return readNumber(candidate.status) ?? readNumber(candidate.code);
};

/**
 * Whether a failure is worth one more attempt: 429 and 5xx only. A 400, 401,
 * 403, an unparseable answer, a schema or policy rejection and a timeout are
 * not — the same request would fail the same way, or be billed twice.
 */
export const isTransientGenAiError = (error: unknown): boolean => {
  const status = genAiErrorStatus(error);
  return status === 429 || (status !== undefined && status >= 500);
};

/** The pause before attempt `n + 1`, in ms: 250 × n. */
export const TRANSPORT_RETRY_BACKOFF_MS = 250;

export interface TransportRetryOptions {
  /** Attempts in total, including the first. The adapter's bound, never unbounded. */
  maxAttempts: number;
  sleep: (ms: number) => Promise<void>;
  /** Which failures get another attempt. Default: 429 and 5xx. */
  isRetryable?: (error: unknown) => boolean;
}

export type TransportOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Run `operation` up to `maxAttempts` times while it fails transiently.
 *
 * The last failure comes back as data, raw, for the adapter to classify in its
 * own vocabulary; nothing here decides what a caller is told.
 */
export const runWithTransportRetry = async <T>(
  operation: () => Promise<T>,
  { maxAttempts, sleep, isRetryable = isTransientGenAiError }: TransportRetryOptions
): Promise<TransportOutcome<T>> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxAttempts) break;
      await sleep(TRANSPORT_RETRY_BACKOFF_MS * attempt);
    }
  }

  return { ok: false, error: lastError };
};

export const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
