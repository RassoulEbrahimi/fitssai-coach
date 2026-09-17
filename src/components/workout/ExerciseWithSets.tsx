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
import { formatExerciseMuscleSubtitle } from "@/lib/exerciseMuscleSummary";
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
  /**
   * Whether this exercise's sets are open. Controlled: the running session owns
   * the one open exercise, so this card keeps no open state of its own.
   */
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
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
  isExpanded,
  onExpandedChange,
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
  // What the exercise trains, in at most two words. An unknown name has no line.
  const muscleSubtitle = formatExerciseMuscleSubtitle(exercise.name);

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
    <Collapsible open={isExpanded} onOpenChange={onExpandedChange}>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        data-complete={isExerciseComplete ? "" : undefined}
        className={cn(
          "workout-exercise-unit rounded-xl border overflow-hidden transition-colors",
          isExerciseComplete
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-background"
        )}
      >
        {/* One identity block beside the thumbnail. Layout per card width lives in workoutPresentation.css. */}
        <div className="workout-exercise-header p-3 sm:p-4">
          <ExerciseThumbnail name={exercise.name} />
          <div className="workout-exercise-identity">
            <h3 className="workout-exercise-title text-base font-semibold leading-snug sm:text-lg">
              {exercise.name}
            </h3>
            <div className="workout-exercise-meta">
              {/*
                What the exercise trains, not how it is programmed: sets and
                rest are on every set row and in the collapse control's name
                (TRAINING-UI-06). An exercise the repository does not know keeps
                the line out rather than filling it with something invented.
              */}
              {(isExerciseComplete || muscleSubtitle) && (
                <p className="workout-exercise-facts text-xs leading-5 text-muted-foreground">
                  {isExerciseComplete && (
                    <>
                      <Check className="mr-1 inline h-3.5 w-3.5 align-[-3px]" aria-hidden="true" />
                      <span className="sr-only">abgeschlossen</span>
                    </>
                  )}
                  {muscleSubtitle}
                </p>
              )}
              {/* The collapse control's name states the progress; the bar only draws it. */}
              <Progress value={progressPercent} aria-hidden="true" className="mt-1 h-1 bg-muted/60" />
            </div>
          </div>
          {/*
            One 44px column: Info above collapse, in the same order for the
            keyboard, so collapse comes right before the sets it controls.
            Sibling controls; neither is nested in the other.
          */}
          <div className="workout-exercise-actions">
            <ExerciseGuidanceDialog exerciseName={exercise.name} disabled={isRestSheetOpen} />
            <CollapsibleTrigger
              aria-label={`${exercise.name} ${completedCount}/${totalSets} Sätze`}
              className="workout-exercise-toggle flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 focus-visible:outline-none"
            >
              <ChevronDown aria-hidden="true" className="workout-exercise-chevron h-5 w-5" />
            </CollapsibleTrigger>
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
        {/* Sets list: rows of this exercise, divided rather than carded. */}
        <CollapsibleContent>
          <div className="border-t border-border/60 pb-1">
            {/* The previous workout's date, once per exercise rather than on every row. */}
            {showsPrevious && previous && (
              <p className="px-3 pt-2 text-xs text-muted-foreground sm:px-4">
                Zuletzt am {formatWorkoutDayDate(previous.workoutDay)}
              </p>
            )}

            <div className="divide-y divide-border/60">
              {sets.map((set) => (
                <ExerciseSetRow
                  key={set.key}
                  exerciseIndex={exerciseIndex}
                  setNumber={set.setNumber}
                  targetReps={set.prescription.reps}
                  targetWeight={set.prescription.weight}
                  rest={exercise.rest}
                  isCompleted={set.completed}
                  isToggling={isToggling}
                  onToggle={() => handleToggleSet(set)}
                  actual={set.actual}
                  performance={performance}
                  previous={set.previous}
                />
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </motion.div>
    </Collapsible>
  );
};

export default ExerciseWithSets;
