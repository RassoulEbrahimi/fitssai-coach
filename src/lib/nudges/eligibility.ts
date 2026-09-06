import { resolvePlanDay } from "@/lib/planLifecycle";
import { getWorkoutDateString, toCalendarDateString } from "@/lib/workoutDateUtils";
import { computeWeeklyAdherence } from "@/lib/coaching/facts";
import { readPlanWeekDays } from "@/lib/coaching/reviewMetrics";
import {
  classifyLog,
  isCalendarDayComplete,
  isPlanDayComplete,
  readCompletedDays,
  toWorkoutLogRecord,
  type AnyWorkoutLogShape,
} from "@/lib/workoutCompletion";
import { dayNudgeText, weeklyConsistencyText, type DayNudgeKind } from "./copy";
import type { WorkoutPlan } from "@/lib/types";

/**
 * Whether there is anything truthful to remind somebody of today.
 *
 * A pure predicate over the plan, the calendar date and the stored workout
 * logs. No clock is read, no query is issued, nothing is written, and no model
 * is consulted — hand it the same three inputs and it returns the same answer,
 * which is what makes the transitions in `eligibility.test.ts` testable at all.
 *
 * The rule it enforces, in one sentence: a nudge exists only for a training
 * day the plan actually schedules, inside the plan's four-week window, whose
 * *day session record* does not say completed.
 *
 * What is deliberately **not** evidence:
 *
 *   - a ticked exercise or a logged set. Those are exercise-position rows;
 *     `shared/workoutCompletion.ts` is the single authority on what completes
 *     a day, and it counts only the day session record. Reading progress as
 *     completion would silence the nudge for someone mid-session; reading it
 *     as incompleteness after the day was finished would nag someone who was
 *     already done. Neither happens here — the exercise rows only decide the
 *     *wording* (§ `hasStarted`), never the eligibility.
 *   - a legacy row that can be placed in neither family. An unreadable
 *     document is not proof of anything and is ignored in both directions.
 */

export type NudgeType = "planned-session-today" | "unfinished-session" | "weekly-consistency";

/** Why there is nothing to say today. Every value is a fact, not a failure. */
export type NudgeSuppressionReason =
  /** No plan exists, or it has no usable start date. */
  | "no-plan"
  /** The plan starts later than this date. */
  | "before-plan-start"
  /** The date sits past Week 4 — the programme is over. */
  | "plan-finished"
  /** The plan schedules no exercises for this day. */
  | "rest-day"
  /** The day session record says the day is done. */
  | "day-completed";

export interface NudgeContext {
  planId: string | null;
  weekKey: string;
  dayIndex: number;
  /** `YYYY-MM-DD` for this plan day, or null when it cannot be derived. */
  workoutDay: string | null;
  /** Training days the plan schedules this week (rest days excluded). */
  scheduledThisWeek: number;
  /** Of those, the ones with a completed day session record. */
  completedThisWeek: number;
  /** Scheduled minus completed. Today is always one of them. */
  openThisWeek: number;
  /** Whether a readable exercise row exists at today's plan position. */
  hasStarted: boolean;
}

export interface TrainingNudge {
  type: NudgeType;
  /**
   * Identity of this *nudge*, wording included. Render identity only — it
   * changes when the day's wording changes, so it must never be what delivery
   * or dismissal is remembered under. Use `dayKey` for that.
   */
  key: string;
  /**
   * Identity of the *training day*: plan, week and day position, and nothing
   * else. This is the anti-spam key.
   *
   * It deliberately excludes the nudge type. The same day moves from
   * "planned-session-today" to "unfinished-session" the moment one exercise is
   * ticked off, and a key carrying the type would read that transition as a
   * second, unseen nudge and raise a second notification on the same training
   * day. The product rule is one browser notification per planned training
   * day, whatever the app ends up calling it. A new plan or the next day is a
   * different position, so both are eligible again.
   */
  dayKey: string;
  title: string;
  body: string;
  /**
   * Whether this one may leave the app as a browser notification. Only the
   * day nudge may: a weekly count is context for somebody already looking at
   * the app, not a reason to interrupt them.
   */
  browserDeliverable: boolean;
}

export interface NudgeEvaluation {
  eligible: boolean;
  /** Set only when nothing is eligible. */
  reason: NudgeSuppressionReason | null;
  context: NudgeContext | null;
  /** Empty whenever `eligible` is false. Ordered: day nudge first. */
  nudges: TrainingNudge[];
}

export interface NudgeInput {
  plan: WorkoutPlan | null | undefined;
  /** The date being evaluated — normally today. Never read from a clock here. */
  date: Date;
  logs: readonly (AnyWorkoutLogShape | null | undefined)[] | null | undefined;
}

const suppressed = (reason: NudgeSuppressionReason): NudgeEvaluation => ({
  eligible: false,
  reason,
  context: null,
  nudges: [],
});

/** The `YYYY-MM-DD` this plan position falls on, if it can be derived at all. */
const readWorkoutDay = (
  plan: WorkoutPlan | null | undefined,
  weekKey: string,
  dayIndex: number
): string | null => {
  if (!plan?.created_at) return null;
  try {
    return getWorkoutDateString(plan.created_at, weekKey, dayIndex);
  } catch {
    return null;
  }
};

/**
 * Whether any readable exercise row sits at this plan position.
 *
 * Only `"exercise"` rows count. A `"day-session"` row is the completion record
 * this module already consulted, and an `"unknown"` row is history nobody can
 * place — promoting either into "you already started" would be a guess.
 */
const hasStartedToday = (
  logs: readonly (AnyWorkoutLogShape | null | undefined)[],
  weekKey: string,
  dayIndex: number
): boolean =>
  logs.some((log) => {
    if (classifyLog(log) !== "exercise") return false;
    const record = toWorkoutLogRecord(log);
    return record.weekKey === weekKey && record.dayIndex === dayIndex;
  });

/**
 * Today's session, counted the same way the weekly review counts it.
 *
 * `computeWeeklyAdherence` is the coaching layer's own arithmetic, reused
 * rather than re-derived so the nudge's "noch X von Y" and the Wochenrückblick
 * cannot disagree about the same week.
 */
const readWeekCounts = (
  plan: WorkoutPlan | null | undefined,
  weekKey: string,
  logs: readonly (AnyWorkoutLogShape | null | undefined)[]
): { scheduled: number; completed: number; open: number } => {
  const adherence = computeWeeklyAdherence(
    weekKey,
    readPlanWeekDays(plan, weekKey),
    readCompletedDays(logs).map((day) => ({ ...day, completed: true }))
  );

  return {
    scheduled: adherence.scheduledDays,
    completed: adherence.completedDays,
    open: adherence.missedDays,
  };
};

/**
 * The training day a nudge belongs to: `planId|weekKey|dayIndex`.
 *
 * Everything the anti-spam record is keyed on, and nothing that can change
 * while the day is still the same day.
 */
export const trainingDayKey = (context: NudgeContext): string =>
  [context.planId ?? "no-plan", context.weekKey, context.dayIndex].join("|");

/** The render identity of one nudge — the training day plus its wording. */
export const nudgeKey = (context: NudgeContext, type: NudgeType): string =>
  [trainingDayKey(context), type].join("|");

const buildDayNudge = (kind: DayNudgeKind, context: NudgeContext): TrainingNudge => {
  const text = dayNudgeText(kind);
  return {
    type: kind,
    key: nudgeKey(context, kind),
    dayKey: trainingDayKey(context),
    title: text.title,
    body: text.body,
    browserDeliverable: true,
  };
};

/**
 * The week's open-session count, when it says more than the day nudge already
 * does.
 *
 * Withheld when today is the only open session: "noch 1 von 1 offen" repeats
 * the sentence directly above it, and a nudge that restates itself is noise.
 */
const buildWeeklyNudge = (context: NudgeContext): TrainingNudge | null => {
  if (context.scheduledThisWeek < 2 || context.openThisWeek < 2) return null;
  const text = weeklyConsistencyText(context.openThisWeek, context.scheduledThisWeek);
  return {
    type: "weekly-consistency",
    key: nudgeKey(context, "weekly-consistency"),
    /* Same day identity as the day nudge, so one dismissal closes the day. */
    dayKey: trainingDayKey(context),
    title: text.title,
    body: text.body,
    /* In-app only: a count is context, never a reason to interrupt somebody. */
    browserDeliverable: false,
  };
};

/** The calendar day a nudge belongs to, for pruning the delivery record. */
export const nudgeDay = (evaluation: NudgeEvaluation, fallback: Date): string =>
  evaluation.context?.workoutDay ?? toCalendarDateString(fallback);

/**
 * Evaluate a single date against a single plan.
 *
 * Reads the plan and the logs; writes nothing, to neither. See the module
 * comment for the rule and for what is deliberately not treated as evidence.
 */
export const evaluateTrainingNudges = ({ plan, date, logs }: NudgeInput): NudgeEvaluation => {
  const allLogs = logs ?? [];
  const resolved = resolvePlanDay(plan, date);

  if (resolved.status === "no-plan") return suppressed("no-plan");
  if (resolved.status === "before-start") return suppressed("before-plan-start");
  if (resolved.status === "completed") return suppressed("plan-finished");

  const { weekKey, dayIndex } = resolved;
  if (weekKey === null || dayIndex === null) return suppressed("no-plan");

  // A day the plan gives no exercises is not a training day, so there is
  // nothing outstanding to mention. Same answer for a day the plan simply
  // does not describe.
  if (resolved.isRestDay) return suppressed("rest-day");

  const workoutDay = readWorkoutDay(plan, weekKey, dayIndex);

  /*
    Completion, from the day session record only — checked by plan position
    and, when the date is derivable, by calendar day too. The two addressings
    exist because both are written; accepting either as proof of completion
    can only ever silence a nudge, and staying quiet about a day somebody
    already finished is the safe direction to be wrong in.
  */
  const completed =
    isPlanDayComplete(allLogs, weekKey, dayIndex) ||
    (workoutDay !== null && isCalendarDayComplete(allLogs, workoutDay));
  if (completed) return suppressed("day-completed");

  const weekCounts = readWeekCounts(plan, weekKey, allLogs);
  const context: NudgeContext = {
    planId: resolved.planId,
    weekKey,
    dayIndex,
    workoutDay,
    scheduledThisWeek: weekCounts.scheduled,
    completedThisWeek: weekCounts.completed,
    openThisWeek: weekCounts.open,
    hasStarted: hasStartedToday(allLogs, weekKey, dayIndex),
  };

  const dayNudge = buildDayNudge(
    context.hasStarted ? "unfinished-session" : "planned-session-today",
    context
  );
  const weeklyNudge = buildWeeklyNudge(context);

  return {
    eligible: true,
    reason: null,
    context,
    nudges: weeklyNudge ? [dayNudge, weeklyNudge] : [dayNudge],
  };
};
