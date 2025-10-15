import React, { useState, useRef, useEffect, Suspense, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { useAuth } from "@/hooks/useAuth";
import { useWeekCompletion } from "@/hooks/useWeekCompletion";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { logEvent } from "@/lib/telemetryClient";
import { isExerciseCompleted } from "@/lib/completionUtils";
import ProgressRing from "@/components/ProgressRing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useExerciseEditor, type Exercise } from "@/hooks/useExerciseEditor";
import { useWorkoutHelpers } from "@/hooks/useWorkoutHelpers";
import { normalizeWeekKey } from "@/lib/workoutPlanUtils";
import { AddWorkoutDialog } from "@/components/AddWorkoutDialog";
import { useAddExercise } from "@/hooks/useAddExercise";
import { Plus } from "lucide-react";

const ExerciseList = React.lazy(() => import("@/views/ExerciseList"));
interface WorkoutViewProps {
  workoutPlan: any;
  workoutLogs: any[];
  completingWorkout: number | null;
  selectedDate: Date;

  // Helper functions
  isDayCompleted: (weekKey: string, dayIndex: number) => boolean;
  isDayInFuture: (weekKey: string, dayIndex: number) => boolean;
  isTodayInWeekDay: (weekKey: string, dayIndex: number) => boolean;
  getDateFor: (weekKey: string, dayIndex: number) => Date | null;
  getWeekTitle: (weekKey: string) => string;
  getWeeklyProgress: () => {
    completed: number;
    total: number;
  };
  getWeekKeyForDate: (date: Date) => string;

  // Actions
  toggleDayComplete: (weekKey: string, dayIndex: number) => void;
  handleDateChange: (date: Date) => void;
}
const WorkoutView: React.FC<WorkoutViewProps> = ({
  workoutPlan,
  workoutLogs,
  completingWorkout,
  selectedDate,
  isDayCompleted,
  isDayInFuture,
  isTodayInWeekDay,
  getDateFor,
  getWeekTitle,
  getWeeklyProgress,
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

  // React Query: Subscribe to live workout plan updates
  const planId = workoutPlan?.id;
  const { data: livePlan, isLoading: isLoadingPlan } = useQuery({
    queryKey: ['workout-plan', planId],
    enabled: !!planId,
    initialData: workoutPlan,
    staleTime: 0,
  });

  // Use consolidated workout helpers hook
  const { getWeekContentWithFallback, calcWeekStats, getProgressColor, getWeekMirrorInfo } = useWorkoutHelpers(livePlan);

  // Add exercise dialog state
  const [addExerciseDialog, setAddExerciseDialog] = useState<{
    open: boolean;
    weekKey: string | null;
    dayIndex: number | null;
  }>({
    open: false,
    weekKey: null,
    dayIndex: null,
  });

  const { updateExercise, isUpdating } = useExerciseEditor();
  const { addExercise, isAdding } = useAddExercise();
  const dayRefs = useRef<{
    [key: number]: HTMLDivElement | null;
  }>({});

  // Get day index from selectedDate (0 = Monday, 6 = Sunday) using plan-based calculation
  const getDayIndexForDate = (date: Date): number => {
    if (!livePlan?.created_at) return 0;
    const { dayIndex } = getWorkoutWeekDay(livePlan.created_at, date);
    return dayIndex;
  };

  // Derive all state from selectedDate (single source of truth)
  const activeWeek = useMemo(() => getWeekKeyForDate(selectedDate), [selectedDate, getWeekKeyForDate]);
  const activeDayIndex = useMemo(() => getDayIndexForDate(selectedDate), [selectedDate, livePlan?.created_at]);

  // Expanded day is always the currently selected day
  const expandedDay = activeDayIndex;

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
    planId: livePlan?.id,
    weekKey: wk,
    enabled: !!user && !!livePlan
  });

  // Helper function to fetch week completion
  const fetchWeekCompletion = async (weekKey: string) => {
    if (!user || !livePlan?.id) {
      throw new Error('User or planId not available');
    }

    const { data, error } = await supabase.functions.invoke('get-week-completion', {
      body: { planId: livePlan.id, weekKey },
    });

    if (error || !data?.success) {
      throw new Error(error?.message || 'Failed to fetch week completion');
    }

    return data.completionMap;
  };

  // Subscribe to all 4 weeks for reactive progress ring updates
  const { data: week1Completion } = useQuery<Record<string, boolean>>({
    queryKey: ['week-completion', livePlan?.id, 'Week 1'],
    queryFn: () => fetchWeekCompletion('Week 1'),
    enabled: !!livePlan?.id && !!user,
    staleTime: 30000,
  });
  const { data: week2Completion } = useQuery<Record<string, boolean>>({
    queryKey: ['week-completion', livePlan?.id, 'Week 2'],
    queryFn: () => fetchWeekCompletion('Week 2'),
    enabled: !!livePlan?.id && !!user,
    staleTime: 30000,
  });
  const { data: week3Completion } = useQuery<Record<string, boolean>>({
    queryKey: ['week-completion', livePlan?.id, 'Week 3'],
    queryFn: () => fetchWeekCompletion('Week 3'),
    enabled: !!livePlan?.id && !!user,
    staleTime: 30000,
  });
  const { data: week4Completion } = useQuery<Record<string, boolean>>({
    queryKey: ['week-completion', livePlan?.id, 'Week 4'],
    queryFn: () => fetchWeekCompletion('Week 4'),
    enabled: !!livePlan?.id && !!user,
    staleTime: 30000,
  });

  // Refetch all 4 weeks on mount to ensure fresh progress data
  useEffect(() => {
    if (!livePlan?.id || !user) return;
    
    // Invalidate all week completion queries to trigger immediate refetch
    ['Week 1', 'Week 2', 'Week 3', 'Week 4'].forEach(weekKey => {
      queryClient.invalidateQueries({ 
        queryKey: ['week-completion', livePlan.id, weekKey],
        refetchType: 'active'
      });
    });
  }, [user, livePlan?.id, queryClient]);

  // Memoized week progress calculation using hook
  const weekProgress = useMemo(() => {
    return calcWeekStats(wk, completionMap);
  }, [wk, completionMap, calcWeekStats]);

  // Handle week navigation
  const handlePrevWeek = useCallback(() => {
    if (!livePlan?.created_at) return;
    
    const currentWeekNum = Number(wk.match(/\d+/)?.[0] ?? 1);
    const newWeekNum = Math.max(1, currentWeekNum - 1);
    const newWeekKey = `Week ${newWeekNum}`;
    const newDate = getDateFor(newWeekKey, activeDayIndex);
    
    if (newDate) {
      logEvent('week_navigation', { direction: 'prev', fromWeek: wk, toWeek: newWeekKey });
      handleDateChange(newDate);
    }
  }, [livePlan?.created_at, wk, activeDayIndex, getDateFor, handleDateChange]);
  
  const handleNextWeek = useCallback(() => {
    if (!livePlan?.created_at) return;
    
    const currentWeekNum = Number(wk.match(/\d+/)?.[0] ?? 1);
    const newWeekNum = Math.min(4, currentWeekNum + 1);
    const newWeekKey = `Week ${newWeekNum}`;
    const newDate = getDateFor(newWeekKey, activeDayIndex);
    
    if (newDate) {
      logEvent('week_navigation', { direction: 'next', fromWeek: wk, toWeek: newWeekKey });
      handleDateChange(newDate);
    }
  }, [livePlan?.created_at, wk, activeDayIndex, getDateFor, handleDateChange]);

  // Keyboard shortcuts for week navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [handlePrevWeek, handleNextWeek]);

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

  // Inline exercise update handler (returns promise for async handling)
  const handleUpdateExercise = async (
    weekKey: string,
    dayIndex: number,
    exerciseIndex: number,
    updatedExercise: Exercise
  ): Promise<void> => {
    if (!livePlan?.id) return Promise.resolve();

    return new Promise((resolve) => {
      updateExercise(
        {
          planId: livePlan.id,
          weekKey,
          dayIndex,
          exerciseIndex,
          exercise: updatedExercise,
        },
        {
          onSuccess: () => {
            // Invalidate all week completions to refresh progress rings
            ['Week 1', 'Week 2', 'Week 3', 'Week 4'].forEach(wk => {
              queryClient.invalidateQueries({ 
                queryKey: ['week-completion', livePlan.id, wk] 
              });
            });
            resolve();
          },
          onError: () => {
            resolve();
          },
        }
      );
    });
  };

  // Add exercise handlers
  const handleOpenAddExercise = (weekKey: string, dayIndex: number) => {
    setAddExerciseDialog({
      open: true,
      weekKey,
      dayIndex,
    });
    logEvent('add_exercise_dialog_opened', { weekKey, dayIndex });
  };

  const handleAddExercise = (exercise: Exercise) => {
    if (!addExerciseDialog.weekKey || addExerciseDialog.dayIndex === null || !livePlan?.id) {
      return;
    }

    addExercise({
      planId: livePlan.id,
      weekKey: addExerciseDialog.weekKey,
      dayIndex: addExerciseDialog.dayIndex,
      exercise,
    });

    // Invalidate all week completions to refresh progress rings
    ['Week 1', 'Week 2', 'Week 3', 'Week 4'].forEach(weekKey => {
      queryClient.invalidateQueries({ 
        queryKey: ['week-completion', livePlan.id, weekKey] 
      });
    });

    setAddExerciseDialog({ open: false, weekKey: null, dayIndex: null });
  };

  // Handle AI autofill
  const handleAutoFill = (dayIndex: number) => {
    console.log("AI autofill triggered for day", dayIndex);
  };
  // Show loading skeleton while plan is being fetched
  if (isLoadingPlan) {
    return <ExerciseListSkeleton />;
  }

  if (!livePlan) {
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
  const mirrorInfo = useMemo(() => getWeekMirrorInfo(wk), [wk, getWeekMirrorInfo]);

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
        workoutPlan={livePlan} 
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
          <TooltipProvider>
            <div className="flex items-center justify-between">
              {[1, 2, 3, 4].map((weekNum, index, arr) => {
              const weekKey = `Week ${weekNum}`;
              const isActive = currentWeekNum === weekNum;
              const isPast = currentWeekNum > weekNum;
              const isFuture = currentWeekNum < weekNum;
              const isFocused = focusedWeek === weekNum;

              // Get completion data from subscribed queries
              const weekCompletionData = weekNum === 1 ? week1Completion :
                                         weekNum === 2 ? week2Completion :
                                         weekNum === 3 ? week3Completion :
                                         week4Completion;
              const stats = calcWeekStats(weekKey, weekCompletionData);
              const progressColor = getProgressColor(stats.percent, isFuture);

              // Get aria-label with completion stats
              const ariaLabel = `Week ${weekNum}: ${stats.completed}/${stats.total} sessions done, ${stats.percent}% complete`;
              
              return <React.Fragment key={weekKey}>
                    <div className="flex flex-col items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <motion.button 
                            type="button" 
                            aria-label={ariaLabel} 
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
                              progressClassName={progressColor}
                              className={isActive ? 'ring-2 ring-primary ring-offset-2' : ''}
                            >
                              <span className="text-xs font-bold tabular-nums">
                                {stats.total > 0 ? `${stats.percent}%` : '0%'}
                              </span>
                            </ProgressRing>
                          </motion.button>
                        </TooltipTrigger>
                        <TooltipContent className="text-sm" sideOffset={5}>
                          <div className="space-y-1">
                            <div className="font-semibold">Week {weekNum} Summary:</div>
                            <div>✅ {stats.completed} sessions completed</div>
                            <div>❌ {stats.missed} sessions missed</div>
                            <div>📊 {stats.percent}% complete</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      
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
          </TooltipProvider>

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
                              {isRestDay ? (
                                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                                  <div className="text-sm text-muted-foreground">
                                    {t('workout.rest.note')}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleOpenAddExercise(wk, dayIndex)}
                                    className="h-8 w-8 shrink-0"
                                    aria-label="Übung hinzufügen"
                                  >
                                    <Plus className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                  <Suspense fallback={<ExerciseListSkeleton />}>
                                   <ExerciseList
                                     exercises={exercises}
                                     onUpdateExercise={(exerciseIndex, updatedExercise) =>
                                       handleUpdateExercise(wk, dayIndex, exerciseIndex, updatedExercise)
                                     }
                                     isUpdating={isUpdating}
                                   />
                                  </Suspense>
                                )}
                            
                              {/* Add Exercise Button (for days with exercises) */}
                              {!isRestDay && (
                                <div className="mt-2 pt-2 border-t border-border/50 flex justify-center items-center">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleOpenAddExercise(wk, dayIndex)}
                                    className="h-8 w-8"
                                    aria-label="Übung hinzufügen"
                                  >
                                    <Plus className="h-4 w-4" />
                                  </Button>
                                  <button
                                    onClick={() => handleAutoFill(dayIndex)}
                                    className="ml-2 rounded-full p-2 hover:bg-muted dark:hover:bg-muted/80 transition-colors"
                                    aria-label="AI Autofill"
                                  >
                                    <span className="text-base">✨</span>
                                  </button>
                                </div>
                              )}

                              {!isRestDay && !isFutureDay && <div className="mt-2 pt-1.5 border-t border-border/50">
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

      {/* Add Exercise Dialog */}
      <AddWorkoutDialog
        open={addExerciseDialog.open}
        onOpenChange={(open) => 
          setAddExerciseDialog({ open, weekKey: null, dayIndex: null })
        }
        onSave={handleAddExercise}
        isLoading={isAdding}
      />
    </motion.div>
    </WorkoutErrorBoundary>
  );
};

export default WorkoutView;