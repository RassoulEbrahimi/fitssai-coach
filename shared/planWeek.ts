import { PLAN_TOTAL_WEEKS } from "./workoutPlan";

/**
 * Which week of a four-week programme a date falls in.
 *
 * This is the *specification* of the app's plan-week arithmetic, and it lives
 * here because three places used to answer the question independently:
 *
 *   - `src/lib/planLifecycle.ts` (`resolvePlanDay`) — the client's lifecycle
 *     resolver, built on date-fns-tz, which also decides rest days, day data
 *     and completion. It stays where it is: it answers a bigger question, and
 *     rewiring the dashboard's day resolution is not something a weekly review
 *     should do.
 *   - `src/lib/workoutDateUtils.ts` (`getWorkoutWeekDay`) — the calendar
 *     mapping used when writing a log, which clamps rather than refuses.
 *   - the weekly review backend, which had its own copy.
 *
 * The backend copy is now this module, and a test in the client suite pins
 * `resolvePlanDay` to it across the week boundaries that matter. So there are
 * two implementations rather than three, and the remaining pair is held
 * together by an executable check instead of by a comment.
 *
 * Nothing here depends on date-fns, Firebase, Node, React or a clock: a
 * date-sensitive decision takes both instants as arguments. That is what lets
 * a test reproduce a Sunday-to-Monday rollover without waiting for one.
 */

/** Users train in Germany; the plan's weeks are Berlin calendar weeks. */
export const PLAN_TIMEZONE = "Europe/Berlin";

const berlinDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PLAN_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Whole days since the epoch for the Berlin calendar day of `date`.
 *
 * Formatting to a Berlin wall-clock date and re-reading it as UTC midnight is
 * what makes the arithmetic below a *calendar* difference rather than a
 * duration: 23-hour and 25-hour days at the DST boundaries would otherwise
 * shift a week by one.
 */
export const berlinDayNumber = (date: Date): number =>
  Math.floor(Date.parse(`${berlinDayFormatter.format(date)}T00:00:00Z`) / 86_400_000);

/** Monday-based weekday index (0 = Monday) for an epoch day number. */
export const mondayIndex = (dayNumber: number): number =>
  // 1970-01-01 was a Thursday, i.e. index 3.
  (((dayNumber + 3) % 7) + 7) % 7;

export interface ResolvedPlanWeek {
  /** `"Week 1".."Week 4"`, or null when the date is outside the programme. */
  weekKey: string | null;
  weekNumber: number | null;
  /** The preceding week, when there is one inside the programme. */
  previousWeekKey: string | null;
  /** True once the date is past the last week. */
  planFinished: boolean;
}

/**
 * Resolve a date to its plan week.
 *
 * Anchored on the Monday of the week the plan was created: a plan created on a
 * Wednesday still starts its Week 1 on the Monday before, which is why a
 * Sunday and the Monday after it land in different weeks even though they are
 * one day apart. Deliberately clamped rather than wrapped — a four-week plan
 * has no Week 5, and a date past it resolves to nothing rather than silently
 * to Week 1 again.
 */
export const resolvePlanWeek = (planCreatedAt: Date, at: Date): ResolvedPlanWeek => {
  const created = berlinDayNumber(planCreatedAt);
  const planStart = created - mondayIndex(created);
  const dayOffset = berlinDayNumber(at) - planStart;

  if (dayOffset < 0) {
    return { weekKey: null, weekNumber: null, previousWeekKey: null, planFinished: false };
  }

  const weekNumber = Math.floor(dayOffset / 7) + 1;
  if (weekNumber > PLAN_TOTAL_WEEKS) {
    return { weekKey: null, weekNumber: null, previousWeekKey: null, planFinished: true };
  }

  return {
    weekKey: `Week ${weekNumber}`,
    weekNumber,
    previousWeekKey: weekNumber > 1 ? `Week ${weekNumber - 1}` : null,
    planFinished: false,
  };
};
