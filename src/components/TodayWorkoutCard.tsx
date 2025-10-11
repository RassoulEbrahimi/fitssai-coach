import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { isBerlinToday, isBerlinPast, isBerlinFuture } from "@/lib/dateUtils";
import { CalendarIcon, PencilIcon, CheckCircle2, WifiOff } from "lucide-react";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { logEvent } from "@/lib/telemetryClient";

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
  completionMap: Record<string, boolean>;
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
}) => {
  const {
    t
  } = useTranslation();
  const {
    user
  } = useAuth();
  const {
    toast
  } = useToast();
  const [lastToastTime, setLastToastTime] = useState<number>(0);

  // Get exercises from the same source as the week list (may be mirrored for UI display)
  const weekData = getWeekContentWithFallback(weekKey);
  const dayData = weekData[dayIndex];
  const exercises = dayData?.exercises || [];
  const isRestDay = !exercises.length;

  // Date context logic
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const isToday = isBerlinToday(selectedDateStr);
  const isPast = isBerlinPast(selectedDateStr);
  const isFuture = isBerlinFuture(selectedDateStr);

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
    
    const exerciseKey = `${exerciseIndex}`;
    const isNowCompleted = !completionMap[exerciseKey];

    logEvent('exercise_toggle_ui', {
      weekKey,
      dayIndex,
      exerciseIndex,
      completed: isNowCompleted,
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
      toast({
        title: isNowCompleted ? t('todayWorkout.completed') : t('todayWorkout.uncompleted'),
        duration: 2500,
        role: "alert",
        className: "animate-in slide-in-from-top-2 fade-in-0"
      });
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
            <CardTitle className={cardTitle.className} role="heading" aria-level={2}>
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
          <div className="space-y-3">
            {exercises.map((exercise: any, index: number) => {
            const exerciseKey = `${index}`;
            const isCompleted = completionMap[exerciseKey] || false;
            return <motion.div 
              key={index} 
              initial={{ scale: 1 }} 
              animate={{ scale: 1 }} 
              whileTap={{ scale: 0.98 }} 
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
              aria-label={`${exercise.name}, ${exercise.sets} Sätze, ${exercise.reps} Wiederholungen${isCompleted ? ' - abgeschlossen' : ' - offen'}`}
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
                      scale: isCompleted ? [1, 1.2, 1] : 1,
                      opacity: isCompleted ? [1, 1, 1] : 1
                    }}
                    transition={{
                      duration: 0.3,
                      ease: "easeOut"
                    }}
                  >
                    {isCompleted && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                      </motion.div>
                    )}
                  </motion.div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{exercise.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {exercise.sets} Sätze × {exercise.reps} Reps
                      {exercise.weight && ` • ${exercise.weight}`}
                      {exercise.rest && ` • ${exercise.rest} Pause`}
                    </div>
                  </div>
                </motion.div>;
          })}
          </div>
        </CardContent>
      </Card>
    </motion.div>
    </WorkoutErrorBoundary>
  );
};

export default React.memo(TodayWorkoutCard);