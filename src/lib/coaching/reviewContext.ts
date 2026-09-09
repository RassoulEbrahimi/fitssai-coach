import type { WeeklyReviewMetrics } from "@shared/weeklyRecommendation";

/**
 * The identity of a weekly review *as the screen knows it*.
 *
 * The backend binds a review to a plan and a week (see
 * `shared/weeklyRecommendation.ts`). The UI needs one thing more: the facts.
 * A model's sentence is generated from a specific set of numbers, and those
 * numbers move while the user is looking at them — a session finished in
 * another tab, a queued offline completion replayed, a set logged on the phone.
 * Once they have, the sentence describes a week that no longer exists, and
 * leaving it on screen under the new numbers is the same untruth as showing it
 * under the wrong week.
 *
 * So the rendered wording is kept under a key made of four things:
 *
 *   - the account, because two people share nothing (PR64);
 *   - the plan and the week, which is the backend's own binding;
 *   - the two profile fields the model is told about, because they change what
 *     it is asked to say about numbers that have not moved;
 *   - a fingerprint of the numbers the wording was generated from.
 *
 * Nothing is persisted and nothing is written: the key is derived on every
 * render from values the view already holds, and an unrecognised key simply
 * means the deterministic recommendation is what is shown — which is the
 * default state of this feature anyway.
 */

export interface WeeklyReviewUiContext {
  accountId?: string | null;
  planId?: string | null;
  /** `"Week 1".."Week 4"`, or null when no plan covers the selected date. */
  weekKey?: string | null;
  /**
   * The fitness goal, in its canonical spelling.
   *
   * The server reads the goal itself, under the caller's own uid, and hands it
   * to the model — nothing is sent from here and nothing here is trusted. It
   * is in the key because the model is *told* it: the same week, at the same
   * numbers, is phrased differently for someone building muscle than for
   * someone losing fat, so a goal changed since the sentence was generated
   * leaves that sentence answering a question the user no longer asked.
   */
  goal?: string | null;
  /** The experience level, for the same reason and read the same way. */
  experienceLevel?: string | null;
}

/**
 * Every metric that can change what a recommendation says, in a fixed order.
 *
 * Deliberately derived rather than stored: it costs one string join per render
 * and needs no schema, no document and no migration. `previousWeek` is in it
 * because two of the five recommendation categories are chosen by comparing
 * against the week before.
 */
export const weeklyReviewFactsFingerprint = (metrics: WeeklyReviewMetrics): string =>
  [
    metrics.weekKey,
    metrics.weekNumber ?? "-",
    metrics.hasPlan ? "plan" : "no-plan",
    metrics.scheduledDays,
    metrics.completedDays,
    metrics.missedDays,
    metrics.completionPercent ?? "-",
    metrics.measuredDurationSec ?? "-",
    metrics.measuredSessionCount,
    metrics.unmeasuredSessionCount,
    metrics.durationCoverage,
    metrics.previousWeek?.weekKey ?? "-",
    metrics.previousWeek?.completionPercent ?? "-",
  ].join("|");

/**
 * A profile field as the key sees it: an absent one and a blank one are the
 * same absence, and surrounding whitespace is not a change of goal.
 */
const profileSegment = (value: string | null | undefined, absent: string): string =>
  value?.trim() || absent;

/**
 * The full key: who, which plan, which week, told what about themselves, and
 * which numbers.
 *
 * Two renders share a key exactly when a sentence generated for one is still
 * true of the other.
 */
export const weeklyReviewContextKey = (
  context: WeeklyReviewUiContext | undefined,
  metrics: WeeklyReviewMetrics
): string =>
  [
    context?.accountId ?? "no-account",
    context?.planId ?? "no-plan",
    context?.weekKey ?? metrics.weekKey ?? "no-week",
    profileSegment(context?.goal, "no-goal"),
    profileSegment(context?.experienceLevel, "no-experience"),
    weeklyReviewFactsFingerprint(metrics),
  ].join("::");
