import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { isBerlinToday, isBerlinPast, isBerlinFuture } from "@/lib/dateUtils";
import { CalendarIcon, PencilIcon, CheckCircle2 } from "lucide-react";
interface TodayWorkoutCardProps {
  selectedDate: Date;
  weekKey: string;
  dayIndex: number;
  workoutPlan: any;
  getWeekContentWithFallback: (weekKey: string) => any[];
  onProgressUpdate?: () => void;
  mirrorInfo?: {
    isMirrored: boolean;
    sourceWeek: number | null;
  };
}
const TodayWorkoutCard: React.FC<TodayWorkoutCardProps> = ({
  selectedDate,
  weekKey,
  dayIndex,
  workoutPlan,
  getWeekContentWithFallback,
  onProgressUpdate,
  mirrorInfo
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
  const [completionMap, setCompletionMap] = useState<Record<string, boolean>>({});
  const [lastToastTime, setLastToastTime] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [optimisticUpdates, setOptimisticUpdates] = useState<Record<string, boolean>>({});

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
      className: "text-lg text-primary"
    };
    if (isPast) return {
      text: t('todayWorkout.pastTitle'),
      className: "text-base text-muted-foreground"
    };
    if (isFuture) return {
      text: t('todayWorkout.futureTitle'),
      className: "text-base text-blue-400"
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

  const loadCompletionMap = async () => {
    if (!user || !workoutPlan) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const {
        data,
        error
      } = await supabase.functions.invoke('get-today-workout', {
        body: {
          weekKey,
          // Real selected week - used for fetching completion status
          dayIndex,
          // Real selected day - used for fetching completion status
          planId: workoutPlan.id
        }
      });
      if (error) {
        console.error('Error loading completion map:', error);
        return;
      }
      if (data.success) {
        setCompletionMap(data.completionMap || {});
      }
    } catch (error) {
      console.error('Error loading completion map:', error);
    } finally {
      setLoading(false);
    }
  };
  const toggleExercise = async (exerciseIndex: number) => {
    if (!user || !workoutPlan) return;
    const exerciseKey = `${exerciseIndex}`;
    const isNowCompleted = !(completionMap[exerciseKey] || optimisticUpdates[exerciseKey]);

    // Optimistic update
    setOptimisticUpdates(prev => ({
      ...prev,
      [exerciseKey]: isNowCompleted
    }));
    try {
      // CRITICAL: Always use the actual passed weekKey and dayIndex for backend operations,
      // never the mirror source (week1/week2). This ensures completion logs are recorded
      // for the real selected week, even if UI displays mirrored content.
      const {
        data,
        error
      } = await supabase.functions.invoke('toggle-exercise', {
        body: {
          planId: workoutPlan.id,
          weekKey,
          // Real selected week - never the mirror source
          dayIndex,
          // Real selected day - never the mirror source
          exerciseIndex,
          completed: isNowCompleted
        }
      });
      if (error || !data.success) {
        // Revert optimistic update on error
        setOptimisticUpdates(prev => {
          const newUpdates = {
            ...prev
          };
          delete newUpdates[exerciseKey];
          return newUpdates;
        });
        console.error('Error toggling exercise:', error);
        return;
      }

      // Update completion map
      setCompletionMap(prev => ({
        ...prev,
        [exerciseKey]: isNowCompleted
      }));

      // Clear optimistic update
      setOptimisticUpdates(prev => {
        const newUpdates = {
          ...prev
        };
        delete newUpdates[exerciseKey];
        return newUpdates;
      });
      onProgressUpdate?.();
      console.log('Exercise toggled successfully:', {
        exerciseIndex,
        completed: isNowCompleted,
        weekKey,
        dayIndex
      });
    } catch (error) {
      console.error('Error toggling exercise:', error);
      // Revert optimistic update on error
      setOptimisticUpdates(prev => {
        const newUpdates = {
          ...prev
        };
        delete newUpdates[exerciseKey];
        return newUpdates;
      });
    }
  };
  useEffect(() => {
    loadCompletionMap();
  }, [weekKey, dayIndex, workoutPlan, user]);
  if (loading) {
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
  return <motion.div initial={{
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
          <div className="p-3 pt-2 px-[8px] py-[7px]">
            {/* Column headers */}
            <div className="px-3 py-1.5 border-b border-border/50">
              <div className="grid grid-cols-[1fr_48px_64px] gap-2 text-xs text-muted-foreground font-medium items-baseline">
                <span>Übung</span>
                <span className="text-center tabular-nums">Sätze</span>
                <span className="text-right tabular-nums">Reps</span>
              </div>
            </div>
            
            {/* Exercise list */}
            <div className="space-y-1 pt-2">
              {exercises.map((exercise: any, index: number) => {
              const exerciseKey = `${index}`;
              const isCompleted = optimisticUpdates[exerciseKey] !== undefined ? optimisticUpdates[exerciseKey] : completionMap[exerciseKey] || false;
              return <motion.div key={index} initial={{
                scale: 1
              }} animate={{
                scale: 1
              }} whileTap={{
                scale: 0.98
              }} onClick={() => toggleExercise(index)} className="grid grid-cols-[1fr_48px_64px] gap-2 p-3 bg-background rounded-md border shadow-sm min-h-[48px] items-center cursor-pointer hover:bg-muted/50 active:bg-muted/70 transition-all duration-150 touch-manipulation">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="font-bold text-sm min-w-0 truncate">
                        {exercise.name}
                      </div>
                    </div>
                    <div className="text-center text-xs tabular-nums font-medium">
                      {exercise.sets}
                    </div>
                    <div className="text-right text-xs tabular-nums font-medium leading-tight max-w-full overflow-hidden">
                      {exercise.reps}
                    </div>
                  </motion.div>;
            })}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>;
};
export default TodayWorkoutCard;