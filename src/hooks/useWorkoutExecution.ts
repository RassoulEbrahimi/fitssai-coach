import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTrainingData, useTrainingSession } from "@/contexts/TrainingContext";
import { useSetTracking } from "@/hooks/useSetTracking";
import { useWorkoutHelpers } from "@/hooks/useWorkoutHelpers";
import type { WorkoutPlan } from "@/lib/types";
import { parseActualRepsInput, parseActualWeightInput } from "@/lib/setPerformanceEntry";
import {
  SetPerformanceDraftStore,
  setPerformanceKey,
  type InvalidSetPerformanceField,
  type SetPerformanceCommit,
  type SetPerformanceField,
  type SetPerformanceInputs,
} from "@/lib/setPerformanceDrafts";
import {
  readTargetDayExercises,
  resolveExecutionTarget,
  type ExecutionExercise,
  type ExecutionSelection,
} from "@/lib/workoutExecution";

/** A tick on one planned set. Completion only - no reps, no weight. */
export interface ExecutionSetToggle {
  exerciseIndex: number;
  setNumber: number;
  completed: boolean;
}

/**
 * Performed values for one planned set, as entered. `undefined` leaves a field
 * as it is and `null` clears it. Says nothing about completion.
 */
export interface ExecutionSetPerformanceUpdate {
  exerciseIndex: number;
  setNumber: number;
  reps?: number | null;
  weightKg?: number | null;
}

export interface ExecutionSetPerformance extends SetPerformanceInputs {
  /** Commits every draft. Returns the fields that could not be saved, in plan order. */
  commitAll: () => InvalidSetPerformanceField[];
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
 * session context and set tracking and stores nothing of its own beyond the
 * unsaved text of the performance inputs.
 */
export function useWorkoutExecution(
  workoutPlan: Partial<WorkoutPlan> | null | undefined,
  selection: ExecutionSelection
) {
  const { user } = useAuth();
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
    getActualPerformance,
    toggleSet: toggleTrackedSet,
    toggleSetAsync: toggleTrackedSetAsync,
    updateSetPerformanceAsync: updateTrackedPerformanceAsync,
    whenSetWritesSettled,
    isTogglingSet,
    isLoadingSets,
  } = useSetTracking(target.planId, target.weekKey, target.dayIndex);

  /*
    Unsaved performance text, owned here - above Focus Mode's portal - and
    scoped to the account and the plan day being executed. Another account or
    another session starts with no drafts, so text typed for one is never
    written to the other.
  */
  const draftScope = JSON.stringify([user?.uid ?? null, target.planId ?? null, target.weekKey, target.dayIndex]);
  // A new store per scope is the point, not an accident of dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const drafts = useMemo(() => new SetPerformanceDraftStore(), [draftScope]);

  /*
    Performance writes go to the same target as ticks, so calendar browsing
    cannot redirect them either. They never start, pause or cancel rest: only
    completion does, and that is the card's business.
  */
  const updateSetPerformanceAsync = useCallback(async (update: ExecutionSetPerformanceUpdate) => {
    if (!target.planId) throw new Error("Missing execution plan");
    return updateTrackedPerformanceAsync({
      ...update, planId: target.planId, weekKey: target.weekKey,
      dayIndex: target.dayIndex, workoutDay: target.workoutDay,
    });
  }, [target, updateTrackedPerformanceAsync]);

  const changeDraft = useCallback((exerciseIndex: number, setNumber: number, field: SetPerformanceField, text: string) => {
    const key = setPerformanceKey(exerciseIndex, setNumber);
    const draft = drafts.get(key) ?? {};
    drafts.set(key, field === "reps"
      ? { ...draft, reps: text, repsError: undefined }
      : { ...draft, weight: text, weightError: undefined });
  }, [drafts]);

  /*
    Commits at a deliberate boundary - blur, Enter, the set's own tick, the
    finish summary - never per keystroke. Only fields the user edited are sent,
    so a stale view of the other field cannot overwrite it. Valid text is
    handed to the write; refused text stays in its field with the reason.
  */
  const commit = useCallback((exerciseIndex: number, setNumber: number): SetPerformanceCommit => {
    const key = setPerformanceKey(exerciseIndex, setNumber);
    const draft = drafts.get(key);
    if (!draft || (draft.reps === undefined && draft.weight === undefined)) return "unchanged";
    const recorded = getActualPerformance(exerciseIndex, setNumber);
    const reps = draft.reps === undefined ? undefined : parseActualRepsInput(draft.reps);
    const weight = draft.weight === undefined ? undefined : parseActualWeightInput(draft.weight);

    const update: ExecutionSetPerformanceUpdate = { exerciseIndex, setNumber };
    if (reps?.ok && reps.value !== (recorded?.reps ?? null)) update.reps = reps.value;
    if (weight?.ok && weight.value !== (recorded?.weightKg ?? null)) update.weightKg = weight.value;

    const repsError = reps && reps.ok === false ? reps.error : undefined;
    const weightError = weight && weight.ok === false ? weight.error : undefined;
    drafts.set(key, {
      ...(repsError ? { reps: draft.reps, repsError } : {}),
      ...(weightError ? { weight: draft.weight, weightError } : {}),
    });

    const changed = update.reps !== undefined || update.weightKg !== undefined;
    if (changed) {
      // A failure is reported by the action and the field shows the stored value again.
      void updateSetPerformanceAsync(update).catch(() => {});
    }
    if (repsError || weightError) return "invalid";
    return changed ? "saved" : "unchanged";
  }, [drafts, getActualPerformance, updateSetPerformanceAsync]);

  const commitAll = useCallback((): InvalidSetPerformanceField[] => {
    const invalid: InvalidSetPerformanceField[] = [];
    for (const key of drafts.keys()) {
      const [exerciseIndex, setNumber] = key.split(":").map(Number);
      if (commit(exerciseIndex, setNumber) !== "invalid") continue;
      const draft = drafts.get(key);
      if (draft?.repsError) invalid.push({ exerciseIndex, setNumber, field: "reps" });
      if (draft?.weightError) invalid.push({ exerciseIndex, setNumber, field: "weight" });
    }
    return invalid.sort((a, b) => a.exerciseIndex - b.exerciseIndex || a.setNumber - b.setNumber);
  }, [drafts, commit]);

  // Leaving the workout view with an unblurred value still saves it.
  const commitAllRef = useRef(commitAll);
  useEffect(() => { commitAllRef.current = commitAll; }, [commitAll]);
  useEffect(() => () => { commitAllRef.current(); }, []);

  const performance = useMemo<ExecutionSetPerformance>(
    () => ({ drafts, changeDraft, commit, commitAll }),
    [drafts, changeDraft, commit, commitAll]
  );

  /*
    Coordinates come from the same target that keys the set query above, so
    what is read and where a tick is written cannot drift apart. A value typed
    into the set and not yet blurred - tapping the tick does not blur an input
    on every mobile browser - is committed first, so it is neither lost nor
    applied after the completion it preceded.
  */
  const toggleSet = useCallback((toggle: ExecutionSetToggle) => {
    if (!target.planId) return;
    commit(toggle.exerciseIndex, toggle.setNumber);
    toggleTrackedSet({
      planId: target.planId,
      weekKey: target.weekKey,
      dayIndex: target.dayIndex,
      exerciseIndex: toggle.exerciseIndex,
      setNumber: toggle.setNumber,
      completed: toggle.completed,
      workoutDay: target.workoutDay,
    });
  }, [target, commit, toggleTrackedSet]);

  // Awaitable per-action result: mutate's observer callbacks can be replaced by
  // the next click. Each optimistic rest needs its own failure handler.
  const toggleSetAsync = useCallback(async (toggle: ExecutionSetToggle) => {
    if (!target.planId) throw new Error('Missing execution plan');
    commit(toggle.exerciseIndex, toggle.setNumber);
    return toggleTrackedSetAsync({
      ...toggle, planId: target.planId, weekKey: target.weekKey,
      dayIndex: target.dayIndex, workoutDay: target.workoutDay,
    });
  }, [target, commit, toggleTrackedSetAsync]);

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
    getActualPerformance,
    toggleSet,
    toggleSetAsync,
    updateSetPerformanceAsync,
    performance,
    whenSetWritesSettled,
    isTogglingSet,
    isLoadingSets,
  };
}
