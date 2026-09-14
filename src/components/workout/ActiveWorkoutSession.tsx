import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import ExerciseWithSets from "@/components/workout/ExerciseWithSets";
import type { useRestTimer } from "@/hooks/useRestTimer";
import type { ExecutionProgress, ExecutionSetToggle } from "@/hooks/useWorkoutExecution";
import type { ExecutionExercise } from "@/lib/workoutExecution";

// Format duration in mm:ss
const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

type RestTimer = Pick<
  ReturnType<typeof useRestTimer>,
  "timerState" | "startTimer" | "skipTimer" | "cancelTimerForSet"
>;

interface ActiveWorkoutSessionProps {
  /** The session-bound plan day's exercises, in plan order. */
  exercises: ExecutionExercise[];
  progress: ExecutionProgress;
  durationSeconds: number;
  isSetCompleted: (exerciseIndex: number, setNumber: number) => boolean;
  getCompletedSetsCount: (exerciseIndex: number) => number;
  onToggleSet: (toggle: ExecutionSetToggle) => void;
  isTogglingSet: boolean;
  /**
   * The rest timer. The card owns it, above Focus Mode's portal, so entering
   * or leaving fullscreen - which remounts this subtree - does not reset a
   * running countdown. This prop is where a rest controller plugs in.
   */
  rest: RestTimer;
  onFinish: () => void;
}

/**
 * The running workout: in-progress header, the bound day's exercise list and
 * the finish control. Presentation only - execution identity, set writes, the
 * rest timer and the finish flow all arrive as props from TodayWorkoutCard.
 */
export const ActiveWorkoutSession: React.FC<ActiveWorkoutSessionProps> = ({
  exercises,
  progress,
  durationSeconds,
  isSetCompleted,
  getCompletedSetsCount,
  onToggleSet,
  isTogglingSet,
  rest,
  onFinish,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Progress section */}
      <div className="mb-4 space-y-2">
        {/* In progress indicator */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-primary">
            <Flame className="w-4 h-4 animate-pulse" />
            <span className="font-medium">{t('todayWorkout.trainingInProgress')}</span>
            <span className="text-xs text-muted-foreground ml-1">⏱️ {formatDuration(durationSeconds)}</span>
          </div>
          <span className="text-muted-foreground text-xs">
            {progress.completedSets}/{progress.totalSets} Sätze
          </span>
        </div>

        {/* Progress bar */}
        <Progress
          value={progress.progressPercent}
          className="h-2 bg-muted/50"
        />
      </div>

      {/* Set-based exercise list */}
      <div className="space-y-3">
        {exercises.map((exercise, index) => (
          <ExerciseWithSets
            key={index}
            exercise={exercise}
            exerciseIndex={index}
            isSetCompleted={isSetCompleted}
            getCompletedSetsCount={getCompletedSetsCount}
            onToggleSet={onToggleSet}
            isToggling={isTogglingSet}
            defaultExpanded={index === 0}
            timerState={rest.timerState}
            onStartTimer={rest.startTimer}
            onSkipTimer={rest.skipTimer}
            onCancelTimerForSet={rest.cancelTimerForSet}
          />
        ))}
      </div>

      {/* Finish Training Button */}
      <Button
        onClick={onFinish}
        variant={progress.isComplete ? "default" : "outline"}
        className={`w-full mt-4 h-12 text-base font-semibold gap-2 ${progress.isComplete ? "animate-pulse" : ""}`}
      >
        {progress.isComplete && <Check className="w-5 h-5" />}
        {t('todayWorkout.finishTraining')}
      </Button>
    </>
  );
};

export default ActiveWorkoutSession;
