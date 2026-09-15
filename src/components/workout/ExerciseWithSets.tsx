import React from "react";
import { motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import ExerciseThumbnail from "./ExerciseThumbnail";
import "./workoutPresentation.css";
import ExerciseSetRow from "./ExerciseSetRow";
import RestTimerBar from "./RestTimerBar";
import ExerciseGuidanceDialog from "./ExerciseGuidanceDialog";
import { formatRestDisplay } from "@/lib/restTimeParser";
import { buildExecutionSetViewModels, parseSetCount, type ExecutionSetViewModel } from "@/lib/workoutExecution";
import { formatWorkoutDayDate, type PreviousExercisePerformance } from "@/lib/previousPerformance";
import type { ActualSetPerformance } from "@/lib/setPerformance";
import type { SetPerformanceInputs } from "@/lib/setPerformanceDrafts";
import type { RestTimerController } from "@/hooks/useRestTimer";

interface Exercise {
  name: string;
  sets: number | string;
  reps: number | string;
  weight?: string;
  rest?: string;
}

interface ExerciseWithSetsProps {
  exercise: Exercise;
  exerciseIndex: number;
  isSetCompleted: (exerciseIndex: number, setNumber: number) => boolean;
  getCompletedSetsCount: (exerciseIndex: number) => number;
  /** Recorded performance for a set; trusted values only. */
  getActualPerformance?: (exerciseIndex: number, setNumber: number) => ActualSetPerformance | undefined;
  /** The previous recorded occurrence of this exercise, if one is known. Read only. */
  getPreviousExercise?: (exerciseIndex: number) => PreviousExercisePerformance | undefined;
  onToggleSet: (params: {
    exerciseIndex: number;
    setNumber: number;
    completed: boolean;
  }) => void;
  isToggling: boolean;
  /** Actual reps/weight entry. Independent of completion and rest. */
  performance?: SetPerformanceInputs;
  defaultExpanded?: boolean;
  // Rest timer props
  timerState: RestTimerController['timerState'];
  isRestSheetOpen: boolean;
  onOpenRest: () => void;
}

export const ExerciseWithSets: React.FC<ExerciseWithSetsProps> = ({
  exercise,
  exerciseIndex,
  isSetCompleted,
  getCompletedSetsCount,
  getActualPerformance,
  getPreviousExercise,
  onToggleSet,
  isToggling,
  performance,
  defaultExpanded = true,
  timerState,
  isRestSheetOpen,
  onOpenRest,
}) => {
  // Parse number of sets (3 when the plan's count cannot be read)
  const totalSets = parseSetCount(exercise.sets);

  // Calculate progress
  const completedCount = getCompletedSetsCount(exerciseIndex);
  const progressPercent = totalSets > 0 ? Math.round((completedCount / totalSets) * 100) : 0;
  const isExerciseComplete = completedCount === totalSets;

  /*
    One view model per planned set: the prescription as written, completion
    from set tracking and recorded performance, kept apart. The card
    coordinates rest and persistence using this same session-bound exercise.
  */
  // Last time is a reference beside today's inputs, so it only appears with them.
  const previous = performance ? getPreviousExercise?.(exerciseIndex) : undefined;
  const sets = buildExecutionSetViewModels(exercise, exerciseIndex, isSetCompleted, getActualPerformance, previous);
  const showsPrevious = !!previous && sets.some((set) => set.previous !== null);

  // Check if timer is active for this exercise
  const isTimerActive = timerState.exerciseIndex === exerciseIndex &&
    timerState.remainingSeconds > 0;

  const handleToggleSet = (set: ExecutionSetViewModel) => {
    const willBeCompleted = !set.completed;

    // Completion only. The prescription is what the plan asked for, not what
    // was performed, so no reps or weight travel with the tick.
    onToggleSet({
      exerciseIndex,
      setNumber: set.setNumber,
      completed: willBeCompleted,
    });
  };

  return (
    <Collapsible defaultOpen={defaultExpanded}>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={cn(
          "workout-exercise-unit rounded-xl border overflow-hidden transition-colors",
          isExerciseComplete
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-background"
        )}
      >
        {/* Layout per card width lives in workoutPresentation.css. */}
        <div className="workout-exercise-header p-3 sm:p-4">
          <ExerciseThumbnail name={exercise.name} />
          <h3 className="workout-exercise-title text-base font-semibold leading-snug sm:text-lg">
            {exercise.name}
          </h3>
          <div className="workout-exercise-meta">
            <div className="flex flex-wrap items-center gap-x-2 text-xs leading-5 text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {isExerciseComplete && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                {completedCount}/{totalSets} Sätze
                {isExerciseComplete && <span className="sr-only">abgeschlossen</span>}
              </span>
              {exercise.rest && <span>{formatRestDisplay(exercise.rest, { withLabel: true })}</span>}
            </div>
            <Progress value={progressPercent} className="mt-1 h-1 bg-muted/60" />
          </div>
          {/* Separate 44px sibling controls; neither takes width from the title. */}
          <div className="workout-exercise-actions flex items-center">
            <CollapsibleTrigger
              aria-label={`${exercise.name} ${completedCount}/${totalSets} Sätze`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <ChevronDown aria-hidden="true" className="h-5 w-5 collapsible-chevron" />
            </CollapsibleTrigger>
            <ExerciseGuidanceDialog exerciseName={exercise.name} disabled={isRestSheetOpen} />
          </div>
        </div>

        {isTimerActive && !isRestSheetOpen && (
          <div className="px-3 pb-3 sm:px-4">
            <RestTimerBar
              remainingSeconds={timerState.remainingSeconds}
              setNumber={timerState.setNumber!}
              isPaused={timerState.status === 'paused'}
              onOpen={onOpenRest}
            />
          </div>
        )}
        {/* Sets list */}
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-1 sm:px-4 sm:pb-4">
            {/* The previous workout's date, once per exercise rather than on every row. */}
            {showsPrevious && previous && (
              <p className="text-xs text-muted-foreground">
                Zuletzt am {formatWorkoutDayDate(previous.workoutDay)}
              </p>
            )}

            {sets.map((set) => (
              <ExerciseSetRow
                key={set.key}
                exerciseIndex={exerciseIndex}
                setNumber={set.setNumber}
                targetReps={set.prescription.reps}
                targetWeight={set.prescription.weight}
                isCompleted={set.completed}
                isToggling={isToggling}
                onToggle={() => handleToggleSet(set)}
                actual={set.actual}
                performance={performance}
                previous={set.previous}
              />
            ))}
          </div>
        </CollapsibleContent>
      </motion.div>
    </Collapsible>
  );
};

export default ExerciseWithSets;
