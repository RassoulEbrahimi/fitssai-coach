import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import WorkoutSummaryModal from "@/components/workout/WorkoutSummaryModal";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { isBerlinPast, isBerlinFuture } from "@/lib/dateUtils";
import { useBerlinToday } from "@/hooks/useBerlinToday";
import { Play, WifiOff, Clock, Dumbbell, Flame, Check, Maximize2, Minimize2 } from "lucide-react";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import FocusModePortal from "@/components/FocusModePortal";
import { logEvent } from "@/lib/telemetryClient";
import { CompletionState } from "@/lib/completionUtils";
import { useWorkoutHelpers } from "@/hooks/useWorkoutHelpers";
import { useThrottledToast } from "@/hooks/useThrottledToast";
import { TodayWorkoutSkeleton } from "@/components/skeletons/TodayWorkoutSkeleton";
import { useTraining } from "@/contexts/TrainingContext";
import { useFocusMode } from "@/contexts/FocusModeContext";
import { useSetTracking } from "@/hooks/useSetTracking";
import { getWorkoutDateString } from "@/lib/workoutDateUtils";
import { recordSessionDuration, type SessionRecordOutcome } from "@/lib/sessionRecord";
import { useRestTimer } from "@/hooks/useRestTimer";
import ExerciseWithSets from "@/components/workout/ExerciseWithSets";
import workoutHeroBg from "@/assets/workout-hero-bg.jpg";

// Helper to get localStorage key for started state
const getStartedStorageKey = (dateStr: string) => `fitssai.workout_started_${dateStr}`;

// Helper to get localStorage key for timer start time
const getTimerStorageKey = (dateStr: string) => `fitssai.workout_timer_start_${dateStr}`;

// Format duration in mm:ss
const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

interface TodayWorkoutCardProps {
  selectedDate: Date;
  weekKey: string;
  dayIndex: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workoutPlan: any;
  mirrorInfo?: {
    isMirrored: boolean;
    sourceWeek: number | null;
  };
  completionMap: CompletionState;
  isLoading: boolean;
  toggleExercise: (params: {
    planId: string;
    weekKey: string;
    dayIndex: number;
    exerciseIndex: number;
    completed: boolean;
    durationMinutes?: number;
    caloriesBurned?: number;
  }) => void;
  isToggling: boolean;
  isOnline?: boolean;
  isCached?: boolean;
  dataUpdatedAt?: number;
}

interface Exercise {
  name: string;
  sets: number | string;
  reps: number | string;
  weight?: string;
  rest?: string;
}

/*
  Finishing has three outcomes and they are not interchangeable: the duration
  was stored, there was no trustworthy duration to store, or the write itself
  never landed. Only the last is worth retrying, and only the first may be
  reported as a saved training.
*/
const FINISH_RETRY_MESSAGE =
  'Training konnte nicht gespeichert werden. Deine Session bleibt aktiv. Bitte erneut versuchen.';
const FINISH_WITHOUT_DURATION_MESSAGE =
  'Training beendet. Die Dauer konnte nicht gemessen werden und wurde nicht gespeichert.';

const TodayWorkoutCard: React.FC<TodayWorkoutCardProps> = ({
  selectedDate,
  weekKey,
  dayIndex,
  workoutPlan,
  mirrorInfo,
  completionMap,
  isLoading,
  toggleExercise: toggleExerciseMutation,
  isToggling,
  isOnline = true,
  isCached = false,
  dataUpdatedAt,
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { showToast } = useThrottledToast();
  const { isFocusMode, setFocusMode } = useFocusMode();
  const {
    todayWorkouts,
    isStarted,
    duration,
    session,
    startSession,
    endSession,
    markFinishAttempt,
    clearFinishAttempt
  } = useTraining();

  const DEFAULT_DURATION = 10;
  // Use current live duration unless we need to freeze it (handled by modal now)
  const currentDuration = duration;

  /*
    Once the finish instant is stamped the summary shows what will actually be
    persisted, not a timer still running through a failed save and its retry.
    Before that it is the live duration, so the modal keeps ticking for anyone
    who opens it and goes back to training.
  */
  const summaryDuration = session?.endedAt !== undefined
    ? Math.max(0, Math.floor((session.endedAt - session.startedAt) / 1000))
    : currentDuration;

  // Format selected date for storage key
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');

  // NOTE: isStarted state is now managed globally in TrainingContext

  // Summary dialog state
  const [showSummary, setShowSummary] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const savingSessionRef = useRef(false);

  // Set-based tracking hook
  const {
    isSetCompleted,
    getCompletedSetsCount,
    toggleSet,
    isTogglingSet,
    isLoadingSets,
  } = useSetTracking(workoutPlan?.id, weekKey, dayIndex);

  // Rest timer hook
  const {
    timerState,
    startTimer,
    skipTimer,
    cancelTimerForSet,
  } = useRestTimer();


  // Reactive Berlin "today" - updates automatically at midnight
  const berlinToday = useBerlinToday();

  // Use consolidated workout helpers hook
  const { getWeekContentWithFallback } = useWorkoutHelpers(workoutPlan);

  // Display exercises ONLY from TrainingContext (reactive to all changes)
  const exercises = todayWorkouts as Exercise[];
  const isRestDay = !exercises.length;

  // Handle toggling a set
  const handleToggleSet = useCallback((params: {
    exerciseIndex: number;
    setNumber: number;
    repsCompleted: number;
    weightUsed: number | null;
    completed: boolean;
  }) => {
    if (!user || !workoutPlan) return;

    logEvent('set_toggle_ui', {
      weekKey,
      dayIndex,
      exerciseIndex: params.exerciseIndex,
      setNumber: params.setNumber,
      completed: params.completed,
      exerciseName: exercises[params.exerciseIndex]?.name,
    });

    toggleSet({
      planId: workoutPlan.id,
      weekKey,
      dayIndex,
      exerciseIndex: params.exerciseIndex,
      setNumber: params.setNumber,
      repsCompleted: params.repsCompleted,
      weightUsed: params.weightUsed,
      completed: params.completed,
      // The day the user is looking at, which is not always today.
      workoutDay: selectedDateStr,
    });

    if (params.completed) {
      showToast(t('todayWorkout.setCompleted', { set: params.setNumber }));
    }
  }, [user, workoutPlan, weekKey, dayIndex, selectedDateStr, exercises, toggleSet, showToast, t]);

  // Calculate total sets and completed sets for progress
  const progressStats = useMemo(() => {
    let totalSets = 0;
    let completedSets = 0;

    exercises.forEach((exercise, index) => {
      const numSets = typeof exercise.sets === 'number'
        ? exercise.sets
        : parseInt(String(exercise.sets), 10) || 3;
      totalSets += numSets;
      completedSets += getCompletedSetsCount(index);
    });

    const progressPercent = totalSets > 0
      ? Math.round((completedSets / totalSets) * 100)
      : 0;
    const isComplete = progressPercent === 100;

    return { totalSets, completedSets, progressPercent, isComplete };
  }, [exercises, getCompletedSetsCount]);

  // Date context logic - using reactive today
  const isToday = selectedDateStr === berlinToday;
  const isPast = isBerlinPast(selectedDateStr);
  const isFuture = isBerlinFuture(selectedDateStr);

  // Check if data is from offline cache
  const isOfflineData = !isOnline && isCached;

  // Calculate cache age in hours
  const cacheAgeHours = dataUpdatedAt
    ? Math.floor((Date.now() - dataUpdatedAt) / (1000 * 60 * 60))
    : 0;

  // Get contextual title and styling
  const getCardTitle = () => {
    if (isToday) return {
      text: t('todayWorkout.title'),
      className: "text-lg font-bold text-primary animate-in fade-in-0 duration-300"
    };
    if (isPast) return {
      text: t('todayWorkout.pastTitle'),
      className: "text-base text-muted-foreground/70 animate-in fade-in-0 duration-300"
    };
    if (isFuture) return {
      text: t('todayWorkout.futureTitle'),
      className: "text-base text-blue-500/80 animate-in fade-in-0 duration-300"
    };
    return {
      text: t('todayWorkout.title'),
      className: "text-lg"
    };
  };

  // Render skeleton loading state
  if (isLoading || isLoadingSets) {
    const cardTitle = getCardTitle();
    return <TodayWorkoutSkeleton title={cardTitle.text} titleClassName={cardTitle.className} />;
  }

  // Calculate estimated total duration
  const estimatedTotalMinutes = exercises.length * DEFAULT_DURATION;

  // Get workout name from plan or use default
  const workoutName = workoutPlan?.content?.name || t('todayWorkout.dailyWorkout');

  if (isRestDay) {
    return (
      <Card className="border-border overflow-hidden">
        {/* Hero header for rest day */}
        <div className="relative h-40">
          <img
            src={workoutHeroBg}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
          <div className="relative z-10 p-6 h-full flex flex-col justify-end">
            <h2 className="text-xl font-bold text-foreground">
              {t('todayWorkout.restDay').split('—')[0]}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {format(selectedDate, 'EEEE, dd.MM.yyyy', { locale: de })}
            </p>
          </div>
        </div>
        <CardContent className="pt-4">
          <div className="text-center py-4 text-muted-foreground">
            <p className="text-sm">{t('todayWorkout.restDay')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleFinishTraining = () => {
    // Show summary modal - timer continues running!
    setShowSummary(true);
  };

  const handleCloseSummary = async (shouldEndSession: boolean = false) => {
    if (savingSessionRef.current) return;
    if (!shouldEndSession) {
      // Back to training. The stamped finish instant goes with it, or the next
      // finish would be capped at the moment they first thought about stopping.
      clearFinishAttempt();
      setFinishError(null);
      setShowSummary(false);
      return;
    }

    savingSessionRef.current = true;
    setIsSavingSession(true);
    setFinishError(null);
    let outcome: SessionRecordOutcome;
    try {
      if (!user?.uid || !session) throw new Error("Missing session identity");
      /*
        Stamp when the user stopped training before anything can fail. A finish
        that is retried after a reconnect — or after a reload — then measures
        the workout instead of the wait, because every attempt reuses this same
        instant.
      */
      const endedAt = markFinishAttempt();
      if (endedAt === null) throw new Error("Missing session identity");
      if (!isOnline || !navigator.onLine) throw new Error("Offline");
      // Older bound sessions have a plan position but no captured date. Resolve
      // only against that same plan, never against the selected UI day.
      const workoutDay = session.workoutDay ?? (
        workoutPlan?.id === session.planId && workoutPlan?.created_at
          ? getWorkoutDateString(workoutPlan.created_at, session.weekKey, session.dayIndex)
          : undefined
      );
      if (!workoutDay) throw new Error("Missing session date");
      outcome = await recordSessionDuration({
        uid: user.uid,
        planId: session.planId,
        weekKey: session.weekKey,
        dayIndex: session.dayIndex,
        workoutDay,
        startedAt: session.startedAt,
        endedAt,
      });
    } catch (error) {
      // The write did not land — a rejection, or no connection to attempt it
      // over. Session, timer and stamped finish instant all stay put so the
      // same finish can be retried, and nothing claims to have been saved.
      logEvent('session_duration_write_failed', {
        weekKey: session?.weekKey,
        dayIndex: session?.dayIndex,
        message: error instanceof Error ? error.message : String(error),
      });
      setFinishError(FINISH_RETRY_MESSAGE);
      showToast(FINISH_RETRY_MESSAGE, 'error');
      return;
    } finally {
      savingSessionRef.current = false;
      setIsSavingSession(false);
    }

    /*
      Both outcomes that get here are terminal. `written` stored the
      measurement; `skipped` established there was no measurement worth
      storing — a session left running past MAX_SESSION_SEC, or metadata the
      writer will not accept. Neither improves by being retried, and holding
      the session open for a retry that cannot succeed would strand the user in
      a workout they can never end. So the session ends either way, and only a
      written duration is reported as one.
    */
    endSession();
    setShowSummary(false);
    setFocusMode(false);
    if (outcome.status === "written") {
      showToast(t('todayWorkout.finishMessage'));
      return;
    }
    logEvent('session_ended_without_duration', {
      weekKey: session?.weekKey,
      dayIndex: session?.dayIndex,
      reason: outcome.reason,
    });
    showToast(FINISH_WITHOUT_DURATION_MESSAGE, 'info');
  };

  // Handle starting training - also enables fullscreen
  const handleStartTraining = () => {
    // Bind the session to this exact plan day so a reload resumes the same
    // workout instead of re-attaching to whatever day is shown.
    if (workoutPlan?.id) {
      startSession({ planId: workoutPlan.id, weekKey, dayIndex, workoutDay: selectedDateStr });
    } else {
      startSession();
    }
    setFocusMode(true);
  };

  // Toggle fullscreen mode
  const toggleFullScreen = () => {
    setFocusMode(!isFocusMode);
  };

  return (
    <WorkoutErrorBoundary>
      <FocusModePortal active={isFocusMode}>
      <div
        className={
          isFocusMode
            ? "fixed inset-0 w-screen h-[100dvh] z-[99999] bg-background m-0 p-0 overflow-y-auto overscroll-contain"
            : ""
        }
        style={isFocusMode ? { isolation: 'isolate' } : undefined}
      >
        <Card className={
          isFocusMode
            ? "border-0 rounded-none shadow-none min-h-full bg-background pt-[env(safe-area-inset-top)]"
            : "border-border overflow-hidden shadow-lg"
        }>
          {/* Hero Header Section */}
          <div className={isFocusMode ? "relative h-32 sm:h-40" : "relative h-48 sm:h-56"}>
            <img
              src={workoutHeroBg}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/*
              Fixed dark scrim, not theme tokens. `from-background` resolves to
              white in light mode, so the white hero text sat on a white
              gradient and disappeared. The photo needs a dark scrim in both
              themes for the same white-on-image treatment to read.
            */}
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-zinc-950/70 to-zinc-900/40" />

            {/* Fullscreen toggle button - top right */}
            <button
              onClick={toggleFullScreen}
              className="absolute top-3 right-3 z-30 p-2 rounded-full bg-black/50 text-white/90 backdrop-blur-sm hover:bg-black/70 transition-colors"
              aria-label={isFocusMode ? "Vollbild beenden" : "Vollbild"}
            >
              {isFocusMode ? (
                <Minimize2 className="w-5 h-5" />
              ) : (
                <Maximize2 className="w-5 h-5" />
              )}
            </button>

            {/* Offline badge - positioned below fullscreen toggle */}
            {isOfflineData && (
              <div className="absolute top-14 right-3 z-20">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="text-xs bg-black/50 border-white/20 text-white/90 backdrop-blur-sm cursor-help"
                        aria-label="Offline gespeicherte Daten"
                      >
                        <WifiOff className="w-3 h-3 mr-1" aria-hidden="true" />
                        Offline {cacheAgeHours > 0 && `(${cacheAgeHours}h)`}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p className="text-sm">
                        Diese Daten wurden vor {cacheAgeHours > 0 ? `${cacheAgeHours} Stunden` : 'weniger als 1 Stunde'}
                        {' '}zwischengespeichert und sind offline verfügbar.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            {/* Hero content */}
            <div className="relative z-10 p-6 h-full flex flex-col justify-end">
              {/* Date badge */}
              <Badge
                variant="secondary"
                className="w-fit mb-2 bg-primary/30 text-white border-none backdrop-blur-sm"
              >
                {format(selectedDate, 'EEEE', { locale: de })}
              </Badge>

              {/* Workout title */}
              <h2 className="text-2xl sm:text-3xl font-bold text-white drop-shadow-lg">
                {workoutName}
              </h2>

              {/* Metadata row */}
              <div className="flex items-center gap-4 mt-2 text-white/90 text-sm">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  <span>{t('todayWorkout.estimatedDuration', { mins: estimatedTotalMinutes })}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Dumbbell className="w-4 h-4" />
                  <span>{t('todayWorkout.exercisesCount', { count: exercises.length })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Content Section */}
          <CardContent className={`pt-4 ${isFocusMode ? 'px-4 pb-safe' : ''}`}>
            <AnimatePresence mode="wait">
              {!isStarted ? (
                /* Pre-start view: blurred exercises preview + Start button */
                <motion.div
                  key="pre-start"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Blurred preview of exercises */}
                  <div className="relative">
                    <div className="space-y-2 blur-[2px] opacity-50 pointer-events-none select-none max-h-32 overflow-hidden">
                      {exercises.slice(0, 3).map((exercise: Exercise, index: number) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg"
                        >
                          <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />
                          <div className="flex-1">
                            <div className="h-4 w-32 bg-muted rounded" />
                            <div className="h-3 w-24 bg-muted/50 rounded mt-1" />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
                  </div>

                  {/* Start Training Button */}
                  <Button
                    onClick={handleStartTraining}
                    className="w-full mt-4 h-14 text-lg font-semibold gap-2"
                    size="lg"
                  >
                    <Play className="w-5 h-5" />
                    {t('todayWorkout.startTraining')}
                  </Button>
                </motion.div>
              ) : (
                /* Started view: set-based exercise list */
                <motion.div
                  key="started"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Progress section */}
                  <div className="mb-4 space-y-2">
                    {/* In progress indicator */}
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-primary">
                        <Flame className="w-4 h-4 animate-pulse" />
                        <span className="font-medium">{t('todayWorkout.trainingInProgress')}</span>
                        <span className="text-xs text-muted-foreground ml-1">⏱️ {formatDuration(currentDuration)}</span>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {progressStats.completedSets}/{progressStats.totalSets} Sätze
                      </span>
                    </div>

                    {/* Progress bar */}
                    <Progress
                      value={progressStats.progressPercent}
                      className="h-2 bg-muted/50"
                    />
                  </div>

                  {/* Set-based exercise list */}
                  <div className="space-y-3">
                    {exercises.map((exercise: Exercise, index: number) => (
                      <ExerciseWithSets
                        key={index}
                        exercise={exercise}
                        exerciseIndex={index}
                        isSetCompleted={isSetCompleted}
                        getCompletedSetsCount={getCompletedSetsCount}
                        onToggleSet={handleToggleSet}
                        isToggling={isTogglingSet}
                        defaultExpanded={index === 0}
                        timerState={timerState}
                        onStartTimer={startTimer}
                        onSkipTimer={skipTimer}
                        onCancelTimerForSet={cancelTimerForSet}
                      />
                    ))}
                  </div>

                  {/* Finish Training Button */}
                  <Button
                    onClick={handleFinishTraining}
                    variant={progressStats.isComplete ? "default" : "outline"}
                    className={`w-full mt-4 h-12 text-base font-semibold gap-2 ${progressStats.isComplete ? "animate-pulse" : ""
                      }`}
                  >
                    {progressStats.isComplete && <Check className="w-5 h-5" />}
                    {t('todayWorkout.finishTraining')}
                  </Button>

                  {/* Summary Modal */}
                  <WorkoutSummaryModal
                    open={showSummary}
                    isSaving={isSavingSession}
                    error={finishError}
                    onClose={() => handleCloseSummary(false)} // User dismissed without finishing
                    onFinish={() => handleCloseSummary(true)} // User clicked "Terminate/Save" in modal
                    exercises={exercises}
                    duration={summaryDuration}
                    workoutName={workoutName}
                    selectedDate={selectedDate}
                    getCompletedSetsCount={getCompletedSetsCount}
                    isSetCompleted={isSetCompleted}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>
      </FocusModePortal>
    </WorkoutErrorBoundary>
  );
};

export default React.memo(TodayWorkoutCard, (prev, next) => {
  return (
    prev.selectedDate === next.selectedDate &&
    prev.weekKey === next.weekKey &&
    prev.dayIndex === next.dayIndex &&
    prev.completionMap === next.completionMap &&
    prev.isLoading === next.isLoading &&
    prev.isToggling === next.isToggling &&
    prev.isOnline === next.isOnline &&
    prev.workoutPlan?.id === next.workoutPlan?.id
  );
});
