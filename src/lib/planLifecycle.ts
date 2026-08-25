import { differenceInCalendarDays, startOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { TARGET_TIMEZONE } from "./dateUtils";
import { getPlanStartMonday } from "./workoutDateUtils";
import { normalizeWeekKey } from "./workoutPlanUtils";
import type { DayContent, WorkoutPlan } from "./types";

/**
 * A FitssAI workout plan is a fixed four-week programme:
 *
 *   Week 1 → Week 2 → Week 3 → Week 4 → completed
 *
 * It never wraps back to Week 1 and never grows a Week 5. This module is the
 * single authority on that lifecycle; Dashboard and Workout both read from it
 * so the two surfaces cannot disagree about the same plan and date.
 */
export const PLAN_TOTAL_WEEKS = 4;

export type PlanDayStatus =
  /** No plan exists (or it has no usable start date). */
  | "no-plan"
  /** The date falls before the plan's first Monday. */
  | "before-start"
  /** The date falls inside Week 1..4. */
  | "active"
  /** The date falls after Week 4 — the programme is finished. */
  | "completed";

export interface ResolvedPlanDay {
  planId: string | null;
  status: PlanDayStatus;
  /** `"Week 1".."Week 4"`, or null when the date is outside the programme. */
  weekKey: string | null;
  /** 1..4, or null when outside the programme. */
  weekNumber: number | null;
  totalWeeks: number;
  /** 0 = Monday .. 6 = Sunday, or null when outside the programme. */
  dayIndex: number | null;
  /**
   * The day's content, read from the plan's own week only. Content is never
   * borrowed from another week: an out-of-range date resolves to null rather
   * than silently showing Week 1 again.
   */
  dayData: DayContent | null;
  isRestDay: boolean;
  isCompleted: boolean;
  /** True for every status except "active". */
  isOutOfPlan: boolean;
  /** True only once the programme is finished (past Week 4). */
  planFinished: boolean;
  /** Whole days from the plan's first Monday; negative before the plan starts. */
  dayOffset: number | null;
}

export interface ResolvePlanDayOptions {
  /** Supplies completion state; kept out of this module so it stays pure. */
  isDayCompleted?: (weekKey: string, dayIndex: number) => boolean;
}

const emptyResolution = (
  status: PlanDayStatus,
  planId: string | null,
  dayOffset: number | null = null
): ResolvedPlanDay => ({
  planId,
  status,
  weekKey: null,
  weekNumber: null,
  totalWeeks: PLAN_TOTAL_WEEKS,
  dayIndex: null,
  dayData: null,
  isRestDay: false,
  isCompleted: false,
  isOutOfPlan: true,
  planFinished: status === "completed",
  dayOffset,
});

/** Read a week's days from the plan, tolerating the `Week 1` / `week1` key forms. */
const readWeek = (plan: WorkoutPlan, weekKey: string): DayContent[] => {
  const content = plan.content as Record<string, unknown> | undefined;
  if (!content) return [];
  const raw =
    content[weekKey] ?? content[weekKey.toLowerCase().replace(/\s+/g, "")];
  if (Array.isArray(raw)) return raw as DayContent[];
  if (raw && typeof raw === "object") return Object.values(raw as object) as DayContent[];
  return [];
};

/** A day with no exercises is a rest day. */
export const isRestDayContent = (day: DayContent | null | undefined): boolean =>
  !day || !Array.isArray(day.exercises) || day.exercises.length === 0;

/**
 * Resolve what a given calendar date means for a given plan.
 *
 * This is the only place the four-week boundary is enforced. Callers should
 * branch on `status` rather than re-deriving week arithmetic.
 */
export const resolvePlanDay = (
  plan: WorkoutPlan | null | undefined,
  date: Date,
  options: ResolvePlanDayOptions = {}
): ResolvedPlanDay => {
  if (!plan?.created_at) {
    return emptyResolution("no-plan", plan?.id ?? null);
  }

  const planStart = startOfDay(getPlanStartMonday(plan.created_at));
  const target = startOfDay(toZonedTime(date, TARGET_TIMEZONE));
  const dayOffset = differenceInCalendarDays(target, planStart);

  if (dayOffset < 0) {
    return emptyResolution("before-start", plan.id ?? null, dayOffset);
  }

  const weekNumber = Math.floor(dayOffset / 7) + 1;
  if (weekNumber > PLAN_TOTAL_WEEKS) {
    return emptyResolution("completed", plan.id ?? null, dayOffset);
  }

  const dayIndex = dayOffset % 7;
  const weekKey = `Week ${weekNumber}`;
  const dayData = readWeek(plan, weekKey)[dayIndex] ?? null;

  return {
    planId: plan.id ?? null,
    status: "active",
    weekKey,
    weekNumber,
    totalWeeks: PLAN_TOTAL_WEEKS,
    dayIndex,
    dayData,
    isRestDay: isRestDayContent(dayData),
    isCompleted: options.isDayCompleted?.(weekKey, dayIndex) ?? false,
    isOutOfPlan: false,
    planFinished: false,
    dayOffset,
  };
};

/** `"Woche 2 von 4"` — never exceeds the plan length. */
export const formatWeekLabel = (
  weekNumber: number | null | undefined,
  totalWeeks: number = PLAN_TOTAL_WEEKS
): string => {
  if (!weekNumber || weekNumber < 1) return `Woche 1 von ${totalWeeks}`;
  const bounded = Math.min(weekNumber, totalWeeks);
  return `Woche ${bounded} von ${totalWeeks}`;
};

/** Clamp any week key into the programme's range, for display only. */
export const clampWeekKey = (weekKey: string | null | undefined): string => {
  const normalized = normalizeWeekKey(weekKey);
  const num = Number(normalized.match(/\d+/)?.[0] ?? 1);
  return `Week ${Math.min(Math.max(num, 1), PLAN_TOTAL_WEEKS)}`;
};

/**
 * Whether the whole programme is finished as of `date` — i.e. the date sits
 * past Week 4. Used for the "4-Wochen-Plan abgeschlossen" state.
 */
export const isPlanFinished = (
  plan: WorkoutPlan | null | undefined,
  date: Date
): boolean => resolvePlanDay(plan, date).planFinished;

/**
 * Days-based week progress: how many of the week's *training days* are done.
 *
 * Rest days are excluded from the denominator — a week with three training
 * days reads "2 / 3 Tage", not "2 / 7". Exercise counts are deliberately not
 * used, so the number and its label agree on the unit.
 */
export const getWeekDayProgress = (
  plan: WorkoutPlan | null | undefined,
  weekKey: string,
  isDayCompleted: (weekKey: string, dayIndex: number) => boolean
): { completed: number; total: number } => {
  if (!plan) return { completed: 0, total: 0 };

  const days = readWeek(plan, weekKey);
  let total = 0;
  let completed = 0;

  days.forEach((day, dayIndex) => {
    if (isRestDayContent(day)) return;
    total += 1;
    if (isDayCompleted(weekKey, dayIndex)) completed += 1;
  });

  return { completed, total };
};
