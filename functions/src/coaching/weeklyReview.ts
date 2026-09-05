import type { Firestore } from "firebase-admin/firestore";
import {
  describeRecommendation,
  isExplainableWeek,
  recommendCategory,
  recommendFocus,
  validateModelRecommendation,
  type WeeklyRecommendation,
  type WeeklyReviewMetrics,
} from "../../../shared/weeklyRecommendation";
import { AiError } from "../errors";
import { requireAuth, type AuthContextLike } from "../auth";
import { DEFAULT_QUOTA_LIMITS } from "../quota";
import type { ReservingQuotaStore } from "../quota/firestoreQuotaStore";
import type { WeeklyReviewLogEntry } from "../logging/firestoreAiLogWriter";
import { readWeeklyReviewData } from "./weeklyReviewData";
import { weeklyReviewInputSchema, type WeeklyReviewInput } from "./weeklyReviewInput";
import type { ProviderResult, TokenUsage } from "./providers/gemini";
import { GEMINI_MODEL_ID, GEMINI_PROVIDER_ID } from "./providers/gemini";

/**
 * The weekly review orchestration.
 *
 * What makes this handler different from plan generation is what it *cannot*
 * do. It reads; it never writes to a user's documents. There is no path
 * through it that creates, edits, replaces or regenerates a workout plan, and
 * no branch in which a model's output is persisted anywhere. The result is a
 * suggestion the user reads and acts on, or does not.
 *
 * The second rule is that the review always answers. The metrics and the
 * recommendation are arithmetic and rules over the caller's own records, so a
 * missing profile, an exhausted quota, a refused model answer and a provider
 * outage all degrade to the deterministic wording rather than to an error —
 * and the response says which it was, so nothing deterministic is ever
 * presented as if a model wrote it.
 */

const ACTION = "weekly_summary" as const;

export interface WeeklyReviewProvider {
  /** Raw, unvalidated wording plus whatever usage the provider reported. */
  summariseWeeklyReviewWithUsage(input: WeeklyReviewInput): Promise<ProviderResult>;
}

export interface WeeklyReviewDeps {
  firestore: Firestore;
  provider: WeeklyReviewProvider;
  quota: ReservingQuotaStore;
  log: (entry: WeeklyReviewLogEntry) => Promise<void>;
  now?: () => Date;
}

export interface WeeklyReviewRequest extends AuthContextLike {
  data?: unknown;
}

export interface QuotaSummary {
  remaining: number;
  limit: number;
  period: string;
}

/**
 * Where the wording came from, and why, when it is not the model's.
 *
 * `not_applicable` is not a failure: a week with nothing planned has nothing
 * for a model to say, and paying one to say it anyway would be waste.
 */
export type WeeklyReviewAiStatus =
  | "ai"
  | "not_applicable"
  | "quota_exceeded"
  | "unavailable";

export interface WeeklyReviewResult {
  ok: true;
  metrics: WeeklyReviewMetrics;
  recommendation: WeeklyRecommendation;
  aiStatus: WeeklyReviewAiStatus;
  quota: QuotaSummary;
  /** True once the four-week programme is over. */
  planFinished: boolean;
}

/** Minutes, from measured seconds only. Absent stays absent. */
const measuredMinutes = (metrics: WeeklyReviewMetrics): number | undefined =>
  metrics.measuredDurationSec === null
    ? undefined
    : Math.round(metrics.measuredDurationSec / 60);

/**
 * The provider input, parsed by the strict schema rather than cast.
 *
 * Returns null when the numbers do not satisfy it. That is not an error path
 * worth failing a user's request over — it means this week is not something to
 * pay a model to describe, and the deterministic wording already exists.
 */
export const buildWeeklyReviewInput = (
  metrics: WeeklyReviewMetrics,
  profile: { goal?: WeeklyReviewInput["goal"]; experienceLevel?: WeeklyReviewInput["experienceLevel"] }
): WeeklyReviewInput | null => {
  if (!isExplainableWeek(metrics)) return null;

  const minutes = measuredMinutes(metrics);
  const previous = metrics.previousWeek?.completionPercent;

  const parsed = weeklyReviewInputSchema.safeParse({
    weekNumber: metrics.weekNumber,
    scheduledDays: metrics.scheduledDays,
    completedDays: metrics.completedDays,
    missedDays: metrics.missedDays,
    completionPercent: metrics.completionPercent,
    ...(minutes === undefined
      ? {}
      : { measuredDurationMinutes: minutes, measuredSessionCount: metrics.measuredSessionCount }),
    ...(typeof previous === "number" ? { previousWeekCompletionPercent: previous } : {}),
    ...(profile.goal ? { goal: profile.goal } : {}),
    ...(profile.experienceLevel ? { experienceLevel: profile.experienceLevel } : {}),
    category: recommendCategory(metrics),
    focus: recommendFocus(metrics),
  });

  return parsed.success ? parsed.data : null;
};

export const handleGenerateWeeklyReview = async (
  request: WeeklyReviewRequest,
  deps: WeeklyReviewDeps
): Promise<WeeklyReviewResult> => {
  const now = deps.now ?? (() => new Date());
  const limit = DEFAULT_QUOTA_LIMITS[ACTION];

  // 1. Identity from the verified token. `request.data` is not read at all:
  //    the review takes no input, so there is nothing for a caller to forge.
  const { uid } = requireAuth(request);
  const startedAt = Date.now();

  const summary = async (): Promise<QuotaSummary> => {
    const used = await deps.quota.getUsage(uid, ACTION).catch(() => limit);
    return { remaining: Math.max(0, limit - used), limit, period: deps.quota.currentPeriod() };
  };

  // 2. Metrics, computed server-side from the caller's own plan and logs.
  //    Read-only, throughout — see weeklyReviewData.ts.
  let data;
  try {
    data = await readWeeklyReviewData(deps.firestore, uid, now());
  } catch {
    throw new AiError("INTERNAL", "Failed to read the weekly review data.");
  }

  const { metrics, profile } = data;
  const deterministic = describeRecommendation(metrics);

  const respond = async (
    recommendation: WeeklyRecommendation,
    aiStatus: WeeklyReviewAiStatus
  ): Promise<WeeklyReviewResult> => ({
    ok: true,
    metrics,
    recommendation,
    aiStatus,
    quota: await summary(),
    planFinished: data.planFinished,
  });

  const record = (entry: Omit<WeeklyReviewLogEntry, "uid" | "action" | "createdAt">) =>
    deps
      .log({
        uid,
        action: ACTION,
        createdAt: now().toISOString(),
        latencyMs: Date.now() - startedAt,
        ...entry,
      })
      .catch(() => undefined);

  // 3. Nothing planned, or a week outside the programme. There is no coaching
  //    conclusion to phrase, so no provider call and no quota is spent.
  const input = buildWeeklyReviewInput(metrics, profile);
  if (input === null) {
    return respond(deterministic, "not_applicable");
  }

  // 4. Reserve before spending. Exhausted quota is not an error: the review
  //    still renders, in its own words.
  const reserved = await deps.quota.reserve(uid, ACTION, limit).catch(() => null);
  if (reserved === null) {
    await record({ status: "error", errorCategory: "quota_exceeded", providerCalled: false, category: input.category });
    return respond(deterministic, "quota_exceeded");
  }

  const release = async () => {
    await deps.quota.release(uid, ACTION).catch(() => undefined);
  };

  let usage: TokenUsage = {};

  try {
    // 5. One attempt. No repair loop: a second paid call to reword a sentence
    //    the app can already write itself is not worth a user's quota.
    const attempt = await deps.provider.summariseWeeklyReviewWithUsage(input);
    usage = attempt.usage;

    const validated = validateModelRecommendation(attempt.output, input.category);
    if (!validated.ok) {
      // Refused wording delivers nothing, so it is not charged.
      await release();
      await record({
        status: "error",
        errorCategory: "invalid_output",
        provider: GEMINI_PROVIDER_ID,
        model: GEMINI_MODEL_ID,
        providerCalled: true,
        category: input.category,
        rejection: validated.rejection,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      return respond(deterministic, "unavailable");
    }

    await record({
      status: "success",
      provider: GEMINI_PROVIDER_ID,
      model: GEMINI_MODEL_ID,
      providerCalled: true,
      category: input.category,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    return respond(validated.recommendation, "ai");
  } catch {
    /*
      A provider failure is a wording failure, not a review failure. The
      metrics were computed before the call and are unaffected, so the honest
      thing is to show them with the deterministic recommendation and say the
      explanation is unavailable — never to invent one, and never to blank the
      section a user's own data already filled.
    */
    await release();
    await record({
      status: "error",
      errorCategory: "provider_error",
      provider: GEMINI_PROVIDER_ID,
      model: GEMINI_MODEL_ID,
      providerCalled: true,
      category: input.category,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    return respond(deterministic, "unavailable");
  }
};
