import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import ExerciseSetRow from "./ExerciseSetRow";
import RestTimerBar from "./RestTimerBar";
import { parseRestTime, formatRestDisplay } from "@/lib/restTimeParser";

interface Exercise {
  name: string;
  sets: number | string;
  reps: number | string;
  weight?: string;
  rest?: string;
}

interface RestTimerState {
  exerciseIndex: number | null;
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
    repsCompleted: number;
    weightUsed: number | null;
    completed: boolean;
  }) => void;
  isToggling: boolean;
  defaultExpanded?: boolean;
  // Rest timer props
  timerState: RestTimerState;
  onStartTimer: (exerciseIndex: number, durationSeconds: number) => void;
  onSkipTimer: () => void;
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
}) => {
  // Parse number of sets
  const totalSets = useMemo(() => {
    if (typeof exercise.sets === 'number') return exercise.sets;
    const parsed = parseInt(String(exercise.sets), 10);
    return isNaN(parsed) ? 3 : parsed; // Default to 3 sets
  }, [exercise.sets]);

  // Parse target reps
  const targetReps = useMemo(() => {
    if (typeof exercise.reps === 'number') return exercise.reps;
    const parsed = parseInt(String(exercise.reps), 10);
    return isNaN(parsed) ? 10 : parsed; // Default to 10 reps
  }, [exercise.reps]);

  // Parse weight (extract numeric value)
  const weightValue = useMemo(() => {
    if (!exercise.weight) return null;
    const match = exercise.weight.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
  }, [exercise.weight]);

  // Calculate progress
  const completedCount = getCompletedSetsCount(exerciseIndex);
  const progressPercent = totalSets > 0 ? Math.round((completedCount / totalSets) * 100) : 0;
  const isExerciseComplete = completedCount === totalSets;

  // Generate set rows
  const setRows = useMemo(() => {
    return Array.from({ length: totalSets }, (_, i) => i + 1);
  }, [totalSets]);

  // Parse rest time for this exercise
  const restSeconds = useMemo(() => {
    return parseRestTime(exercise.rest);
  }, [exercise.rest]);

  // Check if timer is active for this exercise
  const isTimerActive = timerState.exerciseIndex === exerciseIndex && 
    (timerState.remainingSeconds > 0 || timerState.isComplete);

  const handleToggleSet = (setNumber: number) => {
    const isCurrentlyCompleted = isSetCompleted(exerciseIndex, setNumber);
    const willBeCompleted = !isCurrentlyCompleted;

    onToggleSet({
      exerciseIndex,
      setNumber,
      repsCompleted: targetReps,
      weightUsed: weightValue,
      completed: willBeCompleted,
    });

    // Start rest timer when a set is completed (not uncompleted)
    if (willBeCompleted) {
      onStartTimer(exerciseIndex, restSeconds);
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
        {/* Exercise Header */}
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            )}
            role="button"
            tabIndex={0}
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
          </div>
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
            
            {setRows.map((setNumber) => (
              <ExerciseSetRow
                key={setNumber}
                setNumber={setNumber}
                targetReps={targetReps}
                targetWeight={exercise.weight}
                isCompleted={isSetCompleted(exerciseIndex, setNumber)}
                isToggling={isToggling}
                onToggle={() => handleToggleSet(setNumber)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </motion.div>
    </Collapsible>
  );
};

export default ExerciseWithSets;
