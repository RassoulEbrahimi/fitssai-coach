import { addDays, startOfWeek, startOfDay, differenceInCalendarDays, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { TARGET_TIMEZONE, WEEK_OPTIONS, getBerlinToday } from "./dateUtils";

/**
 * Get Monday start date of the workout plan (Berlin timezone)
 * This is the anchor point for all workout plan date calculations
 */
export const getPlanStartMonday = (planCreatedAt: string): Date => {
  const createdAt = new Date(planCreatedAt);
  const createdAtBerlin = toZonedTime(createdAt, TARGET_TIMEZONE);
  return startOfWeek(createdAtBerlin, WEEK_OPTIONS);
};

/**
 * Convert weekKey + dayIndex → calendar date
 * @param planCreatedAt - ISO timestamp of when the plan was created
 * @param weekKey - Week identifier (e.g., "Week 1", "Week 2")
 * @param dayIndex - Day of week (0 = Monday, 6 = Sunday)
 * @returns Date object for the workout day
 */
export const getWorkoutDate = (
  planCreatedAt: string,
  weekKey: string,
  dayIndex: number
): Date => {
  const planStart = getPlanStartMonday(planCreatedAt);
  const weekIndex = parseInt(weekKey.replace(/\D/g, ""), 10) - 1;
  const offsetDays = weekIndex * 7 + dayIndex;
  return addDays(planStart, offsetDays);
};

/** A FitssAI plan is a fixed four-week programme. */
export const PLAN_WEEKS = 4;

/**
 * Convert calendar date → weekKey + dayIndex within the four-week programme.
 *
 * `weekKey` is always inside `Week 1..Week 4` so no caller can render a
 * "Woche 43" label or look up a week the plan does not have. The raw
 * arithmetic is still reported through `weekNumber`, and the two boundary
 * flags say which side of the programme the date fell on — callers that need
 * the lifecycle decision should use `resolvePlanDay` in `planLifecycle.ts`
 * rather than re-deriving it from these fields.
 */
export const getWorkoutWeekDay = (
  planCreatedAt: string,
  date: Date
): {
  weekKey: string;
  dayIndex: number;
  /** Unclamped week number: may be < 1 or > PLAN_WEEKS. */
  weekNumber: number;
  isBeforeStart: boolean;
  isAfterPlan: boolean;
} => {
  const planStart = startOfDay(getPlanStartMonday(planCreatedAt));
  const dateBerlin = startOfDay(toZonedTime(date, TARGET_TIMEZONE));

  const daysDiff = differenceInCalendarDays(dateBerlin, planStart);
  const weekNumber = Math.floor(daysDiff / 7) + 1;
  const isBeforeStart = daysDiff < 0;
  const isAfterPlan = weekNumber > PLAN_WEEKS;

  const boundedWeek = Math.min(Math.max(weekNumber, 1), PLAN_WEEKS);
  // Guard the modulo: it is negative for dates before the plan starts.
  const rawDayIndex = ((daysDiff % 7) + 7) % 7;

  return {
    weekKey: `Week ${boundedWeek}`,
    dayIndex: isBeforeStart ? 0 : Math.max(0, Math.min(6, rawDayIndex)),
    weekNumber,
    isBeforeStart,
    isAfterPlan,
  };
};

/**
 * Calculate workout date string for database operations
 * @param planCreatedAt - ISO timestamp of when the plan was created
 * @param weekKey - Week identifier (e.g., "Week 1", "Week 2")
 * @param dayIndex - Day of week (0 = Monday, 6 = Sunday)
 * @returns Date string in YYYY-MM-DD format for database queries
 */
export const getWorkoutDateString = (
  planCreatedAt: string,
  weekKey: string,
  dayIndex: number
): string => {
  const date = getWorkoutDate(planCreatedAt, weekKey, dayIndex);
  // Convert to Berlin timezone before formatting to ensure correct date
  const berlinDate = toZonedTime(date, TARGET_TIMEZONE);
  return format(berlinDate, 'yyyy-MM-dd');
};

/**
 * Check if a specific week/day combination is today in Berlin timezone
 * This is the centralized "is today" function used across the app
 * @param planCreatedAt - ISO timestamp of when the plan was created
 * @param weekKey - Week identifier (e.g., "Week 1", "Week 2")
 * @param dayIndex - Day of week (0 = Monday, 6 = Sunday)
 * @returns true if the workout day is today in Berlin timezone
 */
export const isBerlinTodayForWeekDay = (
  planCreatedAt: string,
  weekKey: string,
  dayIndex: number
): boolean => {
  const workoutDateStr = getWorkoutDateString(planCreatedAt, weekKey, dayIndex);
  const todayStr = getBerlinToday();
  return workoutDateStr === todayStr;
};

/**
 * The seven calendar dates (Monday…Sunday) of the real week containing `date`.
 *
 * This is the *calendar display* authority and is deliberately independent of
 * the plan: `getWorkoutDate` answers "which real day is plan week N, day M",
 * which is a different question and is anchored to `created_at`. Deriving the
 * calendar strip from the plan is what made a plan created in November 2025
 * render "Nov. 2025" forever, because `getWorkoutWeekDay` clamps any date past
 * the programme onto Week 4.
 *
 * `date` must already carry Berlin wall-clock fields — that is what
 * `getBerlinNow()` returns and what the app stores as the selected date — so
 * no further timezone conversion happens here and none is needed.
 */
export const getCalendarWeekDates = (date: Date): Date[] => {
  const monday = startOfWeek(startOfDay(date), WEEK_OPTIONS);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
};

/** Weekday of `date` as a Monday-based index (0 = Monday … 6 = Sunday). */
export const getCalendarDayIndex = (date: Date): number => {
  const dayStart = startOfDay(date);
  const monday = startOfWeek(dayStart, WEEK_OPTIONS);
  return differenceInCalendarDays(dayStart, monday);
};

/** YYYY-MM-DD for a Berlin wall-clock date, for comparison against today. */
export const toCalendarDateString = (date: Date): string =>
  format(date, "yyyy-MM-dd");

/** True when `date` is today in Berlin. */
export const isCalendarToday = (date: Date): boolean =>
  toCalendarDateString(date) === getBerlinToday();

/** Shift a selected date by whole calendar weeks, keeping the weekday. */
export const shiftCalendarWeeks = (date: Date, weeks: number): Date =>
  addDays(startOfDay(date), weeks * 7);
