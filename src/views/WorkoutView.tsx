import React, { useState, useRef, useEffect, Suspense, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, CheckCircle2, ArrowUpDown, ChevronUp, ChevronDown, WifiOff, RefreshCw, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { format } from 'date-fns';
import { getWorkoutWeekDay } from "@/lib/workoutDateUtils";
import { de } from 'date-fns/locale';
import ExerciseListSkeleton from "@/components/skeletons/ExerciseListSkeleton";
import TodayWorkoutCard from "@/components/TodayWorkoutCard";
import { WEEK_OPTIONS } from "@/lib/dateUtils";
import { useAuth } from "@/hooks/useAuth";
import { useWeekCompletion } from "@/hooks/useWeekCompletion";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { logEvent } from "@/lib/telemetryClient";
import { isExerciseCompleted } from "@/lib/completionUtils";
import ProgressRing from "@/components/ProgressRing";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const ExerciseList = React.lazy(() => import("@/views/ExerciseList"));
interface WorkoutViewProps {
  workoutPlan: any;
  workoutLogs: any[];
  completingWorkout: number | null;
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
  getWeekProgress: (weekKey: string) => {
    completed: number;
    total: number;
  };
  getWeeklyProgress: () => {
    completed: number;
    total: number;
  };
  getWeekContentWithFallback: (weekKey: string) => any[];
  getWeekKeyForDate: (date: Date) => string;

  // Actions
  toggleDayComplete: (weekKey: string, dayIndex: number) => void;
  handleDateChange: (date: Date) => void;
}
const WorkoutView: React.FC<WorkoutViewProps> = React.memo(({
  workoutPlan,
  workoutLogs,
  completingWorkout,
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
  handleDateChange
}) => {
  const {
    t
  } = useTranslation();
  const {
    toast
  } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Utility to calculate week stats from completion data
  const calcWeekStats = useCallback((
    weekKey: string,
    completion: Record<string, boolean> | undefined,
  ) => {
    const week = getWeekContentWithFallback(weekKey) || [];
    let total = 0, completed = 0;

    week.forEach((day: any, dayIndex: number) => {
      const exercises = day?.exercises || [];
      exercises.forEach((_ex: any, exerciseIndex: number) => {
        total += 1;
        if (completion && completion[`${weekKey}_${dayIndex}_${exerciseIndex}`]) {
          completed += 1;
        }
      });
    });

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, percent };
  }, [getWeekContentWithFallback]);

  // Helper function to detect mirrored weeks and get source week
  const getWeekMirrorInfo = (weekKey: string) => {
    if (!workoutPlan?.content) return {
      isMirrored: false,
      sourceWeek: null
    };
    const weekNumber = parseInt(weekKey.replace(/\D/g, ''));
    const existing = workoutPlan.content[weekKey] || workoutPlan.content[`week${weekNumber}`];

    // If week exists, it's not mirrored
    if (existing) return {
      isMirrored: false,
      sourceWeek: null
    };
    const week2 = workoutPlan.content['Week 2'] || workoutPlan.content['week2'];
    const week1 = workoutPlan.content['Week 1'] || workoutPlan.content['week1'];

    // Week 1 empty fallback to Week 2
    if (weekNumber === 1 && !existing && week2) {
      return {
        isMirrored: false,
        sourceWeek: null
      }; // Keep Week 1 empty, no mirroring
    }

    // Weeks 3-4 mirror Week 2
    if ((weekNumber === 3 || weekNumber === 4) && !existing && week2) {
      return {
        isMirrored: true,
        sourceWeek: 2
      };
    }

    // Default fallback to Week 1 for missing weeks 2-4
    if (weekNumber > 1 && weekNumber <= 4 && !existing && week1) {
      return {
        isMirrored: true,
        sourceWeek: 1
      };
    }
    return {
      isMirrored: false,
      sourceWeek: null
    };
  };
  const dayRefs = useRef<{
    [key: number]: HTMLDivElement | null;
  }>({});

  // Get day index from selectedDate (0 = Monday, 6 = Sunday) using plan-based calculation
  const getDayIndexForDate = (date: Date): number => {
    if (!workoutPlan?.created_at) return 0;
    const { dayIndex } = getWorkoutWeekDay(workoutPlan.created_at, date);
    return dayIndex;
  };

  // Derive all state from selectedDate (single source of truth)
  const activeWeek = useMemo(() => getWeekKeyForDate(selectedDate), [selectedDate, getWeekKeyForDate]);
  const activeDayIndex = useMemo(() => getDayIndexForDate(selectedDate), [selectedDate]);

  // Expanded day is always the currently selected day
  const expandedDay = activeDayIndex;

  // Hoisted function declaration to avoid temporal dead zone
  function normalizeWeekKey(key?: string | null) {
    const num = String(key ?? 'Week 1').match(/\d+/)?.[0];
    return `Week ${num ?? 1}`;
  }

  // Single source of truth helper for week progress from DB logs
  const getWeekProgressFromLogs = (weekKey: string, workoutPlan: any, workoutLogs: any[]) => {
    if (!workoutPlan || !workoutLogs) return {
      completed: 0,
      total: 7
    };
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

  // React Query: Fetch week completion data with batched API call
  const {
    completionMap,
    isLoading: isLoadingCompletion,
    isError: isCompletionError,
    toggleExercise,
    isToggling,
    isOnline,
    refetch: refetchCompletion,
    prefetchWeekCompletion,
    isCached,
    dataUpdatedAt
  } = useWeekCompletion({
    planId: workoutPlan?.id,
    weekKey: wk,
    enabled: !!user && !!workoutPlan
  });

  // Prefetch all 4 weeks for progress ring display
  useEffect(() => {
    if (!workoutPlan?.id || !user) return;
    
    ['Week 1', 'Week 2', 'Week 3', 'Week 4'].forEach(weekKey => {
      const key = ['week-completion', workoutPlan.id, weekKey];
      if (!queryClient.getQueryData(key)) {
        queryClient.prefetchQuery({ 
          queryKey: key, 
          queryFn: async () => {
            const { data, error } = await supabase.functions.invoke('get-week-completion', { 
              body: { planId: workoutPlan.id, weekKey } 
            });
            if (error) throw error;
            return data?.completionMap || {};
          }
        }).catch(() => {
          // Silent fail - prefetch is optional
        });
      }
    });
  }, [user, workoutPlan?.id, queryClient]);

  // Memoized week progress calculation
  const weekProgress = useMemo(() => {
    return getWeekProgressFromLogs(wk, workoutPlan, workoutLogs);
  }, [wk, workoutPlan, workoutLogs]);

  // Keyboard shortcuts for week navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handlePrevWeek();
        logEvent('keyboard_shortcut_used', { action: 'prev_week', key: 'ArrowLeft' });
      } else if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleNextWeek();
        logEvent('keyboard_shortcut_used', { action: 'next_week', key: 'ArrowRight' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDate, handleDateChange]);

  // URL deep-linking helpers
  const parseHashQuery = () => {
    const hash = window.location.hash;
    const match = hash.match(/[#/?]workout\?(.+)/);
    if (!match) return {
      w: null,
      d: null
    };
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
    const {
      w,
      d
    } = parseHashQuery();
    if (w !== null && w >= 1 && w <= 4 && d !== null && d >= 0 && d <= 6) {
      const weekKey = normalizeWeekKey(`Week ${w}`);
      const dateForWeek = getDateFor(weekKey, d);
      if (dateForWeek) {
        handleDateChange(dateForWeek);
      }
    }
  }, []); // Only run on mount

  // Update hash whenever activeWeek or activeDayIndex changes
  useEffect(() => {
    const weekNum = Number(wk.match(/\d+/)?.[0] ?? 1);
    updateHash(weekNum, activeDayIndex);
  }, [activeWeek, activeDayIndex, wk]);

  // Handle week navigation by moving date by ±7 days
  const handlePrevWeek = () => {
    if (!workoutPlan?.created_at) return;
    
    // Get current week number
    const currentWeekNum = Number(wk.match(/\d+/)?.[0] ?? 1);
    
    // Navigate to previous week (minimum Week 1)
    const newWeekNum = Math.max(1, currentWeekNum - 1);
    const newWeekKey = `Week ${newWeekNum}`;
    
    // Get date for the same day in the previous week
    const newDate = getDateFor(newWeekKey, activeDayIndex);
    
    if (newDate) {
      logEvent('week_navigation', { direction: 'prev', fromWeek: wk, toWeek: newWeekKey });
      handleDateChange(newDate);
    }
  };
  
  const handleNextWeek = () => {
    if (!workoutPlan?.created_at) return;
    
    // Get current week number
    const currentWeekNum = Number(wk.match(/\d+/)?.[0] ?? 1);
    
    // Navigate to next week (maximum Week 4)
    const newWeekNum = Math.min(4, currentWeekNum + 1);
    const newWeekKey = `Week ${newWeekNum}`;
    
    // Get date for the same day in the next week
    const newDate = getDateFor(newWeekKey, activeDayIndex);
    
    if (newDate) {
      logEvent('week_navigation', { direction: 'next', fromWeek: wk, toWeek: newWeekKey });
      handleDateChange(newDate);
    }
  };

  // Helper to check if element is fully visible in viewport
  const isElementVisible = (element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;
    
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= windowHeight &&
      rect.right <= windowWidth
    );
  };

  // Handle day click in calendar
  const handleDayClick = useCallback((dayIndex: number) => {
    // Update selected date - this will automatically update expandedDay via activeDayIndex
    const newDate = getDateFor(wk, dayIndex);
    if (newDate) {
      handleDateChange(newDate);
    }

    // No automatic scrolling - only expand the day section
    // TodayWorkoutCard will already show the correct exercises
  }, [wk, getDateFor, handleDateChange]);

  // Handle week activation with animation - set selectedDate to that week's Monday + current dayIndex
  const handleWeekActivation = (weekNum: number) => {
    const newWeekKey = normalizeWeekKey(`Week ${weekNum}`);

    logEvent('week_activation', { fromWeek: wk, toWeek: newWeekKey, dayIndex: activeDayIndex });

    // Update selected date to keep current day within the new week
    const dayOfWeek = getDateFor(newWeekKey, activeDayIndex);
    if (dayOfWeek) {
      handleDateChange(dayOfWeek);
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
      description: ""
    });
  };
  if (!workoutPlan) {
    return <motion.div initial={{
      opacity: 0,
      y: 20
    }} animate={{
      opacity: 1,
      y: 0
    }} transition={{
      duration: 0.4,
      delay: 0.1
    }}>
        <Card className="border-primary/20">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              {t('dashboard.workoutPlan.comingSoon')}
            </p>
          </CardContent>
        </Card>
      </motion.div>;
  }

  // Memoize week data to prevent recalculation
  const weekData = useMemo(() => getWeekContentWithFallback(wk), [wk, getWeekContentWithFallback]);

  // Get mirror info for the current week
  const mirrorInfo = useMemo(() => getWeekMirrorInfo(wk), [wk]);

  // Compute header date from active day or fallback to day 0
  const headerDate = getDateFor(wk, activeDayIndex ?? 0) ?? getDateFor(wk, 0);
  const monthYear = headerDate ? format(headerDate, 'MMM yyyy', {
    locale: de
  }) : '';
  
  return (
    <WorkoutErrorBoundary>
      <motion.div 
        key={wk}
        initial={{ opacity: 0, x: -10 }} 
        animate={{ opacity: 1, x: 0 }} 
        exit={{ opacity: 0, x: 10 }}
        transition={{ duration: 0.3, ease: "easeOut" }} 
        className="p-4 space-y-3 px-[12px] py-[12px]"
      >
        {/* Screen reader announcement for week changes */}
        <div 
          role="status" 
          aria-live="polite" 
          aria-atomic="true" 
          className="sr-only"
        >
          Woche {currentWeekNum} geladen. {weekProgress.completed} von {weekProgress.total} Trainingseinheiten abgeschlossen.
        </div>

        {/* Offline Indicator */}
        <AnimatePresence>
          {!isOnline && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="border-warning bg-warning/5">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 text-warning">
                    <WifiOff className="h-4 w-4" aria-hidden="true" />
                    <span className="text-sm font-medium" role="status" aria-live="polite">
                      Offline-Modus - Änderungen werden synchronisiert
                    </span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error State */}
        <AnimatePresence>
          {isCompletionError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="h-4 w-4" aria-hidden="true" />
                      <span className="text-sm font-medium" role="alert" aria-live="assertive">
                        Fehler beim Laden des Trainingsplans
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => refetchCompletion()}
                      className="h-8"
                      aria-label="Trainingsplan erneut laden"
                    >
                      <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />
                      Erneut versuchen
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Weekly Calendar */}
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="sm" onClick={handlePrevWeek} aria-label={t('workout.calendar.prev')} className="min-h-[44px] min-w-[44px] h-11 w-11 p-0 rounded-xl hover:bg-muted/80 active:bg-muted touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <h3 className="mt-0 text-lg font-semibold text-foreground">
              {monthYear}
            </h3>
            
            <Button variant="ghost" size="sm" onClick={handleNextWeek} aria-label={t('workout.calendar.next')} className="min-h-[44px] min-w-[44px] h-11 w-11 p-0 rounded-xl hover:bg-muted/80 active:bg-muted touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="grid grid-cols-7 gap-3">
            {Array.from({
            length: 7
          }, (_, i) => {
            const date = getDateFor(wk, i);
            const dayName = date ? formatDateForDisplay(date, 'E') : '';
            const dayNumber = date ? formatDateForDisplay(date, 'd') : '';
            const isActive = activeDayIndex === i;
            const isCompleted = isDayCompleted(wk, i);
            const isToday = isTodayInWeekDay(wk, i);
            return <button key={i} onClick={() => handleDayClick(i)} className={["flex min-h-[44px] min-w-[44px] h-12 w-full flex-col items-center justify-center rounded-xl text-xs transition-all duration-200 touch-manipulation active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2", isToday ? "ring-2 ring-primary ring-offset-2" : "", isCompleted ? "bg-primary/10 text-primary" : "bg-muted/50", activeDayIndex === i ? "outline outline-2 outline-primary/60" : ""].join(" ")} aria-pressed={activeDayIndex === i} aria-label={`${dayName} ${dayNumber}${isCompleted ? ' - abgeschlossen' : ''}${isToday ? ' - heute' : ''}`} type="button">
                  <span className="leading-3">{dayName}</span>
                  <span className="text-sm font-medium">{dayNumber}</span>
                </button>;
          })}
          </div>
        </CardContent>
      </Card>

      {/* Today's Workout Card */}
      <TodayWorkoutCard 
        selectedDate={selectedDate} 
        weekKey={wk} 
        dayIndex={activeDayIndex} 
        workoutPlan={workoutPlan} 
        getWeekContentWithFallback={getWeekContentWithFallback} 
        mirrorInfo={mirrorInfo}
        completionMap={completionMap}
        isLoading={isLoadingCompletion}
        toggleExercise={toggleExercise}
        isToggling={isToggling}
        isOnline={isOnline}
        isCached={isCached}
        dataUpdatedAt={dataUpdatedAt}
      />

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
            const weekKey = `Week ${weekNum}`;
            const isActive = currentWeekNum === weekNum;
            const isPast = currentWeekNum > weekNum;
            const isFuture = currentWeekNum < weekNum;
            const isFocused = focusedWeek === weekNum;

            // Get completion data from cache
            const weekCompletionFromCache = queryClient.getQueryData<Record<string, boolean>>(['week-completion', workoutPlan?.id, weekKey]);
            const stats = calcWeekStats(weekKey, weekCompletionFromCache);

            // Get aria-label with completion stats
            const getAriaLabel = () => {
              const baseLabel = `Week ${weekNum}: ${stats.completed} of ${stats.total} exercises completed (${stats.percent}%).`;
              if (isActive) return `${baseLabel} Current week.`;
              if (isPast) return `${baseLabel} Past week.`;
              return `${baseLabel} Future week.`;
            };
            
            return <React.Fragment key={weekKey}>
                  <div className="flex flex-col items-center gap-2">
                    <motion.button 
                      type="button" 
                      aria-label={getAriaLabel()} 
                      aria-current={isActive ? "page" : undefined} 
                      tabIndex={isFocused ? 0 : -1} 
                      onClick={() => handleWeekActivation(weekNum)} 
                      onKeyDown={e => handleStepperKeyDown(e, weekNum)} 
                      onFocus={() => setFocusedWeek(weekNum)} 
                      whileTap={!window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { scale: 0.95 } : {}} 
                      transition={{ duration: 0.15, ease: 'easeOut' }} 
                      className="relative outline-none ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <ProgressRing
                        size={44}
                        strokeWidth={4}
                        progress={stats.percent}
                        trackClassName={isFuture ? 'text-muted-foreground/15' : 'text-muted-foreground/20'}
                        progressClassName={
                          stats.percent === 100 
                            ? 'text-emerald-500' 
                            : stats.percent > 0 
                            ? 'text-emerald-400' 
                            : 'text-muted-foreground/30'
                        }
                        className={isActive ? 'ring-2 ring-primary ring-offset-2' : ''}
                      >
                        <span className="text-xs font-bold tabular-nums">
                          {stats.total > 0 ? `${stats.percent}%` : '0%'}
                        </span>
                      </ProgressRing>
                    </motion.button>
                    
                    <span className={['text-xs transition-colors duration-200', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'].join(' ')}>
                      {t('workout.weekLabel', { num: weekNum })}
                    </span>
                  </div>

                  {/* Connector line except after the last item */}
                  {index < arr.length - 1 && (
                    <div className="flex-1 flex items-center px-2" style={{ alignItems: 'center', height: '44px' }}>
                      <div 
                        aria-hidden="true" 
                        className={['h-0.5 w-full rounded-full transition-colors duration-300', isPast || (isActive && index < arr.length - 1) ? 'bg-primary' : 'bg-border'].join(' ')} 
                        style={{ marginTop: '-22px' }} 
                      />
                    </div>
                  )}
                </React.Fragment>;
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
      <Card className="border-border" id="weekCard">
        <CardHeader className="px-4 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              {t('workout.week', {
              num: currentWeekNum
            })}
            </CardTitle>
            <p className="text-sm text-muted-foreground tabular-nums shrink-0">
              {weekProgress.completed} / {weekProgress.total} Tage abgeschlossen
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-2">
          {weekData.length === 0 ? <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">{t('workout.weekEmpty')}</p>
            </div> : weekData.map((day: any, dayIndex: number) => {
          const date = getDateFor(wk, dayIndex);
          const dayName = date ? formatDateForDisplay(date, 'EEEE') : `Tag ${dayIndex + 1}`;
          const isCompleted = isDayCompleted(wk, dayIndex);
          const isFutureDay = isDayInFuture(wk, dayIndex);
          const isExpanded = expandedDay === dayIndex;
          const isToday = isTodayInWeekDay(wk, dayIndex);
          const exercises = day?.exercises || [];
          const isRestDay = !exercises.length;
          return <motion.div key={dayIndex} ref={el => dayRefs.current[dayIndex] = el} className="border rounded-lg shadow-sm" initial={false}>
                <Collapsible open={isExpanded} onOpenChange={open => {
              if (open) {
                // Update selected date - this will automatically sync expandedDay
                const newDate = getDateFor(wk, dayIndex);
                if (newDate) {
                  handleDateChange(newDate);
                }

                // Only scroll if element is not already visible
                const dayElement = dayRefs.current[dayIndex];
                if (dayElement && !isElementVisible(dayElement)) {
                  dayElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest'
                  });
                }
              }
            }}>
                  <CollapsibleTrigger asChild>
                    <Button 
                      variant="ghost" 
                      className="w-full px-3 py-2 h-14 justify-between text-left hover:bg-muted/50 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" 
                      aria-expanded={isExpanded}
                      aria-label={`${dayName}${isToday ? ' - Heute' : ''}${isRestDay ? ' - Ruhetag' : ` - ${exercises.length} Übungen`}${isCompleted ? ' - abgeschlossen' : ''}`}
                    >
                      <div className="flex items-center justify-between w-full">
                       <div className="flex items-center gap-2">
                         <div className="font-medium">{dayName}</div>
                         {isToday && <Badge variant="secondary" className="text-xs px-2 py-0.5 h-5">
                             Heute
                           </Badge>}
                       </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm text-muted-foreground">
                            {isRestDay ? 'Ruhetag' : `${exercises.length} Übungen`}
                          </span>
                           {isCompleted && <div className="w-4 h-4 rounded-full bg-green-600 flex-shrink-0" style={{
                        alignSelf: 'center'
                      }} aria-label="Tag abgeschlossen"></div>}
                           {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" style={{
                        alignSelf: 'center'
                      }} /> : <ChevronRight className="h-4 w-4 text-muted-foreground" style={{
                        alignSelf: 'center'
                      }} />}
                         </div>
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  
                     <CollapsibleContent>
                       {isExpanded && (
                         <motion.div initial={{
                           opacity: 0,
                           height: 0
                         }} animate={{
                           opacity: 1,
                           height: "auto"
                         }} exit={{
                           opacity: 0,
                           height: 0
                         }} transition={{
                           duration: 0.15,
                           ease: "easeOut"
                         }} className="border-t bg-muted/20">
                           {!isRestDay && <div className="px-3 py-1.5 border-b border-border/50">
                               <div className="grid grid-cols-[1fr_48px_64px] gap-2 text-xs text-muted-foreground font-medium items-baseline">
                                 <span>Übung</span>
                                 <span className="text-center tabular-nums">Sätze</span>
                                 <span className="text-right tabular-nums">Reps</span>
                               </div>
                             </div>}
                         
                         {/* Exercise content */}
                         <div className="p-3 pt-2 px-[8px] py-[7px]">
                           {isRestDay ? <div className="text-sm text-muted-foreground p-3 bg-muted/30 rounded-lg">
                               {t('workout.rest.note')}
                              </div> : <div className="space-y-1">
                                    {exercises.map((exercise: any, exerciseIndex: number) => {
                                     // Use helper to check completion in flat state
                                     const isExerciseCompletedStatus = isExerciseCompleted(completionMap, wk, dayIndex, exerciseIndex);
                                    
                                      return <motion.div 
                                       key={exerciseIndex} 
                                       className="grid grid-cols-[1fr_48px_64px] gap-2 p-3 bg-background rounded-md border shadow-sm min-h-[48px] items-center"
                                       initial={{ opacity: 0, y: -5 }}
                                       animate={{ opacity: 1, y: 0 }}
                                       transition={{ duration: 0.2, delay: exerciseIndex * 0.02 }}
                                       role="status"
                                       aria-label={`${exercise.name} ${isExerciseCompletedStatus ? 'abgeschlossen' : 'offen'}`}
                                     >
                                       <div className="flex items-center gap-2 min-w-0">
                                         <motion.div 
                                           className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                                             isExerciseCompletedStatus 
                                               ? 'bg-green-600' 
                                               : 'border-2 border-muted-foreground/30 bg-transparent'
                                           }`}
                                           initial={false}
                                           animate={{
                                             scale: isExerciseCompletedStatus ? [1, 1.15, 1] : 1,
                                           }}
                                           transition={{
                                             duration: 0.3,
                                             ease: "easeOut"
                                           }}
                                           aria-hidden="true"
                                         >
                                           {isExerciseCompletedStatus && (
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
                                        <div className="font-bold text-sm min-w-0 truncate">
                                          {exercise.name}
                                        </div>
                                      </div>
                                      <div className="text-center text-xs tabular-nums font-medium">
                                        {exercise.sets}
                                      </div>
                                      <div className="text-right text-xs tabular-nums font-medium leading-tight max-w-full overflow-hidden">
                                        <div className="break-words hyphens-auto text-right" style={{
                                lineHeight: '1.2'
                              }}>
                                          {exercise.reps}
                                        </div>
                                      </div>
                                    </motion.div>;
                                  })}
                               </div>}
                           
                             {!isRestDay && !isFutureDay && <div className="mt-2 pt-1.5 border-t border-border/50">
                                 <div className="flex items-center gap-2 min-h-[28px]">
                                   <Checkbox checked={isCompleted} onCheckedChange={checked => {
                             toggleDayComplete(wk, dayIndex);
                             toast({
                               title: checked ? t('workout.workoutCompleted') : t('workout.workoutUncompleted'),
                               description: ""
                             });
                           }} className={isCompleted ? 'border-green-600 bg-green-600' : ''} />
                                   <label className="text-xs font-medium">
                                     {t('workout.markComplete')}
                                   </label>
                                 </div>
                               </div>}
                          </div>
                        </motion.div>
                       )}
                     </CollapsibleContent>
                </Collapsible>
              </motion.div>;
        })}
        </CardContent>
      </Card>
    </motion.div>
    </WorkoutErrorBoundary>
  );
});
WorkoutView.displayName = 'WorkoutView';
export default WorkoutView;