import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { isBerlinPast, isBerlinFuture } from "@/lib/dateUtils";
import { useBerlinToday } from "@/hooks/useBerlinToday";
import { CalendarIcon, PencilIcon, CheckCircle2, WifiOff } from "lucide-react";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { logEvent } from "@/lib/telemetryClient";
import { toastSuccess } from "@/lib/toastWithIcon";
import { CompletionState, isExerciseCompleted } from "@/lib/completionUtils";

interface TodayWorkoutCardProps {
  selectedDate: Date;
  weekKey: string;
  dayIndex: number;
  workoutPlan: any;
  getWeekContentWithFallback: (weekKey: string) => any[];
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
  getWeekContentWithFallback,
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
  const [lastToastTime, setLastToastTime] = useState<number>(0);
  
  // Reactive Berlin "today" - updates automatically at midnight
  const berlinToday = useBerlinToday();

  // Get exercises from the same source as the week list (may be mirrored for UI display)
  const weekData = getWeekContentWithFallback(weekKey);
  const dayData = weekData[dayIndex];
  const exercises = dayData?.exercises || [];
  const isRestDay = !exercises.length;

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
            onClick={() => handleToggleExercise(index)} 
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleToggleExercise(index);
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
  }, [exercises, completionMap, weekKey, dayIndex, isToggling]);

  // Date context logic - using reactive today
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
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

  // SAFEGUARD: weekKey and dayIndex props are the real selected week/day.
  // Even if exercises are displayed from a mirrored source (week1/week2),
  // all backend operations use the actual weekKey/dayIndex passed as props.

  const handleToggleExercise = async (exerciseIndex: number) => {
    if (!user || !workoutPlan) return;
    
    // Use helper to check current completion state
    const isCurrentlyCompleted = isExerciseCompleted(completionMap, weekKey, dayIndex, exerciseIndex);
    const isNowCompleted = !isCurrentlyCompleted;

    logEvent('exercise_toggle_ui', {
      weekKey,
      dayIndex,
      exerciseIndex,
      completed: isNowCompleted,
      completionKey: `${weekKey}_${dayIndex}_${exerciseIndex}`,
      exerciseName: exercises[exerciseIndex]?.name
    });

    // Call mutation with optimistic update handled by React Query
    toggleExerciseMutation({
      planId: workoutPlan.id,
      weekKey,
      dayIndex,
      exerciseIndex,
      completed: isNowCompleted
    });

    // Show toast notification with throttle (max 1 per 2 seconds)
    const now = Date.now();
    if (now - lastToastTime >= 2000) {
      setLastToastTime(now);
      logEvent('aria_announcement_triggered', { context: 'exercise_toggle', completed: isNowCompleted });
      toastSuccess(
        isNowCompleted ? t('todayWorkout.completed') : t('todayWorkout.uncompleted'),
        undefined,
        2500
      );
    }
  };

  // Render skeleton loading state
  if (isLoading) {
    const cardTitle = getCardTitle();
    return <Card className="border-border">
        <CardHeader className="pb-4">
          <CardTitle className={cardTitle.className}>
            {cardTitle.text}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="h-4 bg-muted animate-pulse rounded" />
            <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-muted animate-pulse rounded" />
                  <div className="flex-1 h-4 bg-muted animate-pulse rounded" />
                </div>)}
            </div>
          </div>
        </CardContent>
      </Card>;
  }
  if (isRestDay) {
    const cardTitle = getCardTitle();
    return <Card className="border-border">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className={cardTitle.className}>
              {cardTitle.text}
            </CardTitle>
            {isFuture && <Button variant="ghost" size="sm" onClick={scrollToWeekCard} aria-label="Zu Wochenplan springen" className="text-xs text-muted-foreground hover:text-foreground">
                <PencilIcon className="w-4 h-4 mr-1" />
                {t('todayWorkout.goToWeekCard')}
              </Button>}
            <div className="text-right">
              <div className="text-xs text-muted-foreground">
                {format(selectedDate, 'EEEE', {
                locale: de
              })}
              </div>
              <div className="text-xs font-medium">
                {format(selectedDate, 'dd.MM.yyyy')}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">{t('todayWorkout.restDay')}</p>
          </div>
        </CardContent>
      </Card>;
  }
  const cardTitle = getCardTitle();
  
  return (
    <WorkoutErrorBoundary>
      <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        duration: 0.4
      }}>
        <Card className="border-border">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className={cardTitle.className} role="heading" aria-level={2}>
                {cardTitle.text}
              </CardTitle>
              {isOfflineData && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge 
                        variant="outline" 
                        className="text-xs bg-muted/50 border-muted-foreground/20 text-muted-foreground cursor-help"
                        aria-label="Offline gespeicherte Daten"
                      >
                        <WifiOff className="w-3 h-3 mr-1" aria-hidden="true" />
                        Offline {cacheAgeHours > 0 && `(${cacheAgeHours}h)`}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p className="text-sm">
                        Diese Daten wurden vor {cacheAgeHours > 0 ? `${cacheAgeHours} Stunden` : 'weniger als 1 Stunde'} 
                        {' '}zwischengespeichert und sind offline verfügbar. Änderungen werden synchronisiert, 
                        sobald die Verbindung wiederhergestellt ist.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            {isFuture && <Button variant="ghost" size="sm" onClick={scrollToWeekCard} aria-label="Zu Wochenplan springen" className="text-xs text-muted-foreground hover:text-foreground">
                <PencilIcon className="w-4 h-4 mr-1" />
                {t('todayWorkout.goToWeekCard')}
              </Button>}
            <div className="text-right">
              <div className="text-xs text-muted-foreground">
                {format(selectedDate, 'EEEE', {
                locale: de
              })}
              </div>
              <div className="text-xs font-medium">
                {format(selectedDate, 'dd.MM.yyyy')}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {exerciseListContent}
          </div>
        </CardContent>
      </Card>
    </motion.div>
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