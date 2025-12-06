import React, { useState, useMemo, useCallback, useEffect } from "react";
import confetti from "canvas-confetti";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { isBerlinPast, isBerlinFuture } from "@/lib/dateUtils";
import { useBerlinToday } from "@/hooks/useBerlinToday";
import { Play, CheckCircle2, WifiOff, Clock, Dumbbell, Flame, Check } from "lucide-react";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { logEvent } from "@/lib/telemetryClient";
import { CompletionState, isExerciseCompleted } from "@/lib/completionUtils";
import { useWorkoutHelpers } from "@/hooks/useWorkoutHelpers";
import { useThrottledToast } from "@/hooks/useThrottledToast";
import { TodayWorkoutSkeleton } from "@/components/skeletons/TodayWorkoutSkeleton";
import { useTraining } from "@/contexts/TrainingContext";
import WorkoutDetailsDialog from "@/components/workout/WorkoutDetailsDialog";
import { estimateCalories } from "@/lib/calorieEstimation";
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
  const { todayWorkouts } = useTraining();
  
  const DEFAULT_DURATION = 10;
  
  // Format selected date for storage key
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  
  // Hero "started" state - initialized from localStorage
  const [isStarted, setIsStarted] = useState(() => {
    try {
      return localStorage.getItem(getStartedStorageKey(selectedDateStr)) === 'true';
    } catch {
      return false;
    }
  });
  
  // Sync isStarted state to localStorage when it changes
  useEffect(() => {
    try {
      if (isStarted) {
        localStorage.setItem(getStartedStorageKey(selectedDateStr), 'true');
      } else {
        localStorage.removeItem(getStartedStorageKey(selectedDateStr));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [isStarted, selectedDateStr]);
  
  // Reset isStarted when selected date changes (read from new date's storage)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getStartedStorageKey(selectedDateStr)) === 'true';
      setIsStarted(stored);
    } catch {
      setIsStarted(false);
    }
  }, [selectedDateStr]);
  
  // Workout details dialog state
  const [detailsDialog, setDetailsDialog] = useState<{
    open: boolean;
    exerciseIndex: number;
    exerciseName: string;
    estimatedCalories: number;
  }>({ open: false, exerciseIndex: -1, exerciseName: "", estimatedCalories: 50 });
  
  // Summary dialog state (must be at top level for hooks rules)
  const [showSummary, setShowSummary] = useState(false);
  
  // Session timer state
  const [duration, setDuration] = useState(0);
  
  // Timer effect - tracks workout duration while started
  useEffect(() => {
    if (!isStarted) {
      return;
    }
    
    const timerKey = getTimerStorageKey(selectedDateStr);
    
    // Get or set start time
    let startTime: number;
    try {
      const stored = localStorage.getItem(timerKey);
      if (stored) {
        startTime = parseInt(stored, 10);
      } else {
        startTime = Date.now();
        localStorage.setItem(timerKey, startTime.toString());
      }
    } catch {
      startTime = Date.now();
    }
    
    // Update duration immediately
    setDuration(Math.floor((Date.now() - startTime) / 1000));
    
    // Update every second
    const interval = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isStarted, selectedDateStr]);
  
  // Reactive Berlin "today" - updates automatically at midnight
  const berlinToday = useBerlinToday();

  // Use consolidated workout helpers hook
  const { getWeekContentWithFallback } = useWorkoutHelpers(workoutPlan);

  // Display exercises ONLY from TrainingContext (reactive to all changes)
  const exercises = todayWorkouts;
  const isRestDay = !exercises.length;

  // Handle opening the details dialog or uncompleting an exercise
  const handleExerciseClick = useCallback((exerciseIndex: number) => {
    if (!user || !workoutPlan) return;
    
    const isCurrentlyCompleted = isExerciseCompleted(completionMap, weekKey, dayIndex, exerciseIndex);
    
    if (isCurrentlyCompleted) {
      // Uncomplete immediately (no dialog needed)
      logEvent('exercise_toggle_ui', {
        weekKey,
        dayIndex,
        exerciseIndex,
        completed: false,
        completionKey: `${weekKey}_${dayIndex}_${exerciseIndex}`,
        exerciseName: exercises[exerciseIndex]?.name
      });

      toggleExerciseMutation({
        planId: workoutPlan.id,
        weekKey,
        dayIndex,
        exerciseIndex,
        completed: false
      });

      showToast(t('todayWorkout.uncompleted'));
    } else {
      // Calculate estimated calories based on exercise type
      const exerciseName = exercises[exerciseIndex]?.name || '';
      const estimatedCalories = estimateCalories(exerciseName, DEFAULT_DURATION);
      
      // Open dialog to enter duration/calories before completing
      setDetailsDialog({
        open: true,
        exerciseIndex,
        exerciseName,
        estimatedCalories
      });
    }
  }, [user, workoutPlan, completionMap, weekKey, dayIndex, exercises, toggleExerciseMutation, showToast, t]);

  // Handle confirming workout details from dialog
  const handleConfirmWorkoutDetails = useCallback((duration: number, calories: number) => {
    const { exerciseIndex } = detailsDialog;
    
    logEvent('exercise_toggle_ui', {
      weekKey,
      dayIndex,
      exerciseIndex,
      completed: true,
      completionKey: `${weekKey}_${dayIndex}_${exerciseIndex}`,
      exerciseName: exercises[exerciseIndex]?.name,
      durationMinutes: duration,
      caloriesBurned: calories
    });

    toggleExerciseMutation({
      planId: workoutPlan.id,
      weekKey,
      dayIndex,
      exerciseIndex,
      completed: true,
      durationMinutes: duration,
      caloriesBurned: calories
    });

    setDetailsDialog({ open: false, exerciseIndex: -1, exerciseName: "", estimatedCalories: 50 });
    showToast(t('todayWorkout.completed'));
  }, [detailsDialog, weekKey, dayIndex, exercises, workoutPlan, toggleExerciseMutation, showToast, t]);

  // Memoized exercise list rendering
  const exerciseListContent = useMemo(() => {
    return (exercises || []).map((exercise: any, index: number) => {
      const isCompleted = isExerciseCompleted(completionMap, weekKey, dayIndex, index);
      const displaySets = typeof exercise.sets === 'string'
        ? (parseInt(exercise.sets) || exercise.sets)
        : exercise.sets;

      return (
        <AnimatePresence mode="wait" key={index}>
          <motion.div 
            layout
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0, scale: 1 }} 
            exit={{ opacity: 0, scale: 0.95 }}
            whileTap={{ scale: 0.98 }} 
            transition={{ duration: 0.2 }}
            onClick={() => handleExerciseClick(index)} 
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleExerciseClick(index);
              }
            }}
            className="flex items-center gap-3 p-4 bg-background rounded-lg border hover:bg-muted/50 active:bg-muted/70 transition-all duration-150 cursor-pointer min-h-[56px] touch-manipulation px-[12px] py-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            role="checkbox"
            aria-checked={isCompleted}
            aria-label={`${exercise.name}, ${displaySets} Sätze, ${exercise.reps} Wiederholungen${isCompleted ? ' - abgeschlossen' : ' - offen'}`}
            tabIndex={0}
          >
            <motion.div 
              className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                isCompleted 
                  ? 'bg-green-600' 
                  : 'border-2 border-muted-foreground/30 bg-transparent'
              }`}
              initial={false}
              animate={{
                scale: isCompleted ? [1, 1.15, 1] : 1,
                backgroundColor: isCompleted ? ['#16a34a', '#22c55e', '#16a34a'] : undefined
              }}
              transition={{
                duration: 0.4,
                ease: "easeOut"
              }}
            >
              <AnimatePresence mode="wait">
                {isCompleted && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0, rotate: -90 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0, opacity: 0, rotate: 90 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-white" aria-hidden="true" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
            <div className="flex-1">
              <div className="font-medium text-sm">{exercise.name}</div>
              <div className="text-xs text-muted-foreground">
                {displaySets} Sätze × {exercise.reps} Reps
                {exercise.weight && ` • ${exercise.weight}`}
                {exercise.rest && ` • ${exercise.rest} Pause`}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      );
    });
  }, [exercises, completionMap, weekKey, dayIndex, handleExerciseClick]);

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

  // Scroll to Week Card function
  const scrollToWeekCard = () => {
    const weekCardElement = document.getElementById('weekCard');
    if (weekCardElement) {
      weekCardElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  };

  // Render skeleton loading state
  if (isLoading) {
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
  
  return (
    <WorkoutErrorBoundary>
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ duration: 0.4 }}
      >
        <Card className="border-border overflow-hidden shadow-lg">
          {/* Hero Header Section */}
          <div className="relative h-48 sm:h-56">
            <img 
              src={workoutHeroBg} 
              alt="" 
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Dark gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-black/40" />
            
            {/* Offline badge */}
            {isOfflineData && (
              <div className="absolute top-3 right-3 z-20">
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
          <CardContent className="pt-4">
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
                      {exercises.slice(0, 3).map((exercise: any, index: number) => (
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
                    onClick={() => setIsStarted(true)}
                    className="w-full mt-4 h-14 text-lg font-semibold gap-2"
                    size="lg"
                  >
                    <Play className="w-5 h-5" />
                    {t('todayWorkout.startTraining')}
                  </Button>
                </motion.div>
              ) : (
                /* Started view: full exercise list */
                <motion.div
                  key="started"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                {(() => {
                    const totalExercises = exercises.length;
                    const completedCount = exercises.filter((_: any, idx: number) => 
                      isExerciseCompleted(completionMap, weekKey, dayIndex, idx)
                    ).length;
                    const progressPercent = totalExercises > 0 
                      ? Math.round((completedCount / totalExercises) * 100) 
                      : 0;
                    const isComplete = progressPercent === 100;
                    
                    const handleFinishTraining = () => {
                      // Trigger confetti celebration (emerald colors)
                      confetti({
                        particleCount: 100,
                        spread: 70,
                        origin: { y: 0.6 },
                        colors: ['#10b981', '#34d399', '#059669']
                      });
                      
                      // Double confetti for 100% completion
                      if (isComplete) {
                        setTimeout(() => {
                          confetti({
                            particleCount: 150,
                            spread: 100,
                            origin: { y: 0.6 },
                            colors: ['#FFD700', '#FFA500', '#FF4500']
                          });
                        }, 500);
                      }
                      
                      // Show summary modal
                      setShowSummary(true);
                    };
                    
                    const handleCloseSummary = () => {
                      setShowSummary(false);
                      setIsStarted(false);
                      setDuration(0);
                      try {
                        localStorage.removeItem(getStartedStorageKey(selectedDateStr));
                        localStorage.removeItem(getTimerStorageKey(selectedDateStr));
                      } catch {
                        // Ignore localStorage errors
                      }
                      showToast(t('todayWorkout.finishMessage'));
                    };
                    
                    return (
                      <>
                        {/* Progress section */}
                        <div className="mb-4 space-y-2">
                          {/* In progress indicator */}
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2 text-primary">
                              <Flame className="w-4 h-4 animate-pulse" />
                              <span className="font-medium">{t('todayWorkout.trainingInProgress')}</span>
                              <span className="text-xs text-muted-foreground ml-1">⏱️ {formatDuration(duration)}</span>
                            </div>
                            <span className="text-muted-foreground text-xs">
                              {t('todayWorkout.progressLabel', { completed: completedCount, total: totalExercises })}
                            </span>
                          </div>
                          
                          {/* Progress bar */}
                          <Progress 
                            value={progressPercent} 
                            className="h-2 bg-muted/50"
                          />
                        </div>
                        
                        {/* Exercise list */}
                        <div className="space-y-3">
                          {exerciseListContent}
                        </div>
                        
                        {/* Finish Training Button */}
                        <Button
                          onClick={handleFinishTraining}
                          variant={isComplete ? "default" : "outline"}
                          className={`w-full mt-4 h-12 text-base font-semibold gap-2 ${
                            isComplete ? "animate-pulse" : ""
                          }`}
                        >
                          {isComplete && <Check className="w-5 h-5" />}
                          {t('todayWorkout.finishTraining')}
                        </Button>
                        
                        {/* Summary Dialog */}
                        <Dialog open={showSummary} onOpenChange={setShowSummary}>
                          <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                              <DialogTitle className="text-xl text-center">
                                {t('todayWorkout.summaryTitle')}
                              </DialogTitle>
                            </DialogHeader>
                            <div className="py-4 text-center space-y-2">
                              <p className="text-muted-foreground">
                                {t('todayWorkout.summaryBody', { completed: completedCount, total: totalExercises })}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                ⏱️ {t('todayWorkout.summaryTime')}: {formatDuration(duration)}
                              </p>
                            </div>
                            <DialogFooter className="sm:justify-center">
                              <Button onClick={handleCloseSummary} className="w-full sm:w-auto">
                                {t('todayWorkout.summaryClose')}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </>
                    );
                  })()}
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>

      {/* Workout Details Dialog */}
      <WorkoutDetailsDialog
        open={detailsDialog.open}
        onOpenChange={(open) => setDetailsDialog(prev => ({ ...prev, open }))}
        exerciseName={detailsDialog.exerciseName}
        onConfirm={handleConfirmWorkoutDetails}
        isLoading={isToggling}
        initialDuration={DEFAULT_DURATION}
        initialCalories={detailsDialog.estimatedCalories}
      />
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