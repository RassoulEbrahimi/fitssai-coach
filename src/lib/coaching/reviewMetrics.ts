import {
  computeWeeklyReviewMetrics,
  type ReviewCompletion,
  type ReviewLog,
  type ReviewPlanDay,
  type WeeklyReviewMetrics,
} from "@shared/weeklyRecommendation";
import { isRestDayContent } from "@/lib/planLifecycle";
import type { WorkoutLog, WorkoutPlan } from "@/lib/types";

/**
 * The client's assembly of the weekly review metrics.
 *
 * The arithmetic itself lives in `shared/weeklyRecommendation.ts` and is the
 * same code the backend runs, so the number on screen and the number a model
 * is told about are the same number by construction rather than by review.
 * This module only shapes the app's stored documents into that code's inputs.
 *
 * Nothing here writes. Reading a plan to count its training days does not
 * change it, and no caller of these functions persists anything.
 */

/** Read one plan week as day-by-day exercise counts, Monday first. */
export const readPlanWeekDays = (
  plan: WorkoutPlan | null | undefined,
  weekKey: string | null | undefined
): ReviewPlanDay[] => {
  const content = plan?.content as Record<string, unknown> | undefined;
  const raw = weekKey
    ? (content?.[weekKey] ?? content?.[weekKey.toLowerCase().replace(/\s+/g, "")])
    : undefined;
  const days = Array.isArray(raw) ? raw : [];

  return Array.from({ length: 7 }, (_, dayIndex) => {
    const day = days[dayIndex];
    return {
      dayIndex,
      // A day with no exercises is a rest day, and a rest day is never missed.
      exerciseCount: isRestDayContent(day) ? 0 : (day?.exercises?.length ?? 0),
    };
  });
};

/**
 * Completions, from plan position only.
 *
 * `workout_day` is deliberately not a fallback: a log written before PR47 can
 * carry a date derived from the plan's creation date rather than its start
 * Monday, so counting it would turn a known-bad value into a confident weekly
 * claim. An uncounted session understates the week, which is the safer error.
 */
export const readCompletions = (logs: readonly WorkoutLog[]): ReviewCompletion[] =>
  logs
    .filter((log) => typeof log.week_key === "string" && typeof log.day_index === "number")
    .map((log) => ({
      weekKey: log.week_key as string,
      dayIndex: log.day_index as number,
      completed: Boolean(log.completed),
    }));

export const readWeekLogs = (
  logs: readonly WorkoutLog[],
  weekKey: string
): ReviewLog[] =>
  logs
    .filter((log) => log.week_key === weekKey)
    .map((log) => ({
      weekKey,
      dayIndex: typeof log.day_index === "number" ? log.day_index : null,
      completed: Boolean(log.completed),
      durationSec: (log as { duration_sec?: number | null }).duration_sec ?? null,
    }));

export interface WeeklyReviewMetricsSource {
  plan: WorkoutPlan | null | undefined;
  /** The resolved plan week, or null when the date sits outside the programme. */
  weekKey: string | null;
  weekNumber: number | null;
  logs: readonly WorkoutLog[];
}

/**
 * The week's metrics, or an honest empty week.
 *
 * A date outside the four-week programme, or a user with no plan, produces
 * `hasPlan: false` rather than zeros: "nothing is planned" and "nothing was
 * done" are different statements, and only one of them is about the user.
 */
export const buildWeeklyReviewMetrics = (
  source: WeeklyReviewMetricsSource
): WeeklyReviewMetrics => {
  const { plan, weekKey, weekNumber, logs } = source;

  if (!plan || !weekKey) {
    return computeWeeklyReviewMetrics({
      weekKey: weekKey ?? "",
      weekNumber,
      hasPlan: false,
      planDays: [],
      completions: [],
      weekLogs: [],
    });
  }

  const previousWeekKey =
    weekNumber !== null && weekNumber > 1 ? `Week ${weekNumber - 1}` : null;

  return computeWeeklyReviewMetrics({
    weekKey,
    weekNumber,
    hasPlan: true,
    planDays: readPlanWeekDays(plan, weekKey),
    completions: readCompletions(logs),
    weekLogs: readWeekLogs(logs, weekKey),
    previousWeek: previousWeekKey
      ? { weekKey: previousWeekKey, planDays: readPlanWeekDays(plan, previousWeekKey) }
      : null,
  });
};
