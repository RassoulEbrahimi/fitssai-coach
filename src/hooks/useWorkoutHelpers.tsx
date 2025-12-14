import { useCallback } from 'react';
import { isExerciseCompleted, CompletionState } from '@/lib/completionUtils';
import { getProgressColor as getProgressColorUtil } from '@/lib/workoutPlanUtils';
import { WorkoutPlan, WeekContent, DayContent, Exercise } from '@/lib/types';

/**
 * Consolidated workout plan helper functions
 * 
 * This hook centralizes all workout plan manipulation logic to avoid duplication
 * across Dashboard, WorkoutView, and TodayWorkoutCard components.
 * 
 * @param workoutPlan - The workout plan object from the database
 * @returns Object containing all helper functions
 */
export const useWorkoutHelpers = (workoutPlan: Partial<WorkoutPlan> | null) => {
  /**
   * Get week content with fallback - mirror Week 2 to Weeks 3-4 if only Week 2 exists
   * IMPORTANT: This function only provides UI display data (exercise lists).
   * When users interact with exercises (mark complete, etc.), the actual weekKey 
   * passed to backend functions MUST be the real selected week, never the mirror source.
   */
  const getWeekContentWithFallback = useCallback((weekKey: string): DayContent[] => {
    if (!workoutPlan?.content) return [];

    const content = workoutPlan.content as Record<string, WeekContent | DayContent[]>;

    // If week exists in plan (even with empty/partial days), return it directly - no mirroring
    const existing = content[weekKey] || content[weekKey.toLowerCase().replace(' ', '')];

    // Helper to normalize content to DayContent[]
    const normalize = (c: WeekContent | DayContent[]): DayContent[] => {
      if (Array.isArray(c)) return c;
      if (typeof c === 'object') return Object.values(c);
      return [];
    };

    if (existing) return normalize(existing);

    const weekNumber = parseInt(weekKey.replace(/\D/g, ''));

    // Special fallback logic: if only Week 2 exists, keep Week 1 empty, mirror Week 2 to Weeks 3-4
    const week2 = content['Week 2'] || content['week2'];
    const week1 = content['Week 1'] || content['week1'];

    if (weekNumber === 1 && !week1 && week2) {
      // Keep Week 1 empty (return empty array) - UI only
      return [];
    }

    if ((weekNumber === 3 || weekNumber === 4) && !existing && week2) {
      // Mirror Week 2 into Weeks 3-4 - UI display only, backend still uses actual weekKey
      return normalize(week2);
    }

    // Default fallback to Week 1 - UI display only, backend still uses actual weekKey
    if (weekNumber > 1 && weekNumber <= 4 && week1) {
      return normalize(week1);
    }

    // New fallback: If weekNumber > 4, try to use Week 4, then Week 2, then Week 1
    if (weekNumber > 4) {
      const week4 = content['Week 4'] || content['week4'];
      const week3 = content['Week 3'] || content['week3'];
      return normalize(week4 || week3 || week2 || week1 || []);
    }

    return [];
  }, [workoutPlan?.content]);

  /**
   * Calculate week statistics from completion data
   * Uses the flat completion state format from completionUtils.ts
   */
  const calcWeekStats = useCallback((
    weekKey: string,
    completion: CompletionState | undefined,
  ) => {
    const week = getWeekContentWithFallback(weekKey) || [];
    let total = 0, completed = 0;

    week.forEach((day: DayContent, dayIndex: number) => {
      const exercises = day?.exercises || [];
      exercises.forEach((_ex: Exercise, exerciseIndex: number) => {
        total++;
        if (isExerciseCompleted(completion || {}, weekKey, dayIndex, exerciseIndex)) {
          completed++;
        }
      });
    });

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const missed = total - completed;
    return { completed, total, percent, missed };
  }, [getWeekContentWithFallback]);

  /**
   * Get progress ring color based on completion percentage
   * (Wrapper around pure util function for consistency)
   */
  const getProgressColor = useCallback((percent: number, isFuture: boolean) => {
    return getProgressColorUtil(percent, isFuture);
  }, []);

  /**
   * Helper function to detect mirrored weeks and get source week
   * Returns information about whether a week is displaying mirrored content
   */
  const getWeekMirrorInfo = useCallback((weekKey: string) => {
    if (!workoutPlan?.content) return {
      isMirrored: false,
      sourceWeek: null
    };
    const weekNumber = parseInt(weekKey.replace(/\D/g, ''));
    const existing = workoutPlan.content[weekKey] || workoutPlan.content[`week${weekNumber}`];

    // If week exists, it's not mirrored
    if (existing) return {
      isMirrored: false,
      sourceWeek: null
    };

    // Check if Week 2 exists and is being used as mirror source
    const week2 = workoutPlan.content['Week 2'] || workoutPlan.content['week2'];
    const week1 = workoutPlan.content['Week 1'] || workoutPlan.content['week1'];

    if (weekNumber > 4) {
      const week4 = workoutPlan.content['Week 4'] || workoutPlan.content['week4'];
      const week3 = workoutPlan.content['Week 3'] || workoutPlan.content['week3'];

      if (week4) return { isMirrored: true, sourceWeek: 4 };
      if (week3) return { isMirrored: true, sourceWeek: 3 };
      if (week2) return { isMirrored: true, sourceWeek: 2 };
      if (week1) return { isMirrored: true, sourceWeek: 1 };
    }

    if ((weekNumber === 3 || weekNumber === 4) && week2) {
      return {
        isMirrored: true,
        sourceWeek: 2
      };
    }

    // Check if Week 1 is being used as fallback
    if (weekNumber > 1 && week1) {
      return {
        isMirrored: true,
        sourceWeek: 1
      };
    }

    return {
      isMirrored: false,
      sourceWeek: null
    };
  }, [workoutPlan?.content]);

  return {
    getWeekContentWithFallback,
    calcWeekStats,
    getProgressColor,
    getWeekMirrorInfo
  };
};
