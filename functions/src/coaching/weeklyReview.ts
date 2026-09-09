import type { Firestore } from "firebase-admin/firestore";
import {
  describeRecommendation,
  isExplainableWeek,
  recommendCategory,
  recommendFocus,
  validateModelRecommendation,
  type WeeklyRecommendation,
  type WeeklyReviewContext,
  type WeeklyReviewMetrics,
} from "../../../shared/weeklyRecommendation";
import { isPlanWeekKey } from "../../../shared/planWeek";
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
 *
 * The third rule, new in PR68, is that a review answers for the week it was
 * asked about. The handler used to take no input and resolve the week from its
 * own clock, so a user reading Week 1 in the app received wording generated
 * from the numbers of whatever week the server was in. The request now names
 * the week, the response says which week it used, and a week that has not
 * happened yet is answered without paying a model to describe it.
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
  /**
   * The plan and week these numbers and this wording belong to.
   *
   * Sent explicitly rather than left to be inferred from the metrics, and
   * checked by the client against the context it asked from: a response that
   * arrives after the user has moved on is data about another week, and must
   * not be rendered as this one's.
   */
  context: WeeklyReviewContext;
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
      : {
          measuredDurationMinutes: minutes,
          measuredSessionCount: metrics.measuredSessionCount,
          // "none" cannot reach here: minutes are absent exactly then.
          durationCoverage: metrics.durationCoverage === "partial" ? "partial" : "full",
        }),
    ...(typeof previous === "number" ? { previousWeekCompletionPercent: previous } : {}),
    ...(profile.goal ? { goal: profile.goal } : {}),
    ...(profile.experienceLevel ? { experienceLevel: profile.experienceLevel } : {}),
    category: recommendCategory(metrics),
    focus: recommendFocus(metrics),
  });

  return parsed.success ? parsed.data : null;
};

/**
 * The one thing a caller may say: which week of its own programme to review.
 *
 * Absent is allowed and means "the week the server is in" — the pre-PR68
 * behaviour, kept so a client that has not shipped yet keeps working. Present
 * but not a week of the four-week programme is refused rather than clamped:
 * clamping "Week 9" to "Week 4" would answer a question nobody asked, which is
 * the family of bug this whole change is about.
 */
export const readRequestedWeekKey = (data: unknown): string | null => {
  const candidate = (data ?? {}) as { weekKey?: unknown };
  if (candidate.weekKey === undefined || candidate.weekKey === null) return null;
  if (!isPlanWeekKey(candidate.weekKey)) {
    throw new AiError("INVALID_REQUEST", "Unsupported weekly review week.");
  }
  return candidate.weekKey;
};

export const handleGenerateWeeklyReview = async (
  request: WeeklyReviewRequest,
  deps: WeeklyReviewDeps
): Promise<WeeklyReviewResult> => {
  const now = deps.now ?? (() => new Date());
  const limit = DEFAULT_QUOTA_LIMITS[ACTION];

  // 1. Identity from the verified token. The only field read from
  //    `request.data` is a week key, and it selects a position in the caller's
  //    own programme — it cannot add a completion or reach another user's data.
  const { uid } = requireAuth(request);
  const requestedWeekKey = readRequestedWeekKey(request.data);
  const startedAt = Date.now();

  const summary = async (): Promise<QuotaSummary> => {
    const used = await deps.quota.getUsage(uid, ACTION).catch(() => limit);
    return { remaining: Math.max(0, limit - used), limit, period: deps.quota.currentPeriod() };
  };

  // 2. Metrics, computed server-side from the caller's own plan and logs.
  //    Read-only, throughout — see weeklyReviewData.ts.
  let data;
  try {
    data = await readWeeklyReviewData(deps.firestore, uid, now(), requestedWeekKey);
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
    context: data.context,
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

  // 3. A week that has not begun yet. Its numbers are all zero because nobody
  //    could have trained in it, so there is no adherence to explain and
  //    nothing worth a user's quota — least of all a sentence about sessions
  //    they have not missed yet.
  if (data.weekNotStarted) {
    return respond(deterministic, "not_applicable");
  }

  // 4. Nothing planned, or a week outside the programme. There is no coaching
  //    conclusion to phrase, so no provider call and no quota is spent.
  const input = buildWeeklyReviewInput(metrics, profile);
  if (input === null) {
    return respond(deterministic, "not_applicable");
  }

  // 5. Reserve before spending. Exhausted quota is not an error: the review
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
    // 6. One attempt. No repair loop: a second paid call to reword a sentence
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
