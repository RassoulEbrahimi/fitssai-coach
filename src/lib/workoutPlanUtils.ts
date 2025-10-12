/**
 * Pure utility functions for workout plan operations
 * These functions have no React dependencies and can be used anywhere
 */

/**
 * Normalize week key to consistent format "Week N"
 * @param key - Week key in any format (e.g., "week1", "Week 1", "WEEK1")
 * @returns Normalized week key (e.g., "Week 1")
 */
export const normalizeWeekKey = (key?: string | null): string => {
  const num = String(key ?? 'Week 1').match(/\d+/)?.[0];
  return `Week ${num ?? 1}`;
};

/**
 * Get progress ring color based on completion percentage
 * @param percent - Completion percentage (0-100)
 * @param isFuture - Whether the week/day is in the future
 * @returns Tailwind color class
 */
export const getProgressColor = (percent: number, isFuture: boolean): string => {
  if (isFuture) return 'text-muted-foreground/50';
  if (percent === 100) return 'text-emerald-500';
  if (percent > 0) return 'text-amber-500';
  return 'text-red-500';
};
