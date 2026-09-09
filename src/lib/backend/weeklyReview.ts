import { getApp } from "firebase/app";
import { getFunctions, httpsCallable, type FunctionsError } from "firebase/functions";
import {
  findUnsafeRecommendationText,
  RECOMMENDATION_CATEGORIES,
  weeklyReviewContextMatches,
  type WeeklyRecommendation,
  type WeeklyReviewContext,
  type WeeklyReviewMetrics,
} from "@shared/weeklyRecommendation";
import { FUNCTIONS_REGION } from "./region";

/**
 * The client's side of the weekly review.
 *
 * It sends one thing: which week of its own programme it is asking about. The
 * plan, the logs and the two profile fields the recommendation may use are
 * still read server-side under the caller's own uid, so the browser cannot
 * decide what the review says about that week — and cannot claim a completion
 * it never logged.
 *
 * The week has to be said out loud because the backend used to derive it from
 * its own clock. Someone reading Week 1 was answered about the server's current
 * week, and nothing in the response revealed the swap. So the request names the
 * week, the response names the week it answered for, and this module refuses
 * any response whose week is not the one that was asked for — a late answer
 * about another week is data about another week, whatever it says.
 *
 * Nothing this module returns is ever written back. The response carries a
 * recommendation and the numbers behind it; there is no plan in it, and no
 * caller of this function persists anything.
 */

/** Where the wording came from, and why, when it is not the model's. */
export type WeeklyReviewAiStatus = "ai" | "not_applicable" | "quota_exceeded" | "unavailable";

export interface WeeklyReviewQuota {
  remaining: number;
  limit: number;
  /** Calendar month, e.g. "2026-09". */
  period: string;
}

/** What the caller is asking about. `planId` is verified, never sent. */
export interface WeeklyReviewRequest {
  /** `"Week 1".."Week 4"`, or null when no plan covers the view. */
  weekKey: string | null;
  planId: string | null;
}

export interface WeeklyReviewResponse {
  ok: true;
  /**
   * The week the backend actually answered for.
   *
   * Optional only for the window between this client shipping and the
   * `generateWeeklyReview` deploy that adds it; `answeredContext` falls back to
   * the metrics' own week key, which the old backend already sends and which is
   * just as much a fact about the response.
   */
  context?: WeeklyReviewContext;
  metrics: WeeklyReviewMetrics;
  recommendation: WeeklyRecommendation;
  aiStatus: WeeklyReviewAiStatus;
  quota: WeeklyReviewQuota;
  planFinished: boolean;
}

export type WeeklyReviewErrorCode =
  | "UNAUTHENTICATED"
  | "UNAVAILABLE"
  /** The answer is about a different week or plan than the one requested. */
  | "CONTEXT_MISMATCH";

/** A failure the UI can act on, carrying a code rather than callable prose. */
export class WeeklyReviewError extends Error {
  constructor(readonly code: WeeklyReviewErrorCode) {
    super(code);
    this.name = "WeeklyReviewError";
  }
}

export const toWeeklyReviewError = (error: unknown): WeeklyReviewError => {
  const callable = error as Partial<FunctionsError>;
  return new WeeklyReviewError(
    callable?.code === "functions/unauthenticated" ? "UNAUTHENTICATED" : "UNAVAILABLE"
  );
};

const isRecommendation = (value: unknown): value is WeeklyRecommendation => {
  const candidate = value as Partial<WeeklyRecommendation> | null;
  return (
    !!candidate &&
    typeof candidate.headline === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.reason === "string" &&
    (candidate.source === "ai" || candidate.source === "deterministic") &&
    (RECOMMENDATION_CATEGORIES as readonly string[]).includes(candidate.category as string)
  );
};

/**
 * The context block, when the backend sent one. Absent is allowed; malformed
 * is not — a half-filled identity is worse than none, because the caller would
 * compare against a field that means nothing.
 */
const isContext = (value: unknown): value is WeeklyReviewContext => {
  const candidate = value as Partial<WeeklyReviewContext> | null;
  return (
    !!candidate &&
    (candidate.planId === null || typeof candidate.planId === "string") &&
    (candidate.weekKey === null || typeof candidate.weekKey === "string") &&
    (candidate.weekNumber === null || typeof candidate.weekNumber === "number")
  );
};

/**
 * Refuse a response that is not the agreed shape, or whose wording is not
 * something this product says.
 *
 * The backend screens the model's wording already. Screening it again here
 * costs nothing and means a single missed case on the server cannot put a
 * medical claim, a nutrition tip or a "your plan was updated" in front of a
 * user — the caller keeps the deterministic wording instead.
 */
export const readWeeklyReviewResponse = (data: unknown): WeeklyReviewResponse => {
  const candidate = data as Partial<WeeklyReviewResponse> | null;

  if (
    !candidate ||
    candidate.ok !== true ||
    !candidate.metrics ||
    !isRecommendation(candidate.recommendation) ||
    (candidate.context !== undefined && !isContext(candidate.context)) ||
    findUnsafeRecommendationText(candidate.recommendation).length > 0
  ) {
    throw new WeeklyReviewError("UNAVAILABLE");
  }

  return candidate as WeeklyReviewResponse;
};

/**
 * The week and plan a response is about.
 *
 * Prefers the explicit context the backend sends. `metrics.weekKey` is the
 * fallback, not the source: it is a structured field the old backend already
 * returned, so a client that has shipped ahead of the function deploy can still
 * tell a Week 3 answer from the Week 1 it asked for. Nothing here reads the
 * recommendation's prose — wording is not evidence of which week produced it.
 */
export const answeredContext = (
  response: WeeklyReviewResponse
): Pick<WeeklyReviewContext, "planId" | "weekKey"> => ({
  planId: response.context?.planId ?? null,
  weekKey: response.context?.weekKey ?? (response.metrics.weekKey || null),
});

/**
 * Ask the backend to review one named week and phrase its one recommendation.
 *
 * Called only from an explicit user action. Nothing in the app calls it on
 * render, on mount or on a timer: the deterministic review is already on
 * screen without it, and a paid model call per view would buy a rewording of
 * something the user can already read.
 */
export const fetchWeeklyReview = async (
  request: WeeklyReviewRequest
): Promise<WeeklyReviewResponse> => {
  const functions = getFunctions(getApp(), FUNCTIONS_REGION);
  const callable = httpsCallable<{ weekKey: string | null }, unknown>(
    functions,
    "generateWeeklyReview"
  );

  try {
    const response = readWeeklyReviewResponse(
      (await callable({ weekKey: request.weekKey })).data
    );

    if (!weeklyReviewContextMatches(request, answeredContext(response))) {
      throw new WeeklyReviewError("CONTEXT_MISMATCH");
    }

    return response;
  } catch (error) {
    if (error instanceof WeeklyReviewError) throw error;
    throw toWeeklyReviewError(error);
  }
};
