/**
 * The error vocabulary shared by the backend and the client.
 *
 * Every failure the client can see is one of these codes. A provider's own
 * error text never crosses this boundary: it can contain endpoints, request
 * ids, quota details of the Google project, and occasionally fragments of the
 * request — none of which a user needs and none of which we want in a browser
 * console or a screenshot.
 */

export const AI_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_REQUEST",
  "PROFILE_INCOMPLETE",
  "QUOTA_EXCEEDED",
  "REQUEST_IN_PROGRESS",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "MODEL_OUTPUT_INVALID",
  "PERSISTENCE_FAILED",
  "INTERNAL",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Profile fields a plan cannot be generated without. */
export const REQUIRED_PROFILE_FIELDS = [
  "fitnessGoal",
  "experienceLevel",
  "equipment",
  "daysPerWeek",
  "sessionMinutes",
] as const;

export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

export interface AiErrorDetails {
  /** Only for PROFILE_INCOMPLETE: which fields the user still has to fill in. */
  missingFields?: RequiredProfileField[];
  /** Only for QUOTA_EXCEEDED. */
  limit?: number;
  period?: string;
}

/**
 * A failure that is safe to send to a client.
 *
 * `message` is a short internal description for server logs. It is never
 * returned to the browser — the client maps `code` to its own German copy, so
 * a change of wording here cannot leak into the UI.
 */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly details: AiErrorDetails = {}
  ) {
    super(message);
    this.name = "AiError";
  }
}

export const isAiError = (value: unknown): value is AiError =>
  value instanceof AiError;
