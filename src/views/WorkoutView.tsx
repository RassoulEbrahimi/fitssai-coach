import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { WifiOff, RefreshCw, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { format } from 'date-fns';
import { getWorkoutWeekDay } from "@/lib/workoutDateUtils";
import { de } from 'date-fns/locale';
import ExerciseListSkeleton from "@/components/skeletons/ExerciseListSkeleton";
import TodayWorkoutCard from "@/components/TodayWorkoutCard";
import { useAuth } from "@/hooks/useAuth";
import { useWeekCompletion } from "@/hooks/useWeekCompletion";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { logEvent } from "@/lib/telemetryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useExerciseEditor, type Exercise } from "@/hooks/useExerciseEditor";
import { useWorkoutHelpers } from "@/hooks/useWorkoutHelpers";
import { normalizeWeekKey } from "@/lib/workoutPlanUtils";
import { AddWorkoutModal } from "@/components/workout/AddWorkoutModal";
import { useAddExercise } from "@/hooks/useAddExercise";
import { useTrainingData } from "@/contexts/TrainingContext";
import { useDeleteExercise } from "@/hooks/useDeleteExercise";
import { useRestoreExercise } from "@/hooks/useRestoreExercise";
import { Button as ToastButton } from "@/components/ui/button";
import { WorkoutPlan } from "@/lib/types";
import { WorkoutLog } from "@/lib/types";

// Extracted Components
import { WeekNavigation } from "@/components/workout/WeekNavigation";
import { WeekProgress } from "@/components/workout/WeekProgress";
import { DayAccordion } from "@/components/workout/DayAccordion";

// Logic helpers
import { /* isElementVisible, */ updateHash } from "@/lib/workout/viewHelpers";

interface WorkoutViewProps {
  workoutPlan: WorkoutPlan;
  workoutLogs: WorkoutLog[];
  completingWorkout: boolean;
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
  selectedDate,
  isDayCompleted,
  isDayInFuture,
  isTodayInWeekDay,
  getDateFor,
  getWeekKeyForDate,
  handleDateChange
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { syncFromPlan } = useTrainingData();
  const { deleteExercise } = useDeleteExercise();
  const { restoreExercise } = useRestoreExercise();

  // Ref to store last deleted exercise for undo functionality
  const lastDeletedRef = useRef<{
    exercise: Exercise;
    weekKey: string;
    dayIndex: number;
    exerciseIndex: number;
  } | null>(null);

  // React Query: Subscribe to live workout plan updates
  const planId = workoutPlan?.id;
  const { data: livePlan, isLoading: isLoadingPlan } = useQuery({
    queryKey: ['workout-plan', planId],
    queryFn: async () => {
      if (!planId) return null;
      const snap = await getDoc(doc(db, 'users', user!.uid, 'workout_plans', planId));
      if (!snap.exists()) return null;
      const d = snap.data();
      return { id: snap.id, user_id: user!.uid, content: d.content ?? {}, created_at: '' } as unknown as WorkoutPlan;
    },
    enabled: !!planId,
    initialData: workoutPlan,
    staleTime: 1000 * 60 * 5,
  });

  // Use consolidated workout helpers hook
  const { getWeekContentWithFallback, calcWeekStats, getProgressColor, getWeekMirrorInfo } = useWorkoutHelpers(livePlan);

  // Add exercise dialog state
  const [addExerciseDialog, setAddExerciseDialog] = useState<{
    open: boolean;
    weekKey: string | null;
    dayIndex: number | null;
    mode: 'ai' | 'manual';
  }>({
    open: false,
    weekKey: null,
    dayIndex: null,
    mode: 'manual'
  });

  const { updateExercise, isUpdating } = useExerciseEditor();
  const { addExercise } = useAddExercise();

  // Scroll container ref for scroll stabilization
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Derive all state from selectedDate (single source of truth)
  const activeWeek = useMemo(() => getWeekKeyForDate(selectedDate), [selectedDate, getWeekKeyForDate]);

  const activeDayIndex = useMemo(() => {
    if (!livePlan?.created_at) return 0;
    const { dayIndex } = getWorkoutWeekDay(livePlan.created_at, selectedDate);
    return dayIndex;
  }, [selectedDate, livePlan?.created_at]);

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
    isCached,
    dataUpdatedAt
  } = useWeekCompletion({
    planId: livePlan?.id,
    weekKey: wk,
    enabled: !!user && !!livePlan,
    availableWeeks: livePlan?.content ? Object.keys(livePlan.content) : []
  });

  // Helper function to fetch week completion
  const fetchWeekCompletion = async (weekKey: string) => {
    if (!user || !livePlan?.id) throw new Error('User or planId not available');
    const { where, Timestamp } = await import('firebase/firestore');
    const { CompletionKey } = await import('@/lib/completionUtils');
    const logsRef = collection(db, 'users', user.uid, 'workout_logs');
    const snap = await getDocs(query(logsRef,
      where('planId',  '==', livePlan.id),
      where('weekKey', '==', weekKey),
    ));
    const completionMap: Record<string, boolean> = {};
    snap.forEach(d => {
      const data = d.data();
      if (data.completed && data.exerciseIndex != null && data.dayIndex != null) {
        completionMap[`${data.weekKey}_${data.dayIndex}_${data.exerciseIndex}`] = true;
      }
    });
    return completionMap;
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
    const newWeekNum = Math.min(52, currentWeekNum + 1);
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

  // Update hash whenever activeWeek or activeDayIndex changes
  useEffect(() => {
    const weekNum = Number(wk.match(/\d+/)?.[0] ?? 1);
    updateHash(weekNum, activeDayIndex);
  }, [activeWeek, activeDayIndex, wk]);

  // Handle day click in calendar
  const handleDayClick = useCallback((dayIndex: number) => {
    // Update selected date - this will automatically update expandedDay via activeDayIndex
    const newDate = getDateFor(wk, dayIndex);
    if (newDate) {
      handleDateChange(newDate);
    }
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

            // Sync updated exercises to TrainingContext for instant UI update
            const weekData = getWeekContentWithFallback(weekKey);
            const dayData = weekData[dayIndex];
            const updatedExercises = dayData?.exercises || [];
            syncFromPlan(updatedExercises, weekKey, dayIndex);

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
  const handleOpenAddExercise = (weekKey: string, dayIndex: number, mode: 'ai' | 'manual' = 'manual') => {
    setAddExerciseDialog({
      open: true,
      weekKey,
      dayIndex,
      mode
    });
    logEvent('add_exercise_dialog_opened', { weekKey, dayIndex, mode });
  };

  const handleAddExercise = (exercise: Exercise) => {
    if (!addExerciseDialog.weekKey || addExerciseDialog.dayIndex === null || !livePlan?.id) {
      return;
    }

    const targetWeekKey = addExerciseDialog.weekKey;
    const targetDayIndex = addExerciseDialog.dayIndex;

    // Capture scroll position before adding
    const prevScroll = scrollContainerRef.current?.scrollTop ?? 0;

    // Add to backend via mutation
    addExercise(
      {
        planId: livePlan.id,
        weekKey: targetWeekKey,
        dayIndex: targetDayIndex,
        exercise,
      },
      {
        onSuccess: () => {
          // Invalidate all week completions to refresh progress rings
          ['Week 1', 'Week 2', 'Week 3', 'Week 4'].forEach(weekKey => {
            queryClient.invalidateQueries({
              queryKey: ['week-completion', livePlan.id, weekKey]
            });
          });

          // Restore scroll position after DOM update
          requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollTop = prevScroll;
            }
          });
        }
      }
    );

    setAddExerciseDialog({ open: false, weekKey: null, dayIndex: null, mode: 'manual' });
  };

  // Handle AI autofill
  const handleAutoFill = (weekKey: string, dayIndex: number) => {
    handleOpenAddExercise(weekKey, dayIndex, 'ai');
    logEvent('ai_autofill_opened', { weekKey, dayIndex });
  };

  // Delete exercise with undo toast
  const handleDeleteExercise = (weekKey: string, dayIndex: number, exerciseIndex: number) => {
    if (!livePlan?.id) return;

    // Capture scroll position before deleting
    const prevScroll = scrollContainerRef.current?.scrollTop ?? 0;

    // Get the exercise from weekData before deleting
    const weekContent = getWeekContentWithFallback(weekKey);
    const dayData = weekContent[dayIndex];
    const exercise = dayData?.exercises?.[exerciseIndex];

    if (!exercise) {
      console.error('Exercise not found for deletion');
      return;
    }

    // Store deleted exercise for undo
    lastDeletedRef.current = {
      exercise,
      weekKey,
      dayIndex,
      exerciseIndex,
    };

    // Delete from backend (TrainingContext will sync via useEffect when weekData updates)
    deleteExercise(
      {
        planId: livePlan.id,
        weekKey,
        dayIndex,
        exerciseIndex,
      },
      {
        onSuccess: () => {
          // Restore scroll position after DOM update
          requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollTop = prevScroll;
            }
          });

          // Show undo toast
          toast({
            title: "Exercise deleted",
            description: exercise.name,
            duration: 4000,
            action: (
              <ToastButton
                variant="outline"
                size="sm"
                onClick={() => handleUndoDelete()}
              >
                UNDO
              </ToastButton>
            ),
          });

          logEvent('exercise_deleted', { weekKey, dayIndex, exerciseIndex, exerciseName: exercise.name });
        },
        onError: (error) => {
          toast({
            title: "Failed to delete exercise",
            description: error instanceof Error ? error.message : "Please try again",
            variant: "destructive",
          });
        },
      }
    );
  };

  // Undo delete handler
  const handleUndoDelete = () => {
    if (!lastDeletedRef.current || !livePlan?.id) return;

    const { exercise, weekKey, dayIndex, exerciseIndex } = lastDeletedRef.current;

    // Capture scroll position before restoring
    const prevScroll = scrollContainerRef.current?.scrollTop ?? 0;

    // Restore to backend (TrainingContext will sync via useEffect when weekData updates)
    restoreExercise(
      {
        planId: livePlan.id,
        weekKey,
        dayIndex,
        exerciseIndex,
        exercise,
      },
      {
        onSuccess: () => {
          // Restore scroll position after DOM update
          requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollTop = prevScroll;
            }
          });

          toast({
            title: "Exercise restored",
            description: exercise.name,
            duration: 2000,
          });

          logEvent('exercise_restored', { weekKey, dayIndex, exerciseIndex, exerciseName: exercise.name });

          // Clear the ref
          lastDeletedRef.current = null;
        },
        onError: (error) => {
          toast({
            title: "Failed to restore exercise",
            description: error instanceof Error ? error.message : "Please try again",
            variant: "destructive",
          });
        },
      }
    );
  };

  // Memoize week data to prevent recalculation - Moved up for Hook Rules
  const weekData = useMemo(() => getWeekContentWithFallback(wk), [wk, getWeekContentWithFallback]);

  // Get mirror info for the current week - Moved up for Hook Rules
  const mirrorInfo = useMemo(() => getWeekMirrorInfo(wk), [wk, getWeekMirrorInfo]);

  // Sync exercises to TrainingContext whenever selected date/week/day changes - Moved up for Hook Rules
  useEffect(() => {
    // Only sync if we have a plan and data
    if (!livePlan) return;

    const dayData = weekData[activeDayIndex];
    const exercises = dayData?.exercises || [];
    syncFromPlan(exercises, wk, activeDayIndex);
  }, [wk, activeDayIndex, weekData, syncFromPlan, livePlan]);

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

  // Compute header date from active day or fallback to day 0
  const headerDate = getDateFor(wk, activeDayIndex ?? 0) ?? getDateFor(wk, 0);
  const monthYear = headerDate ? format(headerDate, 'MMM yyyy', {
    locale: de
  }) : '';

  return (
    <WorkoutErrorBoundary>
      <div
        className="space-y-3"
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

        {/* Weekly Calendar Navigation */}
        <WeekNavigation
          wk={wk}
          monthYear={monthYear}
          activeDayIndex={activeDayIndex}
          getDateFor={getDateFor}
          isDayCompleted={isDayCompleted}
          isTodayInWeekDay={isTodayInWeekDay}
          onPrevWeek={handlePrevWeek}
          onNextWeek={handleNextWeek}
          onDayClick={handleDayClick}
        />

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
        <WeekProgress
          currentWeekNum={currentWeekNum}
          focusedWeek={focusedWeek}
          setFocusedWeek={setFocusedWeek}
          handleWeekActivation={handleWeekActivation}
          getWeekStats={(weekNum) => {
            const weekKey = `Week ${weekNum}`;
            // Get completion data from subscribed queries
            const weekCompletionData = weekNum === 1 ? week1Completion :
              weekNum === 2 ? week2Completion :
                weekNum === 3 ? week3Completion :
                  week4Completion;
            return calcWeekStats(weekKey, weekCompletionData);
          }}
          getProgressColor={getProgressColor}
        />

        {/* Week Section (Day Accordion) */}
        <DayAccordion
          wk={wk}
          currentWeekNum={currentWeekNum}
          weekProgress={weekProgress}
          weekData={weekData}
          expandedDay={expandedDay}
          getDateFor={getDateFor}
          isDayCompleted={isDayCompleted}
          isDayInFuture={isDayInFuture}
          isTodayInWeekDay={isTodayInWeekDay}
          onDayExpand={(dayIndex: number) => {
            // Update selected date - this will automatically sync expandedDay
            const newDate = getDateFor(wk, dayIndex);
            if (newDate) {
              handleDateChange(newDate);
            }
          }}
          onOpenAddExercise={handleOpenAddExercise}
          onAutoFill={handleAutoFill}
          onUpdateExercise={(dayIndex, exerciseIndex, updatedExercise) =>
            handleUpdateExercise(wk, dayIndex, exerciseIndex, updatedExercise)
          }
          onDeleteExercise={(dayIndex, exerciseIndex) =>
            handleDeleteExercise(wk, dayIndex, exerciseIndex)
          }
          isUpdating={isUpdating}
          onFeedbackSubmit={(weekKey, dayIndex) => {
            logEvent('ai_feedback_submitted', { weekKey, dayIndex });
          }}
        />

        {/* Add Workout Modal */}
        <AddWorkoutModal
          isOpen={addExerciseDialog.open}
          onClose={() =>
            setAddExerciseDialog({ open: false, weekKey: null, dayIndex: null, mode: 'manual' })
          }
          mode={addExerciseDialog.mode}
          dayContext={
            addExerciseDialog.weekKey && addExerciseDialog.dayIndex !== null
              ? { weekKey: addExerciseDialog.weekKey, dayIndex: addExerciseDialog.dayIndex }
              : undefined
          }
          onWorkoutAdded={() => {
            // Invalidate queries to refresh the view
            queryClient.invalidateQueries({ queryKey: ['workout-plan', planId] });
            ['Week 1', 'Week 2', 'Week 3', 'Week 4'].forEach(weekKey => {
              queryClient.invalidateQueries({
                queryKey: ['week-completion', livePlan.id, weekKey]
              });
            });
          }}
        />
      </div>
    </WorkoutErrorBoundary>
  );
};

export default WorkoutView;