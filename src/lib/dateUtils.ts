import { format, startOfWeek, endOfWeek, isSameDay, isAfter, isBefore, addDays } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { enUS, faIR } from "date-fns/locale";

// Target timezone for all date calculations
export const TARGET_TIMEZONE = "Europe/Berlin";

// Locale mapping for date-fns
export const getDateLocale = (language: string) => {
  switch (language) {
    case 'fa':
      return faIR;
    case 'en':
      return enUS;
    default:
      return enUS; // German uses default date-fns behavior
  }
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
  const start = startOfWeek(berlinNow, { weekStartsOn: 1 }); // Monday
  const end = endOfWeek(berlinNow, { weekStartsOn: 1 }); // Sunday
  
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
  const start = startOfWeek(berlinDate, { weekStartsOn: 1 });
  const end = endOfWeek(berlinDate, { weekStartsOn: 1 });
  
  return {
    start,
    end,
    startStr: format(start, 'yyyy-MM-dd'),
    endStr: format(end, 'yyyy-MM-dd')
  };
};

/**
 * Format date for display with proper locale
 */
export const formatDateForDisplay = (date: Date, formatStr: string, language: string): string => {
  const locale = getDateLocale(language);
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