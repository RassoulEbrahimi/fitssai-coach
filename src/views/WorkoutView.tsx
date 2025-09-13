import React, { useState, useRef, useEffect, Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import ExerciseListSkeleton from "@/components/skeletons/ExerciseListSkeleton";

const ExerciseList = React.lazy(() => import("@/views/ExerciseList"));

interface WorkoutViewProps {
  workoutPlan: any;
  workoutLogs: any[];
  completingWorkout: number | null;
  activeWeek: string | null;
  currentWeekProgress: { completed: number; total: number };
  activeDayIndex?: number;
  
  // Helper functions
  getTodayWorkout: () => any;
  findNextWorkoutInCurrentWeek: () => any;
  findNextWorkoutAcrossWeeks: () => any;
  isDayCompleted: (weekKey: string, dayIndex: number) => boolean;
  isDayInFuture: (weekKey: string, dayIndex: number) => boolean;
  isTodayInWeekDay: (weekKey: string, dayIndex: number) => boolean;
  getDateFor: (weekKey: string, dayIndex: number) => Date | null;
  getWeekTitle: (weekKey: string) => string;
  getWeekProgress: (weekKey: string) => { completed: number; total: number };
  getWeeklyProgress: () => { completed: number; total: number };
  
  // Actions
  toggleDayComplete: (weekKey: string, dayIndex: number) => void;
  setActiveWeek: (weekKey: string | null) => void;
  setActiveDayIndex?: (dayIndex: number) => void;
}

const WorkoutView: React.FC<WorkoutViewProps> = React.memo(({
  workoutPlan,
  workoutLogs,
  completingWorkout,
  activeWeek,
  currentWeekProgress,
  activeDayIndex = 0,
  getTodayWorkout,
  findNextWorkoutInCurrentWeek,
  findNextWorkoutAcrossWeeks,
  isDayCompleted,
  isDayInFuture,
  isTodayInWeekDay,
  getDateFor,
  getWeekTitle,
  getWeekProgress,
  getWeeklyProgress,
  toggleDayComplete,
  setActiveWeek,
  setActiveDayIndex
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const dayRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  
  // Hoisted function declaration to avoid temporal dead zone
  function normalizeWeekKey(key?: string | null) {
    const num = String(key ?? 'week1').match(/\d+/)?.[0];
    return `week${num ?? 1}`;
  }

  // Canonical week key used everywhere in this component
  const wk = normalizeWeekKey(activeWeek);
  
  // Robust week number for titles like "Woche 3"
  const currentWeekNum = Number(wk.match(/\d+/)?.[0] ?? 1);
  const [focusedWeek, setFocusedWeek] = useState<number>(currentWeekNum);

  // URL deep-linking helpers
  const parseHashQuery = () => {
    const hash = window.location.hash;
    const match = hash.match(/[#/?]workout\?(.+)/);
    if (!match) return { w: null, d: null };
    
    const params = new URLSearchParams(match[1]);
    const w = params.get('w');
    const d = params.get('d');
    
    return {
      w: w && /^[1-4]$/.test(w) ? parseInt(w) : null,
      d: d && /^[0-6]$/.test(d) ? parseInt(d) : null
    };
  };

  const updateHash = (weekNum: number, dayIndex: number) => {
    const newHash = `#/workout?w=${weekNum}&d=${dayIndex}`;
    if (window.location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  };

  // Parse URL on mount and update state accordingly
  useEffect(() => {
    const { w, d } = parseHashQuery();
    
    if (w !== null && w >= 1 && w <= 4) {
      const weekKey = `week${w}`;
      if (activeWeek !== weekKey) {
        setActiveWeek(weekKey);
      }
    }
    
    if (d !== null && d >= 0 && d <= 6) {
      if (activeDayIndex !== d) {
        setActiveDayIndex?.(d);
      }
    }
  }, []); // Only run on mount

  // Update hash whenever activeWeek or activeDayIndex changes
  useEffect(() => {
    const weekNum = Number(wk.match(/\d+/)?.[0] ?? 1);
    updateHash(weekNum, activeDayIndex);
  }, [activeWeek, activeDayIndex, wk]);


  // Handle week navigation
  const handlePrevWeek = () => {
    if (currentWeekNum > 1) {
      setActiveWeek(normalizeWeekKey(`week${currentWeekNum - 1}`));
    }
  };

  const handleNextWeek = () => {
    if (currentWeekNum < 4) {
      setActiveWeek(normalizeWeekKey(`week${currentWeekNum + 1}`));
    }
  };

  // Handle day click in calendar
  const handleDayClick = (dayIndex: number) => {
    setActiveDayIndex?.(dayIndex);
    setExpandedDay(dayIndex);
    
    // Smooth scroll to day in list
    setTimeout(() => {
      const dayElement = dayRefs.current[dayIndex];
      if (dayElement && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dayElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  // Handle week activation with animation
  const handleWeekActivation = (weekNum: number) => {
    setActiveWeek(normalizeWeekKey(`week${weekNum}`));
    
    // Optional haptic feedback on mobile
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(8);
      } catch (e) {
        // Ignore vibration errors
      }
    }
  };

  // Handle keyboard navigation in stepper
  const handleStepperKeyDown = (e: React.KeyboardEvent, weekNum: number) => {
    const weeks = [1, 2, 3, 4];
    const currentIndex = weeks.indexOf(weekNum);
    
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        if (currentIndex > 0) {
          setFocusedWeek(weeks[currentIndex - 1]);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (currentIndex < weeks.length - 1) {
          setFocusedWeek(weeks[currentIndex + 1]);
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleWeekActivation(weekNum);
        break;
    }
  };

  // Handle exercise info click
  const handleExerciseInfo = () => {
    toast({
      title: t('workout.infoSoon'),
      description: "",
    });
  };

  if (!workoutPlan) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <Card className="border-primary/20">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              {t('dashboard.workoutPlan.comingSoon')}
            </p>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  const weekData = workoutPlan.content[wk] || [];
  const weekProgress = getWeekProgress(wk);

  // Compute header date from active day or fallback to day 0
  const headerDate = getDateFor(wk, activeDayIndex ?? 0) ?? getDateFor(wk, 0);
  const monthYear = headerDate ? format(headerDate, 'MMM yyyy', { locale: de }) : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="px-4 md:px-6 space-y-4 md:space-y-6"
    >
      {/* Weekly Calendar */}
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrevWeek}
              disabled={currentWeekNum === 1}
              aria-label={t('workout.calendar.prev')}
              className="h-9 w-9 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <h3 className="mt-0 text-lg font-semibold text-foreground">
              {monthYear}
            </h3>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNextWeek}
              disabled={currentWeekNum === 4}
              aria-label={t('workout.calendar.next')}
              className="h-9 w-9 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }, (_, i) => {
              const date = getDateFor(wk, i);
              const dayName = date ? formatDateForDisplay(date, 'E') : '';
              const dayNumber = date ? formatDateForDisplay(date, 'd') : '';
              const isActive = activeDayIndex === i;
              const isCompleted = isDayCompleted(wk, i);
              const isToday = isTodayInWeekDay(wk, i);
              
              return (
                <button
                  key={i}
                  onClick={() => handleDayClick(i)}
                  className={[
                    "flex h-12 min-h-[44px] w-10 flex-col items-center justify-center rounded-xl text-xs transition-colors",
                    isToday ? "ring-2 ring-primary ring-offset-2" : "",
                    isCompleted ? "bg-primary/10 text-primary" : "bg-muted/50",
                    activeDayIndex === i ? "outline outline-2 outline-primary/60" : ""
                  ].join(" ")}
                  aria-pressed={activeDayIndex === i}
                  aria-label={`${dayName} ${dayNumber}`}
                  type="button"
                >
                  <span className="leading-3">{dayName}</span>
                  <span className="text-sm font-medium">{dayNumber}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Today Card */}
      <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-bold text-primary">
            {t('workout.today')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const todayWorkout = getTodayWorkout();
            
            if (!todayWorkout || todayWorkout.__restDay) {
              const isCompleted = todayWorkout ? isDayCompleted(todayWorkout.weekKey, todayWorkout.dayIndex) : false;
              const isFuture = todayWorkout ? isDayInFuture(todayWorkout.weekKey, todayWorkout.dayIndex) : false;
              
              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-muted-foreground">{t('workout.restDay')}</h3>
                      <p className="text-sm text-muted-foreground">
                        {isFuture ? t('workout.futureDay') : t('workout.restDayDescription')}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="rest-day"
                        checked={isCompleted}
                        disabled={isFuture}
                        onCheckedChange={(checked) => {
                          if (todayWorkout && !isFuture) {
                            toggleDayComplete(todayWorkout.weekKey, todayWorkout.dayIndex);
                            toast({
                              title: checked ? t('workout.restCompleted') : t('workout.restUncompleted'),
                              description: "",
                            });
                          }
                        }}
                      />
                      <label htmlFor="rest-day" className={`text-sm font-medium ${isFuture ? 'text-muted-foreground' : ''}`}>
                        {t('workout.markComplete')}
                      </label>
                    </div>
                  </div>
                </div>
              );
            }

            const isCompleted = isDayCompleted(todayWorkout.weekKey, todayWorkout.dayIndex);
            const isFuture = isDayInFuture(todayWorkout.weekKey, todayWorkout.dayIndex);
            const exercises = todayWorkout.dayData.exercises || [];

            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-primary">
                      {t('workout.exercisesCount', { count: exercises.length })}
                    </h3>
                    {isFuture && (
                      <p className="text-sm text-muted-foreground">
                        {t('workout.futureWorkout')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="today-workout"
                      checked={isCompleted}
                      disabled={isFuture}
                      onCheckedChange={(checked) => {
                        if (!isFuture) {
                          toggleDayComplete(todayWorkout.weekKey, todayWorkout.dayIndex);
                          toast({
                            title: checked ? t('workout.workoutCompleted') : t('workout.workoutUncompleted'),
                            description: "",
                          });
                        }
                      }}
                    />
                    <label htmlFor="today-workout" className={`text-sm font-medium ${isFuture ? 'text-muted-foreground' : ''}`}>
                      {t('workout.markComplete')}
                    </label>
                  </div>
                </div>
                
                <div className="space-y-2">
                  {exercises.slice(0, 3).map((exercise: any, index: number) => (
                    <div key={index} className="flex justify-between items-center text-sm bg-background/50 rounded-lg p-2">
                      <span className="font-medium">{exercise.name}</span>
                      <span className="text-muted-foreground">
                        {exercise.sets}×{exercise.reps}
                      </span>
                    </div>
                  ))}
                  {exercises.length > 3 && (
                    <div className="text-sm text-muted-foreground text-center">
                      {t('workout.moreExercises', { count: exercises.length - 3 })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Plan Stepper */}
      <section aria-label={t('workout.planWeeks')} className="select-none">
        <div
          role="tablist"
          aria-label={t('workout.weekSelection')}
          className="flex items-center justify-center gap-0 px-2"
        >
          {[1, 2, 3, 4].map((weekNum, index, arr) => {
            const weekKey = `week${weekNum}`;
            const isActive = currentWeekNum === weekNum;
            const isPast = currentWeekNum > weekNum;
            const isFuture = currentWeekNum < weekNum;
            const isFocused = focusedWeek === weekNum;

            // Get aria-label based on state
            const getAriaLabel = () => {
              if (isActive) return t('workout.weekAria.current', { num: weekNum });
              if (isPast) return t('workout.weekAria.past', { num: weekNum });
              return t('workout.weekAria.future', { num: weekNum });
            };

            return (
              <React.Fragment key={weekKey}>
                <motion.button
                  type="button"
                  role="tab"
                  aria-label={getAriaLabel()}
                  aria-selected={isActive}
                  tabIndex={isFocused ? 0 : -1}
                  onClick={() => handleWeekActivation(weekNum)}
                  onKeyDown={(e) => handleStepperKeyDown(e, weekNum)}
                  onFocus={() => setFocusedWeek(weekNum)}
                  whileTap={!window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { scale: 0.96 } : {}}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className={[
                    'relative flex items-center justify-center min-w-[44px] min-h-[44px] h-11 px-4 rounded-full text-sm font-medium transition-all duration-200',
                    'outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                      : isPast
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 shadow-sm'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                  ].join(' ')}
                >
                  <span className="flex-shrink-0">{t('workout.weekShort', { num: weekNum })}</span>
                </motion.button>

                {/* Connector line except after the last item */}
                {index < arr.length - 1 && (
                  <div className="flex items-center h-11">
                    <div
                      aria-hidden="true"
                      className={[
                        'h-0.5 w-8 rounded-full transition-colors duration-300',
                        (isPast || isActive)
                          ? 'bg-emerald-400 dark:bg-emerald-300'
                          : 'bg-border'
                      ].join(' ')}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Screen reader navigation instructions */}
        <div className="sr-only">
          Verwenden Sie die Pfeiltasten links und rechts, um zwischen den Wochen zu navigieren. 
          Drücken Sie Enter oder Leertaste, um eine Woche auszuwählen.
        </div>
      </section>

      {/* Week Section */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              {t('workout.week', { num: currentWeekNum })}
            </CardTitle>
            <span className="text-sm text-muted-foreground">
              {t('workout.thisWeekProgress', { done: weekProgress.completed, total: weekProgress.total })}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {weekData.map((day: any, dayIndex: number) => {
            const date = getDateFor(wk, dayIndex);
            const dayName = date ? formatDateForDisplay(date, 'EEEE') : `Tag ${dayIndex + 1}`;
            const isCompleted = isDayCompleted(wk, dayIndex);
            const isExpanded = expandedDay === dayIndex;
            const exercises = day?.exercises || [];
            const isRestDay = !exercises.length;
            
            return (
              <motion.div
                key={dayIndex}
                ref={(el) => (dayRefs.current[dayIndex] = el)}
                className={`border rounded-lg ${
                  activeDayIndex === dayIndex ? 'border-primary/50 bg-primary/5' : 'border-border'
                }`}
                initial={false}
              >
                <Collapsible open={isExpanded} onOpenChange={(open) => {
                  setExpandedDay(open ? dayIndex : null);
                  if (open) setActiveDayIndex?.(dayIndex);
                }}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full p-4 h-auto justify-between text-left"
                      style={{ minHeight: '44px' }}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{dayName}</span>
                          <span className="text-sm text-muted-foreground">
                            {isRestDay ? t('workout.restDay') : t('workout.exercisesCount', { count: exercises.length })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={isCompleted}
                            onCheckedChange={(checked) => {
                              toggleDayComplete(wk, dayIndex);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          {isCompleted && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        </div>
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent>
                    <motion.div
                      initial={!window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { height: 0, opacity: 0 } : {}}
                      animate={!window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { height: 'auto', opacity: 1 } : {}}
                      transition={{ duration: 0.3 }}
                      className="px-4 pb-4"
                    >
                      <Suspense fallback={<ExerciseListSkeleton />}>
                        <ExerciseList exercises={exercises} />
                      </Suspense>
                    </motion.div>
                  </CollapsibleContent>
                </Collapsible>
              </motion.div>
            );
          })}
        </CardContent>
      </Card>
    </motion.div>
  );
});

WorkoutView.displayName = 'WorkoutView';

export default WorkoutView;