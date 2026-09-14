import React from "react";
import { motion } from "framer-motion";
import { ChevronDown, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import ExerciseSetRow from "./ExerciseSetRow";
import RestTimerBar from "./RestTimerBar";
import ExerciseGuidanceDialog from "./ExerciseGuidanceDialog";
import { formatRestDisplay } from "@/lib/restTimeParser";
import { buildExecutionSetViewModels, parseSetCount, type ExecutionSetViewModel } from "@/lib/workoutExecution";
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
  const sets = buildExecutionSetViewModels(exercise, exerciseIndex, isSetCompleted, getActualPerformance);

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
          "rounded-lg border overflow-hidden transition-all",
          isExerciseComplete
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-background"
        )}
      >
        {/* Sibling controls keep collapse and guidance independently operable. */}
        <div className="flex items-center">
        <CollapsibleTrigger
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 p-3 text-left cursor-pointer hover:bg-muted/50 transition-colors sm:gap-3 sm:p-4",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          )}
        >
          {/* Icon */}
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
            isExerciseComplete
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}>
            <Dumbbell className="w-5 h-5" />
          </div>

          {/* Exercise info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn(
                "font-medium text-sm truncate",
                isExerciseComplete && "text-primary"
              )}>
                {exercise.name}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 mt-1">
              <span className="text-xs text-muted-foreground">
                {completedCount}/{totalSets} Sätze
              </span>
              {exercise.rest && (
                <span className="text-xs text-muted-foreground">
                  • {formatRestDisplay(exercise.rest, { withLabel: true })}
                </span>
              )}
            </div>
            {/* Mini progress bar */}
            <Progress
              value={progressPercent}
              className="h-1 mt-2 bg-muted/50"
            />
          </div>

          {/* Expand indicator */}
          <ChevronDown className="w-5 h-5 shrink-0 text-muted-foreground transition-transform duration-200 collapsible-chevron" />
        </CollapsibleTrigger>
        <ExerciseGuidanceDialog exerciseName={exercise.name} disabled={isRestSheetOpen} />
        </div>

        {isTimerActive && !isRestSheetOpen && (
          <div className="px-4 pb-3">
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
          <div className="px-3 pb-3 space-y-2 sm:px-4 sm:pb-4">

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
              />
            ))}
          </div>
        </CollapsibleContent>
      </motion.div>
    </Collapsible>
  );
};

export default ExerciseWithSets;
