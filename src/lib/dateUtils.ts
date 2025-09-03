import { format, startOfWeek, endOfWeek, isSameDay, isAfter, isBefore, addDays } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { de } from "date-fns/locale";

// Target timezone for all date calculations
export const TARGET_TIMEZONE = "Europe/Berlin";

// Week start options - Monday first (German standard)
export const WEEK_OPTIONS = { weekStartsOn: 1 as const };

// DE-only mode: Always use German locale
export const getDateLocale = () => {
  return de; // German locale for all date formatting
};

/**
 * Get current date in Berlin timezone
 */
export const getBerlinNow = (): Date => {
  return toZonedTime(new Date(), TARGET_TIMEZONE);
};

/**
 * Get today's date as YYYY-MM-DD string in Berlin timezone
 */
export const getBerlinToday = (): string => {
  const berlinNow = getBerlinNow();
  return format(berlinNow, 'yyyy-MM-dd');
};

/**
 * Get current week boundaries (Monday-Sunday) in Berlin timezone
 */
export const getBerlinCurrentWeek = () => {
  const berlinNow = getBerlinNow();
  const start = startOfWeek(berlinNow, WEEK_OPTIONS); // Monday
  const end = endOfWeek(berlinNow, WEEK_OPTIONS); // Sunday
  
  return {
    start,
    end,
    startStr: format(start, 'yyyy-MM-dd'),
    endStr: format(end, 'yyyy-MM-dd')
  };
};

/**
 * Convert a date string (YYYY-MM-DD) to a Berlin timezone date
 */
export const dateToBerlin = (dateStr: string): Date => {
  const date = new Date(dateStr + 'T00:00:00');
  return toZonedTime(date, TARGET_TIMEZONE);
};

/**
 * Check if a date string represents today in Berlin timezone
 */
export const isBerlinToday = (dateStr: string): boolean => {
  const berlinToday = getBerlinToday();
  return dateStr === berlinToday;
};

/**
 * Check if a date string represents a future day in Berlin timezone
 */
export const isBerlinFuture = (dateStr: string): boolean => {
  const berlinToday = getBerlinToday();
  return dateStr > berlinToday;
};

/**
 * Check if a date string represents a past day in Berlin timezone
 */
export const isBerlinPast = (dateStr: string): boolean => {
  const berlinToday = getBerlinToday();
  return dateStr < berlinToday;
};

/**
 * Get week boundaries for a specific date in Berlin timezone
 */
export const getWeekBoundaries = (date: Date) => {
  const berlinDate = toZonedTime(date, TARGET_TIMEZONE);
  const start = startOfWeek(berlinDate, WEEK_OPTIONS);
  const end = endOfWeek(berlinDate, WEEK_OPTIONS);
  
  return {
    start,
    end,
    startStr: format(start, 'yyyy-MM-dd'),
    endStr: format(end, 'yyyy-MM-dd')
  };
};

/**
 * Format date for display with German locale
 */
export const formatDateForDisplay = (date: Date, formatStr: string): string => {
  const locale = getDateLocale(); // Always German
  return format(date, formatStr, { locale });
};

/**
 * Generate days array for a week starting from Monday
 */
export const getWeekDays = (startDate: Date): Array<{ date: Date; dateStr: string }> => {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(startDate, i);
    days.push({
      date,
      dateStr: format(date, 'yyyy-MM-dd')
    });
  }
  return days;
};