import React, { useState, useRef, useEffect, Suspense, useMemo } from "react";
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
  ArrowUpDown,
  ChevronUp,
  ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { format, addDays } from 'date-fns';
import { de } from 'date-fns/locale';
import ExerciseListSkeleton from "@/components/skeletons/ExerciseListSkeleton";

const ExerciseList = React.lazy(() => import("@/views/ExerciseList"));

interface WorkoutViewProps {
  workoutPlan: any;
  workoutLogs: any[];
  completingWorkout: number | null;
  activeWeek: string | null;
  activeDayIndex?: number;
  selectedDate: Date;
  
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
  getWeekContentWithFallback: (weekKey: string) => any[];
  getWeekKeyForDate: (date: Date) => string;
  
  // Actions
  toggleDayComplete: (weekKey: string, dayIndex: number) => void;
  setActiveWeek: (weekKey: string | null) => void;
  setActiveDayIndex?: (dayIndex: number) => void;
  handleDateChange: (date: Date) => void;
}

const WorkoutView: React.FC<WorkoutViewProps> = React.memo(({
  workoutPlan,
  workoutLogs,
  completingWorkout,
  activeWeek,
  activeDayIndex = 0,
  selectedDate,
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
  getWeekContentWithFallback,
  getWeekKeyForDate,
  toggleDayComplete,
  setActiveWeek,
  setActiveDayIndex,
  handleDateChange
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const dayRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  
  // Hoisted function declaration to avoid temporal dead zone
  function normalizeWeekKey(key?: string | null) {
    const num = String(key ?? 'Week 1').match(/\d+/)?.[0];
    return `Week ${num ?? 1}`;
  }

  // Single source of truth helper for week progress from DB logs
  const getWeekProgressFromLogs = (weekKey: string, workoutPlan: any, workoutLogs: any[]) => {
    if (!workoutPlan || !workoutLogs) return { completed: 0, total: 7 };
    
    const total = workoutPlan.content[weekKey]?.length || 7;
    
    // Get unique dayIndex entries for this week from logs
    const weekNumber = parseInt(weekKey.replace(/\D/g, '')) - 1;
    const planCreatedDate = new Date(workoutPlan.created_at);
    
    const completedDays = new Set<number>();
    
    workoutLogs.forEach(log => {
      if (!log.completed) return;
      
      // Convert log date back to dayIndex
      const logDate = new Date(log.workout_day);
      const daysDiff = Math.floor((logDate.getTime() - planCreatedDate.getTime()) / (24 * 60 * 60 * 1000));
      const logWeekNumber = Math.floor(daysDiff / 7);
      const dayIndex = daysDiff % 7;
      
      if (logWeekNumber === weekNumber && dayIndex >= 0 && dayIndex < 7) {
        completedDays.add(dayIndex);
      }
    });
    
    return {
      completed: Math.min(completedDays.size, total),
      total
    };
  };

  // Canonical week key used everywhere in this component
  const wk = normalizeWeekKey(activeWeek);
  
  // Robust week number for titles like "Woche 3"
  const currentWeekNum = Number(wk.match(/\d+/)?.[0] ?? 1);
  const [focusedWeek, setFocusedWeek] = useState<number>(currentWeekNum);

  // Memoized week progress calculation
  const weekProgress = useMemo(() => {
    return getWeekProgressFromLogs(wk, workoutPlan, workoutLogs);
  }, [wk, workoutPlan, workoutLogs]);

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

  // Parse URL on mount and sync with selected date
  useEffect(() => {
    const { w, d } = parseHashQuery();
    
    if (w !== null && w >= 1 && w <= 4) {
      const weekKey = normalizeWeekKey(`Week ${w}`);
      if (activeWeek !== weekKey) {
        setActiveWeek(weekKey);
        // Update selected date to match URL week
        const dateForWeek = getDateFor(weekKey, d || 0);
        if (dateForWeek) {
          handleDateChange(dateForWeek);
        }
      }
    }
    
    if (d !== null && d >= 0 && d <= 6) {
      if (activeDayIndex !== d) {
        setActiveDayIndex?.(d);
      }
    }
  }, []); // Only run on mount

  // Sync active week when selected date changes
  useEffect(() => {
    const weekForDate = getWeekKeyForDate(selectedDate);
    if (weekForDate && weekForDate !== activeWeek) {
      setActiveWeek(weekForDate);
    }
  }, [selectedDate, getWeekKeyForDate]); // Sync when date changes

  // Update hash whenever activeWeek or activeDayIndex changes
  useEffect(() => {
    const weekNum = Number(wk.match(/\d+/)?.[0] ?? 1);
    updateHash(weekNum, activeDayIndex);
  }, [activeWeek, activeDayIndex, wk]);


  // Handle week navigation by moving date by ±7 days
  const handlePrevWeek = () => {
    const newDate = addDays(selectedDate, -7);
    handleDateChange(newDate);
  };

  const handleNextWeek = () => {
    const newDate = addDays(selectedDate, 7);
    handleDateChange(newDate);
  };

  // Handle day click in calendar
  const handleDayClick = (dayIndex: number) => {
    setActiveDayIndex?.(dayIndex);
    setExpandedDay(dayIndex);
    
    // Update selected date when clicking on calendar day
    const newDate = getDateFor(wk, dayIndex);
    if (newDate) {
      handleDateChange(newDate);
    }
    
    // Smooth scroll to day in list
    setTimeout(() => {
      const dayElement = dayRefs.current[dayIndex];
      if (dayElement && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dayElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  // Handle week activation with animation - set selectedDate to that week's Monday
  const handleWeekActivation = (weekNum: number) => {
    const newWeekKey = normalizeWeekKey(`Week ${weekNum}`);
    setActiveWeek(newWeekKey);
    
    // Update selected date to Monday of the selected week
    const mondayOfWeek = getDateFor(newWeekKey, 0); // 0 = Monday
    if (mondayOfWeek) {
      handleDateChange(mondayOfWeek);
    }
    
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

  // Get week data with fallback to Week 1 for missing weeks
  const weekData = getWeekContentWithFallback(wk);

  // Compute header date from active day or fallback to day 0
  const headerDate = getDateFor(wk, activeDayIndex ?? 0) ?? getDateFor(wk, 0);
  const monthYear = headerDate ? format(headerDate, 'MMM yyyy', { locale: de }) : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="p-4 space-y-3"
    >
      {/* Weekly Calendar */}
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrevWeek}
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

      {/* Plan Progress Stepper */}
      <Card className="border-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">
            {t('workout.planProgress.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
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
                  <div className="flex flex-col items-center gap-2">
                    <motion.button
                      type="button"
                      aria-label={getAriaLabel()}
                      aria-current={isActive ? "step" : undefined}
                      tabIndex={isFocused ? 0 : -1}
                      onClick={() => handleWeekActivation(weekNum)}
                      onKeyDown={(e) => handleStepperKeyDown(e, weekNum)}
                      onFocus={() => setFocusedWeek(weekNum)}
                      whileTap={!window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { scale: 0.95 } : {}}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      className={[
                        'relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-full text-sm font-medium transition-all duration-200',
                        'outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-lg ring-2 ring-accent ring-offset-2'
                          : isPast
                            ? 'bg-primary text-primary-foreground shadow-md'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      ].join(' ')}
                    >
                      <span className="flex-shrink-0 tabular-nums">{weekNum}</span>
                    </motion.button>
                    
                    <span className={[
                      'text-xs transition-colors duration-200',
                      isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'
                    ].join(' ')}>
                      {t('workout.weekLabel', { num: weekNum })}
                    </span>
                  </div>

                  {/* Connector line except after the last item - centered to button center */}
                  {index < arr.length - 1 && (
                    <div className="flex-1 flex items-center px-2" style={{ alignItems: 'center', height: '44px' }}>
                      <div
                        aria-hidden="true"
                        className={[
                          'h-0.5 w-full rounded-full transition-colors duration-300',
                          (isPast || (isActive && index < arr.length - 1))
                            ? 'bg-primary'
                            : 'bg-border'
                        ].join(' ')}
                        style={{ marginTop: '-22px' }}
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
        </CardContent>
      </Card>

      {/* Week Section */}
      <Card className="border-border">
        <CardHeader className="px-4 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <CardTitle className="text-lg font-bold">
              Woche {currentWeekNum}
            </CardTitle>
            <p className="text-sm text-muted-foreground tabular-nums shrink-0">
              {weekProgress.completed} / {weekProgress.total} Tage abgeschlossen
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-2">
          {weekData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">{t('workout.weekEmpty')}</p>
            </div>
          ) : (
            weekData.map((day: any, dayIndex: number) => {
            const date = getDateFor(wk, dayIndex);
            const dayName = date ? formatDateForDisplay(date, 'EEEE') : `Tag ${dayIndex + 1}`;
            const isCompleted = isDayCompleted(wk, dayIndex);
            const isFutureDay = isDayInFuture(wk, dayIndex);
            const isExpanded = expandedDay === dayIndex;
            const isToday = isTodayInWeekDay(wk, dayIndex);
            const exercises = day?.exercises || [];
            const isRestDay = !exercises.length;
            
            return (
                <motion.div
                key={dayIndex}
                ref={(el) => (dayRefs.current[dayIndex] = el)}
                className="border rounded-lg shadow-sm"
                initial={false}
              >
                <Collapsible open={isExpanded} onOpenChange={(open) => {
                  setExpandedDay(open ? dayIndex : null);
                  if (open) {
                    setActiveDayIndex?.(dayIndex);
                    setTimeout(() => {
                      const dayElement = dayRefs.current[dayIndex];
                      if (dayElement && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                        dayElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }, 100);
                  }
                }}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full px-3 py-2 h-14 justify-between text-left hover:bg-muted/50 rounded-lg"
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-center justify-between w-full">
                       <div className="flex items-center gap-2">
                         <div className="font-medium">{dayName}</div>
                         {isToday && (
                           <Badge variant="secondary" className="text-xs px-2 py-0.5 h-5">
                             Heute
                           </Badge>
                         )}
                       </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm text-muted-foreground">
                            {isRestDay ? 'Ruhetag' : `${exercises.length} Übungen`}
                          </span>
                           {isCompleted && (
                             <div className="w-4 h-4 rounded-full bg-green-600 flex-shrink-0" style={{ alignSelf: 'center' }}></div>
                           )}
                           {isExpanded ? (
                             <ChevronUp className="h-4 w-4 text-muted-foreground" style={{ alignSelf: 'center' }} />
                           ) : (
                             <ChevronRight className="h-4 w-4 text-muted-foreground" style={{ alignSelf: 'center' }} />
                           )}
                         </div>
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  
                    <CollapsibleContent>
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="border-t bg-muted/20"
                      >
                        {!isRestDay && (
                          <div className="px-3 py-1.5 border-b border-border/50">
                            <div className="grid grid-cols-[1fr_48px_64px] gap-2 text-xs text-muted-foreground font-medium items-baseline">
                              <span>Übung</span>
                              <span className="text-center tabular-nums">Sätze</span>
                              <span className="text-right tabular-nums">Reps</span>
                            </div>
                          </div>
                        )}
                      
                      {/* Exercise content */}
                      <div className="p-3 pt-2">
                        {isRestDay ? (
                          <div className="text-sm text-muted-foreground p-3 bg-muted/30 rounded-lg">
                            {t('workout.rest.note')}
                          </div>
                        ) : (
                            <div className="space-y-1">
                              {exercises.map((exercise: any, exerciseIndex: number) => (
                                <div key={exerciseIndex} className="grid grid-cols-[1fr_48px_64px] gap-2 p-3 bg-background rounded-md border shadow-sm min-h-[48px] items-center">
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
                                    <div className="break-words hyphens-auto text-right" style={{ lineHeight: '1.2' }}>
                                      {exercise.reps}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                        )}
                        
                          {!isRestDay && !isFutureDay && (
                            <div className="mt-2 pt-1.5 border-t border-border/50">
                              <div className="flex items-center gap-2 min-h-[28px]">
                                <Checkbox
                                  checked={isCompleted}
                                  onCheckedChange={(checked) => {
                                    toggleDayComplete(wk, dayIndex);
                                    toast({
                                      title: checked ? t('workout.workoutCompleted') : t('workout.workoutUncompleted'),
                                      description: "",
                                    });
                                  }}
                                  className={isCompleted ? 'border-green-600 bg-green-600' : ''}
                                />
                                <label className="text-xs font-medium">
                                  {t('workout.markComplete')}
                                </label>
                              </div>
                            </div>
                          )}
                       </div>
                     </motion.div>
                   </CollapsibleContent>
                </Collapsible>
              </motion.div>
              );
            })
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
});

WorkoutView.displayName = 'WorkoutView';

export default WorkoutView;