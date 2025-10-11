import { addDays, startOfWeek, differenceInCalendarDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { TARGET_TIMEZONE, WEEK_OPTIONS } from "./dateUtils";

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

/**
 * Convert calendar date → weekKey + dayIndex
 * @param planCreatedAt - ISO timestamp of when the plan was created
 * @param date - The date to convert
 * @returns Object with weekKey and dayIndex, clamped to valid ranges (Week 1-4, day 0-6)
 */
export const getWorkoutWeekDay = (
  planCreatedAt: string,
  date: Date
): { weekKey: string; dayIndex: number } => {
  const planStart = getPlanStartMonday(planCreatedAt);
  const daysDiff = differenceInCalendarDays(date, planStart);
  const weekIndex = Math.floor(daysDiff / 7);
  const dayIndex = daysDiff % 7;
  
  return {
    weekKey: `Week ${Math.max(1, Math.min(4, weekIndex + 1))}`,
    dayIndex: Math.max(0, Math.min(6, dayIndex)),
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
  return date.toISOString().split('T')[0];
};
