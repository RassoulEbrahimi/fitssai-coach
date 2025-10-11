import { toZonedTime, format as tzFormat } from "https://esm.sh/date-fns-tz@3.2.0";
import { addDays, startOfWeek } from "https://esm.sh/date-fns@3.6.0";

const TARGET_TIMEZONE = "Europe/Berlin";

// Week start options - Monday first (German standard)
const WEEK_OPTIONS = { weekStartsOn: 1 as const };

/**
 * Get current date in Berlin timezone
 */
export const getBerlinNow = (): Date => {
  return toZonedTime(new Date(), TARGET_TIMEZONE);
};

/**
 * Today in Berlin as YYYY-MM-DD string
 */
export const getBerlinToday = (): string => {
  const berlinNow = getBerlinNow();
  return tzFormat(berlinNow, "yyyy-MM-dd", { timeZone: TARGET_TIMEZONE });
};

/**
 * Convert UTC ISO timestamp (plan.created_at) → Berlin-local Date
 */
export const toBerlinDate = (isoDate: string): Date => {
  return toZonedTime(new Date(isoDate), TARGET_TIMEZONE);
};

/**
 * Format a Berlin-local Date as YYYY-MM-DD
 */
export const formatBerlinDate = (date: Date): string => {
  return tzFormat(date, "yyyy-MM-dd", { timeZone: TARGET_TIMEZONE });
};

/**
 * Get Monday start date of the workout plan (Berlin timezone)
 */
export const getPlanStartMonday = (planCreatedAt: string): Date => {
  const createdAt = new Date(planCreatedAt);
  const createdAtBerlin = toZonedTime(createdAt, TARGET_TIMEZONE);
  return startOfWeek(createdAtBerlin, WEEK_OPTIONS);
};

/**
 * Calculate workout date for a given week and day index (Berlin timezone)
 * @param planCreatedAt - ISO timestamp of plan creation
 * @param weekKey - Week identifier (e.g., "Week 1", "Week 2")
 * @param dayIndex - Day of week (0 = Monday, 6 = Sunday)
 * @returns Date string in YYYY-MM-DD format
 */
export const getWorkoutDateString = (
  planCreatedAt: string,
  weekKey: string,
  dayIndex: number
): string => {
  const planStart = getPlanStartMonday(planCreatedAt);
  const weekIndex = parseInt(weekKey.replace(/\D/g, ""), 10) - 1;
  const offsetDays = weekIndex * 7 + dayIndex;
  const workoutDate = addDays(planStart, offsetDays);
  return formatBerlinDate(workoutDate);
};

/**
 * Get date range for a week (Berlin timezone)
 * @param planCreatedAt - ISO timestamp of plan creation
 * @param weekKey - Week identifier (e.g., "Week 1", "Week 2")
 * @returns Object with start and end date strings (YYYY-MM-DD)
 */
export const getWeekDateRange = (
  planCreatedAt: string,
  weekKey: string
): { startStr: string; endStr: string } => {
  const planStart = getPlanStartMonday(planCreatedAt);
  const weekIndex = parseInt(weekKey.replace(/\D/g, ""), 10) - 1;
  const weekStartOffset = weekIndex * 7;
  
  const weekStartBerlin = addDays(planStart, weekStartOffset);
  const weekEndBerlin = addDays(weekStartBerlin, 6);
  
  return {
    startStr: formatBerlinDate(weekStartBerlin),
    endStr: formatBerlinDate(weekEndBerlin),
  };
};
