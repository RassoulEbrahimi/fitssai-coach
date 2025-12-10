import React, { useState, useMemo, useEffect } from "react";
import confetti from "canvas-confetti";
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
import { logEvent } from "@/lib/telemetryClient";
import { CompletionState } from "@/lib/completionUtils";
import { useWorkoutHelpers } from "@/hooks/useWorkoutHelpers";
import { useThrottledToast } from "@/hooks/useThrottledToast";
import { TodayWorkoutSkeleton } from "@/components/skeletons/TodayWorkoutSkeleton";
import { useTraining } from "@/contexts/TrainingContext";
import { useFocusMode } from "@/contexts/FocusModeContext";
import { useSetTracking } from "@/hooks/useSetTracking";
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
    startSession,
    endSession
  } = useTraining();

  const DEFAULT_DURATION = 10;
  // Use current live duration unless we need to freeze it (handled by modal now)
  const currentDuration = duration;

  // Format selected date for storage key
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');

  // NOTE: isStarted state is now managed globally in TrainingContext

  // Summary dialog state
  const [showSummary, setShowSummary] = useState(false);

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
  } = useRestTimer();

  // Reactive Berlin "today" - updates automatically at midnight
  const berlinToday = useBerlinToday();

  // Use consolidated workout helpers hook
  const { getWeekContentWithFallback } = useWorkoutHelpers(workoutPlan);

  // Display exercises ONLY from TrainingContext (reactive to all changes)
  const exercises = todayWorkouts as Exercise[];
  const isRestDay = !exercises.length;

  // Handle toggling a set
  const handleToggleSet = (params: {
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
    });

    if (params.completed) {
      showToast(t('todayWorkout.setCompleted', { set: params.setNumber }));
    }
  };

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

    // Trigger confetti if complete
    if (progressStats.isComplete) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#10b981', '#34d399', '#059669'],
        zIndex: 100001
      });
    }
  };

  const handleCloseSummary = (shouldEndSession: boolean = false) => {
    setShowSummary(false);

    if (shouldEndSession) {
      endSession();
      setFocusMode(false);
      showToast(t('todayWorkout.finishMessage'));
    }
  };

  // Handle starting training - also enables fullscreen
  const handleStartTraining = () => {
    startSession();
    setFocusMode(true);
  };

  // Toggle fullscreen mode
  const toggleFullScreen = () => {
    setFocusMode(!isFocusMode);
  };

  return (
    <WorkoutErrorBoundary>
      <div
        className={
          isFocusMode
            ? "fixed top-0 left-0 w-screen h-[100dvh] z-[99999] bg-background m-0 p-0 overflow-y-auto overscroll-contain"
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
            {/* Dark gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-black/40" />

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
                className="w-fit mb-2 bg-primary/20 text-primary-foreground border-none backdrop-blur-sm"
              >
                {format(selectedDate, 'EEEE', { locale: de })}
              </Badge>

              {/* Workout title */}
              <h2 className="text-2xl sm:text-3xl font-bold text-white drop-shadow-lg">
                {workoutName}
              </h2>

              {/* Metadata row */}
              <div className="flex items-center gap-4 mt-2 text-white/80 text-sm">
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
                    onClose={() => handleCloseSummary(false)} // User dismissed without finishing
                    onFinish={() => handleCloseSummary(true)} // User clicked "Terminate/Save" in modal
                    exercises={exercises}
                    duration={currentDuration}
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
    prev.workoutPlan?.id === next.workoutPlan?.id
  );
});
