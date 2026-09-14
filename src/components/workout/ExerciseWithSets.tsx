import React from "react";
import { motion } from "framer-motion";
import { ChevronDown, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import ExerciseSetRow from "./ExerciseSetRow";
import RestTimerBar from "./RestTimerBar";
import { formatRestDisplay } from "@/lib/restTimeParser";
import { buildExecutionSetViewModels, parseSetCount, type ExecutionSetViewModel } from "@/lib/workoutExecution";

interface Exercise {
  name: string;
  sets: number | string;
  reps: number | string;
  weight?: string;
  rest?: string;
}

interface RestTimerState {
  exerciseIndex: number | null;
  setNumber: number | null;
  remainingSeconds: number;
  totalRestSeconds: number;
  isComplete: boolean;
}

interface ExerciseWithSetsProps {
  exercise: Exercise;
  exerciseIndex: number;
  isSetCompleted: (exerciseIndex: number, setNumber: number) => boolean;
  getCompletedSetsCount: (exerciseIndex: number) => number;
  onToggleSet: (params: {
    exerciseIndex: number;
    setNumber: number;
    completed: boolean;
  }) => void;
  isToggling: boolean;
  defaultExpanded?: boolean;
  // Rest timer props
  timerState: RestTimerState;
  onStartTimer: (exerciseIndex: number, durationSeconds: number, setNumber?: number | null) => void;
  onSkipTimer: () => void;
  /** Cancels the rest timer only when this exact set owns it. */
  onCancelTimerForSet?: (exerciseIndex: number, setNumber: number) => void;
}

export const ExerciseWithSets: React.FC<ExerciseWithSetsProps> = ({
  exercise,
  exerciseIndex,
  isSetCompleted,
  getCompletedSetsCount,
  onToggleSet,
  isToggling,
  defaultExpanded = true,
  timerState,
  onStartTimer,
  onSkipTimer,
  onCancelTimerForSet,
}) => {
  // Parse number of sets (3 when the plan's count cannot be read)
  const totalSets = parseSetCount(exercise.sets);

  // Calculate progress
  const completedCount = getCompletedSetsCount(exerciseIndex);
  const progressPercent = totalSets > 0 ? Math.round((completedCount / totalSets) * 100) : 0;
  const isExerciseComplete = completedCount === totalSets;

  /*
    One read-only view model per planned set: the prescription as written and
    completion from set tracking. A tick reads both from here, so the timer
    starts from the same rest the row was built with.
  */
  const sets = buildExecutionSetViewModels(exercise, exerciseIndex, isSetCompleted);

  // Check if timer is active for this exercise
  const isTimerActive = timerState.exerciseIndex === exerciseIndex && 
    (timerState.remainingSeconds > 0 || timerState.isComplete);

  const handleToggleSet = (set: ExecutionSetViewModel) => {
    const willBeCompleted = !set.completed;

    // Completion only. The prescription is what the plan asked for, not what
    // was performed, so no reps or weight travel with the tick.
    onToggleSet({
      exerciseIndex,
      setNumber: set.setNumber,
      completed: willBeCompleted,
    });

    if (willBeCompleted) {
      // The timer belongs to the set that started it.
      onStartTimer(exerciseIndex, set.prescription.restSeconds, set.setNumber);
    } else {
      // Un-completing that same set cancels its timer; other sets leave it alone.
      onCancelTimerForSet?.(exerciseIndex, set.setNumber);
    }
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
        {/*
          Exercise header. A native button, not a div with role="button": the
          browser then gives Enter and Space activation for free instead of us
          re-implementing keyboard behaviour by hand. w-full/text-left keep the
          block-level look the div had, since a button shrinks to fit its
          content and centres its text.
        */}
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-3 p-4 text-left cursor-pointer hover:bg-muted/50 transition-colors",
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
            <div className="flex items-center gap-2 mt-1">
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
          <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform duration-200 collapsible-chevron" />
        </CollapsibleTrigger>

        {/* Sets list */}
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-2">
            {/* Rest Timer Bar - shown when active for this exercise */}
            {isTimerActive && (
              <RestTimerBar
                remainingSeconds={timerState.remainingSeconds}
                totalSeconds={timerState.totalRestSeconds}
                isComplete={timerState.isComplete}
                onSkip={onSkipTimer}
              />
            )}
            
            {sets.map((set) => (
              <ExerciseSetRow
                key={set.key}
                setNumber={set.setNumber}
                targetReps={set.prescription.reps}
                targetWeight={set.prescription.weight}
                isCompleted={set.completed}
                isToggling={isToggling}
                onToggle={() => handleToggleSet(set)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </motion.div>
    </Collapsible>
  );
};

export default ExerciseWithSets;
