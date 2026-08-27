import type { QuotaAction } from "../quota";

/**
 * What a record of an AI operation may contain.
 *
 * The app already reads `users/{uid}/ai_logs` in two places and has never had
 * a writer; this is the contract a writer will have to satisfy. Defining it
 * before there is anything to log keeps the privacy decision in the open,
 * where it can be argued with, rather than in whatever the first writer
 * happened to do.
 *
 * The rule: a log says what happened, not what was said. Prompts and model
 * responses are never stored by default — they are the most sensitive thing in
 * the whole exchange, and an operational log does not need them to answer "did
 * this work, how long did it take, what did it cost". Names and email
 * addresses are never stored at all; the document already lives under the
 * user's own uid.
 */

export type AiLogStatus = "success" | "error";

export type AiLogErrorCategory =
  | "provider_error"
  | "provider_timeout"
  | "invalid_output"
  | "quota_exceeded"
  | "internal_error";

export interface AiLogEntry {
  action: QuotaAction;
  status: AiLogStatus;
  /** Provider and model identifiers, e.g. "acme/model-v2". Never a key. */
  provider?: string;
  model?: string;
  latencyMs?: number;
  /** Only when the provider reports them. Never estimated. */
  inputTokens?: number;
  outputTokens?: number;
  /** ISO 8601, set by the server. */
  createdAt: string;
  errorCategory?: AiLogErrorCategory;
}

/** Keys that must never appear in a log document, enforced by a test. */
export const FORBIDDEN_LOG_FIELDS = [
  "prompt",
  "response",
  "completion",
  "messages",
  "email",
  "name",
  "displayName",
  "apiKey",
] as const;

/**
 * Where log entries go.
 *
 * No implementation ships in this PR: with no AI request to record, a writer
 * could only produce fictional documents in a real user's history.
 */
export interface AiLogWriter {
  write(uid: string, entry: AiLogEntry): Promise<void>;
}

/** Firestore path for a user's log collection. Read today, written from PR51. */
export const aiLogCollectionPath = (uid: string): string => `users/${uid}/ai_logs`;

/**
 * Reject an entry that carries content it should not.
 *
 * Returns the offending keys instead of throwing, so a caller can log the
 * refusal rather than crash a user's request over an operational detail.
 */
export const findForbiddenLogFields = (entry: Record<string, unknown>): string[] =>
  FORBIDDEN_LOG_FIELDS.filter((field) => field in entry);
