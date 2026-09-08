import { getApp } from "firebase/app";
import { getFunctions, httpsCallable, type FunctionsError } from "firebase/functions";
import { FUNCTIONS_REGION } from "./region";

/**
 * The client's side of plan generation.
 *
 * It sends one opaque request id and nothing else. Every input the model sees
 * — goal, experience, equipment, days, session length — is read server-side
 * from the caller's own profile, so the browser cannot dictate the prompt and
 * a caller cannot generate a plan from somebody else's answers.
 *
 * The plan is written by the server too. This function receives an id, not a
 * document: a browser that could hand back "the generated plan" could hand
 * back anything.
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

export const REQUIRED_PROFILE_FIELDS = [
  "fitnessGoal",
  "experienceLevel",
  "equipment",
  "daysPerWeek",
  "sessionMinutes",
] as const;

export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

export interface PlanGenerationQuota {
  remaining: number;
  limit: number;
  /** Calendar month, e.g. "2026-08". */
  period: string;
}

export interface PlanGenerationResult {
  ok: true;
  planId: string;
  quota: PlanGenerationQuota;
  replay: boolean;
}

/** A failure the UI can act on, carrying a code rather than provider prose. */
export class PlanGenerationError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly missingFields: RequiredProfileField[] = [],
    readonly limit?: number
  ) {
    super(code);
    this.name = "PlanGenerationError";
  }
}

const isKnownCode = (value: unknown): value is AiErrorCode =>
  typeof value === "string" && (AI_ERROR_CODES as readonly string[]).includes(value);

const readMissingFields = (details: unknown): RequiredProfileField[] => {
  const fields = (details as { missingFields?: unknown } | undefined)?.missingFields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((field): field is RequiredProfileField =>
    (REQUIRED_PROFILE_FIELDS as readonly string[]).includes(field as string)
  );
};

/**
 * Turn any thrown value into one of our codes.
 *
 * Anything unrecognised becomes INTERNAL rather than being shown. A callable
 * error message can carry a function name, a region and a request id; none of
 * that belongs in a German sentence in front of a user.
 */
export const toPlanGenerationError = (error: unknown): PlanGenerationError => {
  const callable = error as Partial<FunctionsError> & { details?: unknown };

  if (callable?.code === "functions/unauthenticated") {
    return new PlanGenerationError("UNAUTHENTICATED");
  }

  // The server puts its own code in `message`, never prose.
  if (isKnownCode(callable?.message)) {
    const details = callable.details as { limit?: number } | undefined;
    return new PlanGenerationError(
      callable.message,
      readMissingFields(callable.details),
      details?.limit
    );
  }

  return new PlanGenerationError("INTERNAL");
};

/** A per-attempt id, so a retried click cannot become a second charge. */
export const newRequestId = (): string => crypto.randomUUID();

/**
 * How long the browser waits for the callable.
 *
 * The SDK's default is 70 seconds. `generateWorkoutPlan` is deployed with a
 * 180-second execution budget because a four-week plan takes the model a
 * while, so the default guarantees the browser gives up on calls that are
 * still running and about to succeed — and every one of those becomes a retry
 * of something that already happened. This is the server's budget plus a
 * margin for a cold start and the round trip, so the browser stops waiting
 * only once the server itself has.
 *
 * It does not make the request safe on its own. A response can still be lost
 * to a closed laptop or a dropped connection, which is why the retry sends the
 * same request id and the server treats it as the same request — see
 * `planRequestId.ts` and `functions/src/idempotency.ts`.
 */
export const CALLABLE_TIMEOUT_MS = 195_000;

export const generateWorkoutPlan = async (requestId: string): Promise<PlanGenerationResult> => {
  const functions = getFunctions(getApp(), FUNCTIONS_REGION);
  const callable = httpsCallable<{ requestId: string }, PlanGenerationResult>(
    functions,
    "generateWorkoutPlan",
    { timeout: CALLABLE_TIMEOUT_MS }
  );

  try {
    return (await callable({ requestId })).data;
  } catch (error) {
    throw toPlanGenerationError(error);
  }
};
