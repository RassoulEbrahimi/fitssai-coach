import type { PreviousExercisePerformance, PreviousSetPerformance } from "@/lib/previousPerformance";
import type { RecordedExercisePerformance } from "@/lib/workoutExecution";
import type { RecordedSetLine } from "@/lib/setPerformanceEntry";

export interface SetCompletionComparison {
  setNumber: number;
  today: RecordedSetLine;
  previous: PreviousSetPerformance;
  delta: { reps: number | null; weightKg: number | null };
}

export interface ExerciseCompletionComparison {
  exerciseIndex: number;
  name: string;
  previousWorkoutDay: string;
  sets: SetCompletionComparison[];
}

/**
 * Read-only comparison of buildRecordedPerformance's explicit current values
 * with the execution hook's already-resolved trusted previous occurrence.
 * No history lookup or identity resolution: match the same set number, then
 * subtract only metrics present on both sides. Open recorded sets count too.
 */
export const buildWorkoutCompletionComparison = (
  recorded: readonly RecordedExercisePerformance[],
  getPreviousExercise: (exerciseIndex: number) => PreviousExercisePerformance | undefined,
): ExerciseCompletionComparison[] => recorded.flatMap((exercise) => {
  const previous = getPreviousExercise(exercise.exerciseIndex);
  if (!previous) return [];
  const sets = exercise.sets.flatMap((today): SetCompletionComparison[] => {
    const last = previous.sets[today.setNumber];
    if (!last) return [];
    const reps = today.reps !== null && last.reps !== null ? today.reps - last.reps : null;
    // Recorded kg use two decimals. Round subtraction noise, not input values.
    const weightKg = today.weightKg !== null && last.weightKg !== null
      ? Math.round((today.weightKg - last.weightKg) * 100) / 100
      : null;
    if (reps === null && weightKg === null) return [];
    return [{ setNumber: today.setNumber, today: { ...today }, previous: { ...last }, delta: { reps, weightKg } }];
  });
  return sets.length > 0
    ? [{ exerciseIndex: exercise.exerciseIndex, name: exercise.name, previousWorkoutDay: previous.workoutDay, sets }]
    : [];
});
