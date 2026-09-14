import { useCallback, useMemo } from "react";
import { useTrainingData, useTrainingSession } from "@/contexts/TrainingContext";
import { useSetTracking } from "@/hooks/useSetTracking";
import { useWorkoutHelpers } from "@/hooks/useWorkoutHelpers";
import type { WorkoutPlan } from "@/lib/types";
import {
  readTargetDayExercises,
  resolveExecutionTarget,
  type ExecutionExercise,
  type ExecutionSelection,
} from "@/lib/workoutExecution";

type SetTracking = ReturnType<typeof useSetTracking>;
type ToggleSetOptions = Parameters<SetTracking["toggleSet"]>[1];

/** A tick on one planned set. Completion only - no reps, no weight. */
export interface ExecutionSetToggle {
  exerciseIndex: number;
  setNumber: number;
  completed: boolean;
}

export interface ExecutionProgress {
  totalSets: number;
  completedSets: number;
  progressPercent: number;
  isComplete: boolean;
}

/**
 * The running workout, resolved from the session rather than the calendar.
 *
 * While a session is bound, its plan day supplies the exercises (read from the
 * loaded plan, not from the selected-day cache), the set-tracking key, the
 * destination of every set write and the progress. `selection` - the day on
 * screen - applies only before a session exists: it is what the pre-start
 * preview shows and what Start binds. Browsing the calendar mid-workout
 * therefore changes nothing this hook returns.
 *
 * This is the one place execution identity is chosen. It composes the existing
 * session context and set tracking and stores nothing of its own.
 */
export function useWorkoutExecution(
  workoutPlan: Partial<WorkoutPlan> | null | undefined,
  selection: ExecutionSelection
) {
  const { todayWorkouts } = useTrainingData();
  const { session } = useTrainingSession();
  const { getWeekContentWithFallback } = useWorkoutHelpers(workoutPlan ?? null);

  const planId = workoutPlan?.id;
  const planCreatedAt = workoutPlan?.created_at;
  const { weekKey, dayIndex, workoutDay } = selection;

  const target = useMemo(
    () => resolveExecutionTarget(
      session,
      { weekKey, dayIndex, workoutDay },
      { id: planId, created_at: planCreatedAt },
    ),
    [session, weekKey, dayIndex, workoutDay, planId, planCreatedAt]
  );
  const isBound = target.source === "session";

  const boundExercises = useMemo(
    () => (isBound ? readTargetDayExercises(target, planId, getWeekContentWithFallback) : null),
    [isBound, target, planId, getWeekContentWithFallback]
  );
  // Before Start the preview follows the calendar, exactly as it always has.
  const exercises: ExecutionExercise[] = boundExercises ?? todayWorkouts;

  const {
    isSetCompleted,
    getCompletedSetsCount,
    toggleSet: toggleTrackedSet,
    toggleSetAsync: toggleTrackedSetAsync,
    isTogglingSet,
    isLoadingSets,
  } = useSetTracking(target.planId, target.weekKey, target.dayIndex);

  /*
    Coordinates come from the same target that keys the set query above, so
    what is read and where a tick is written cannot drift apart.
  */
  const toggleSet = useCallback((toggle: ExecutionSetToggle, options?: ToggleSetOptions) => {
    if (!target.planId) return;
    toggleTrackedSet({
      planId: target.planId,
      weekKey: target.weekKey,
      dayIndex: target.dayIndex,
      exerciseIndex: toggle.exerciseIndex,
      setNumber: toggle.setNumber,
      completed: toggle.completed,
      workoutDay: target.workoutDay,
    }, options);
  }, [target, toggleTrackedSet]);

  // Awaitable per-action result: mutate's observer callbacks can be replaced by
  // the next click. Each optimistic rest needs its own failure handler.
  const toggleSetAsync = useCallback(async (toggle: ExecutionSetToggle) => {
    if (!target.planId) throw new Error('Missing execution plan');
    return toggleTrackedSetAsync({
      ...toggle, planId: target.planId, weekKey: target.weekKey,
      dayIndex: target.dayIndex, workoutDay: target.workoutDay,
    });
  }, [target, toggleTrackedSetAsync]);

  /*
    Counted the way the finish summary counts them, so the header and the
    summary describe the same session with the same numbers.
  */
  const progress = useMemo<ExecutionProgress>(() => {
    let totalSets = 0;
    let completedSets = 0;

    exercises.forEach((exercise, index) => {
      const numSets = typeof exercise.sets === "number"
        ? exercise.sets
        : parseInt(String(exercise.sets), 10) || 3;
      totalSets += numSets;
      completedSets += getCompletedSetsCount(index);
    });

    const progressPercent = totalSets > 0
      ? Math.round((completedSets / totalSets) * 100)
      : 0;

    return { totalSets, completedSets, progressPercent, isComplete: progressPercent === 100 };
  }, [exercises, getCompletedSetsCount]);

  return {
    target,
    isBound,
    exercises,
    progress,
    isSetCompleted,
    getCompletedSetsCount,
    toggleSet,
    toggleSetAsync,
    isTogglingSet,
    isLoadingSets,
  };
}
