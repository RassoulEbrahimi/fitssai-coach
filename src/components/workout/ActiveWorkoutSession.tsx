import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Flame, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import ExerciseWithSets from "@/components/workout/ExerciseWithSets";
import type { useRestTimer } from "@/hooks/useRestTimer";
import type { ExecutionProgress, ExecutionSetToggle } from "@/hooks/useWorkoutExecution";
import type { ActualSetPerformance } from "@/lib/setPerformance";
import type { PreviousExercisePerformance } from "@/lib/previousPerformance";
import type { SetPerformanceInputs } from "@/lib/setPerformanceDrafts";
import type { ExecutionExercise } from "@/lib/workoutExecution";
import "./workoutPresentation.css";

// Format duration in mm:ss
const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// The same elapsed time as an ISO 8601 duration, for <time dateTime>.
const formatIsoDuration = (seconds: number): string =>
  `PT${Math.floor(seconds / 60)}M${seconds % 60}S`;

type RestTimer = Pick<
  ReturnType<typeof useRestTimer>,
  "timerState" | "isSheetOpen" | "setSheetOpen"
>;

interface ActiveWorkoutSessionProps {
  /** The session-bound plan day's exercises, in plan order. */
  exercises: ExecutionExercise[];
  progress: ExecutionProgress;
  durationSeconds: number;
  isSetCompleted: (exerciseIndex: number, setNumber: number) => boolean;
  getCompletedSetsCount: (exerciseIndex: number) => number;
  /** What was recorded as performed, per set. Trusted values only. */
  getActualPerformance?: (exerciseIndex: number, setNumber: number) => ActualSetPerformance | undefined;
  /** What was recorded the last time each exercise was trained. A read-only reference. */
  getPreviousExercise?: (exerciseIndex: number) => PreviousExercisePerformance | undefined;
  onToggleSet: (toggle: ExecutionSetToggle) => void;
  isTogglingSet: boolean;
  /** Actual reps/weight entry, bound to the same session as the ticks. */
  performance?: SetPerformanceInputs;
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
  getActualPerformance,
  getPreviousExercise,
  onToggleSet,
  isTogglingSet,
  performance,
  rest,
  onFinish,
}) => {
  const { t } = useTranslation();
  /*
    The one open exercise, by its position in the running day - the same
    identity set writes and the rest timer use. It lives here, not in the
    cards, so opening one closes the other without two components holding an
    opinion about it. `null` is all closed, which is a normal state.

    Only presentation: drafts, recorded values and the rest timer are owned by
    TodayWorkoutCard above Focus Mode's portal, so collapsing an exercise puts
    nothing at risk.
  */
  const [expandedExercise, setExpandedExercise] = React.useState<number | null>(0);

  return (
    <div className="workout-session mx-auto w-full max-w-3xl">
      {/*
        Session status: state, elapsed time and set count on one line, the
        session progress below. Layout per width lives in workoutPresentation.css.
        Hidden commas keep the facts apart when read aloud.
      */}
      <div className="workout-session-status mb-3">
        <div className="workout-session-line">
          <span className="workout-session-state flex items-center gap-1.5 text-sm font-semibold text-primary">
            <Flame className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('todayWorkout.trainingInProgress')}
          </span>
          <span className="workout-session-duration flex items-center gap-1 whitespace-nowrap text-sm font-medium tabular-nums">
            <Timer className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">, {t('todayWorkout.sessionDuration')} </span>
            <time dateTime={formatIsoDuration(durationSeconds)}>{formatDuration(durationSeconds)}</time>
          </span>
          {/* The count states the progress; the bar below carries it as a percentage. */}
          <span className="workout-session-count whitespace-nowrap text-xs font-medium tabular-nums text-muted-foreground">
            <span className="sr-only">, </span>
            {progress.completedSets}/{progress.totalSets} Sätze
          </span>
        </div>
        <Progress
          value={progress.progressPercent}
          aria-label={t('todayWorkout.sessionProgress')}
          className="mt-1.5 h-1.5 bg-muted"
        />
      </div>

      {/* Set-based exercise list */}
      <div className="workout-session-list space-y-3">
        {exercises.map((exercise, index) => (
          <ExerciseWithSets
            key={index}
            exercise={exercise}
            exerciseIndex={index}
            isSetCompleted={isSetCompleted}
            getCompletedSetsCount={getCompletedSetsCount}
            getActualPerformance={getActualPerformance}
            getPreviousExercise={getPreviousExercise}
            onToggleSet={onToggleSet}
            isToggling={isTogglingSet}
            performance={performance}
            isExpanded={expandedExercise === index}
            onExpandedChange={(expanded) => setExpandedExercise(expanded ? index : null)}
            timerState={rest.timerState}
            isRestSheetOpen={rest.isSheetOpen}
            onOpenRest={() => rest.setSheetOpen(true)}
          />
        ))}
      </div>

      {/*
        The one finish control, at the end of the workout in DOM, tab order and
        on screen. It scrolls with the list rather than sitting at the bottom of
        the viewport, so training is not shadowed by a control for ending it
        (TRAINING-UI-06). It only opens the summary; nothing is saved until that
        is confirmed. Primary whether or not every set is done: an unfinished
        workout can be finished too, so completion adds a check and nothing else.
      */}
      <div className="workout-finish">
        <Button
          onClick={onFinish}
          className="h-[3.25rem] w-full gap-2 text-base font-semibold"
        >
          {progress.isComplete && <Check aria-hidden="true" />}
          {t('todayWorkout.finishTraining')}
        </Button>
      </div>
    </div>
  );
};

export default ActiveWorkoutSession;
