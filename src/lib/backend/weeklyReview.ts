import { getApp } from "firebase/app";
import { getFunctions, httpsCallable, type FunctionsError } from "firebase/functions";
import {
  findUnsafeRecommendationText,
  RECOMMENDATION_CATEGORIES,
  type WeeklyRecommendation,
  type WeeklyReviewMetrics,
} from "@shared/weeklyRecommendation";
import { FUNCTIONS_REGION } from "./region";

/**
 * The client's side of the weekly review.
 *
 * It sends nothing. The plan, the logs and the two profile fields the
 * recommendation may use are read server-side under the caller's own uid, so
 * the browser cannot decide what the review says about the week — and cannot
 * claim a completion it never logged.
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

export interface WeeklyReviewResponse {
  ok: true;
  metrics: WeeklyReviewMetrics;
  recommendation: WeeklyRecommendation;
  aiStatus: WeeklyReviewAiStatus;
  quota: WeeklyReviewQuota;
  planFinished: boolean;
}

export type WeeklyReviewErrorCode = "UNAUTHENTICATED" | "UNAVAILABLE";

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
    findUnsafeRecommendationText(candidate.recommendation).length > 0
  ) {
    throw new WeeklyReviewError("UNAVAILABLE");
  }

  return candidate as WeeklyReviewResponse;
};

/**
 * Ask the backend for this week's review and its one recommendation.
 *
 * Called only from an explicit user action. Nothing in the app calls it on
 * render, on mount or on a timer: the deterministic review is already on
 * screen without it, and a paid model call per view would buy a rewording of
 * something the user can already read.
 */
export const fetchWeeklyReview = async (): Promise<WeeklyReviewResponse> => {
  const functions = getFunctions(getApp(), FUNCTIONS_REGION);
  const callable = httpsCallable<undefined, unknown>(functions, "generateWeeklyReview");

  try {
    return readWeeklyReviewResponse((await callable()).data);
  } catch (error) {
    if (error instanceof WeeklyReviewError) throw error;
    throw toWeeklyReviewError(error);
  }
};
