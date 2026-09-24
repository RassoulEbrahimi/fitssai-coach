import React, { useRef, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { WifiOff, RefreshCw, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { format } from 'date-fns';
import { getWorkoutWeekDay } from "@/lib/workoutDateUtils";
import ExerciseListSkeleton from "@/components/skeletons/ExerciseListSkeleton";
import TodayWorkoutCard, { type TodayExecutionControls, type TodayExecutionView } from "@/components/TodayWorkoutCard";
import { useAuth } from "@/hooks/useAuth";
import { useBerlinToday } from "@/hooks/useBerlinToday";
import { useWeekCompletion } from "@/hooks/useWeekCompletion";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { logEvent } from "@/lib/telemetryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

import { useExerciseEditor, type Exercise } from "@/hooks/useExerciseEditor";
import { useWorkoutHelpers } from "@/hooks/useWorkoutHelpers";
import { normalizeWeekKey } from "@/lib/workoutPlanUtils";
import { useAddExercise } from "@/hooks/useAddExercise";
import { useReorderExercise } from "@/hooks/useReorderExercise";
import { useTrainingData, useTrainingSession } from "@/contexts/TrainingContext";
import { useDeleteExercise } from "@/hooks/useDeleteExercise";
import { useRestoreExercise } from "@/hooks/useRestoreExercise";
import { Button as ToastButton } from "@/components/ui/button";
import { PlanEditBlockedError } from "@/lib/exerciseHistoryGuard";
import { WorkoutPlan } from "@/lib/types";
import { WorkoutLog } from "@/lib/types";
import { resolveSessionWorkoutDay } from "@/lib/workoutExecution";
import { filterDaySessionLogs, isCompletedDayLog } from "@/lib/workoutCompletion";
import {
  buildPlanOverview,
  buildWeekAgenda,
  dayToDate,
  findNextWeekWorkout,
  getPlanCalendar,
  readDayExercises,
  resolveDatedDay,
  resolveDayDetailAction,
  resolvePlanPosition,
  resolveTodayState,
  summarizeWorkoutDay,
  WORKOUT_TITLE_FALLBACK,
  type PlanDayRef,
  type RunningSession,
  type TrainingsplanInputs,
} from "@/lib/trainingsplanModel";
import { buildReplacement, isDayLockedBySession } from "@/lib/trainingsplanEdit";

// Trainingsplan V2 screens
import { TodayModule } from "@/components/trainingsplan/TodayModule";
import { NextWeekTeaser, WeekAgenda } from "@/components/trainingsplan/WeekAgenda";
import { CurrentPlanRow, TrainingsplanHeader } from "@/components/trainingsplan/PlanHeader";
import { DayDetail } from "@/components/trainingsplan/DayDetail";
import { DayEditSurface } from "@/components/trainingsplan/DayEditSurface";
import { PlanOverview } from "@/components/trainingsplan/PlanOverview";
import { useTrainingsplanNavigation } from "@/components/trainingsplan/useTrainingsplanNavigation";
import "@/components/trainingsplan/trainingsplan.css";

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
  /** Day detail and editing are focused tasks: the global navigation steps aside. */
  onBottomNavHiddenChange?: (hidden: boolean) => void;
}

/** One stable empty list, so an empty day does not look like a changed one. */
const EMPTY_EXERCISES: Exercise[] = [];

const WorkoutView: React.FC<WorkoutViewProps> = ({
  workoutPlan,
  workoutLogs,
  selectedDate,
  isDayCompleted,
  onBottomNavHiddenChange,
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { syncFromPlan } = useTrainingData();
  const { isStarted, session } = useTrainingSession();
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
      return {
        id: snap.id,
        user_id: user!.uid,
        content: d.content ?? {},
        // Keep the plan's start date: the calendar's plan-day resolution and
        // the four-week lifecycle are both anchored to it. This used to be
        // hardcoded to '' and would have wiped it once the query ran.
        created_at: d.createdAt instanceof Timestamp
          ? d.createdAt.toDate().toISOString()
          : workoutPlan?.created_at ?? null,
      } as unknown as WorkoutPlan;
    },
    enabled: !!planId,
    initialData: workoutPlan,
    staleTime: 1000 * 60 * 5,
  });

  // Use consolidated workout helpers hook
  const { getWeekContentWithFallback, getWeekMirrorInfo } = useWorkoutHelpers(livePlan);

  const { updateExercise } = useExerciseEditor();
  const { addExercise } = useAddExercise();
  const { reorderExerciseAsync } = useReorderExercise();

  /*
    Where the Trainingsplan tab is: Main at the root, with Day Detail, Plan
    Overview and editing pushed on top and popped in reverse, through the
    browser history. Browsing never touches the running workout: the card
    below is always given today, and a bound session ignores even that.
  */
  const { screen, push, back } = useTrainingsplanNavigation(planId);

  /*
    Today, in Berlin. The card is always given today's plan day: it is what
    "Training starten" binds, and nothing the user browses can change it. A
    running session is resolved by the card from the session itself.
  */
  const todayStr = useBerlinToday();
  const cardDate = useMemo(() => dayToDate(todayStr), [todayStr]);
  const calendar = useMemo(() => getPlanCalendar(livePlan?.created_at), [livePlan?.created_at]);
  const { cardWeekKey, cardDayIndex } = useMemo(() => {
    const position = calendar ? resolvePlanPosition(calendar, todayStr) : null;
    if (position?.status === "active") {
      return { cardWeekKey: position.weekKey, cardDayIndex: position.dayIndex };
    }
    // Outside the programme the card offers nothing to start; keep the
    // clamped position it has always been given.
    if (!livePlan?.created_at) return { cardWeekKey: "Week 1", cardDayIndex: 0 };
    const clamped = getWorkoutWeekDay(livePlan.created_at, cardDate);
    return { cardWeekKey: normalizeWeekKey(clamped.weekKey), cardDayIndex: clamped.dayIndex };
  }, [calendar, todayStr, livePlan?.created_at, cardDate]);
  const wk = cardWeekKey;

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

  /*
    The banner is a hard failure notice, so it only appears when the page has
    nothing usable to show. It used to render on any query error, which meant
    it also fired while offline (on top of the offline banner) and while cached
    completion data was on screen — including next to the completed-plan
    notice, which comes from the plan itself and loads fine either way.
  */
  const hasCompletionData = Object.keys(completionMap).length > 0;
  const showLoadError =
    isCompletionError && isOnline && !isLoadingCompletion && !hasCompletionData;

  // --- Trainingsplan V2 model ---------------------------------------------

  const runningSession = useMemo<RunningSession | null>(() => {
    if (!isStarted) return null;
    // A session from another plan names no day here; the Dashboard ends it.
    if (!session || session.planId !== livePlan?.id) return { weekKey: null, dayIndex: null, workoutDay: null };
    return {
      weekKey: session.weekKey,
      dayIndex: session.dayIndex,
      workoutDay: resolveSessionWorkoutDay(session, livePlan) ?? null,
    };
  }, [isStarted, session, livePlan]);

  const inputs = useMemo<TrainingsplanInputs | null>(() => calendar && {
    calendar,
    readWeek: getWeekContentWithFallback,
    today: todayStr,
    isDayCompleted,
    session: runningSession,
  }, [calendar, getWeekContentWithFallback, todayStr, isDayCompleted, runningSession]);

  const todayState = useMemo(() => inputs && resolveTodayState(inputs, isStarted), [inputs, isStarted]);
  const agenda = useMemo(() => inputs && buildWeekAgenda(inputs), [inputs]);
  const nextWeekWorkout = useMemo(() => inputs && findNextWeekWorkout(inputs), [inputs]);
  const overview = useMemo(() => inputs && buildPlanOverview(inputs), [inputs]);

  /** Today's measured duration, only when the day session record stored one. */
  const completedMinutes = useMemo(() => {
    const record = filterDaySessionLogs(workoutLogs ?? []).find(
      (log) => isCompletedDayLog(log) && log.workout_day === todayStr
    );
    const seconds = record?.duration_sec;
    return typeof seconds === "number" && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null;
  }, [workoutLogs, todayStr]);

  const activeTitle = useMemo(() => {
    if (!runningSession || runningSession.weekKey === null || runningSession.dayIndex === null) {
      return WORKOUT_TITLE_FALLBACK;
    }
    return summarizeWorkoutDay(getWeekContentWithFallback(runningSession.weekKey)[runningSession.dayIndex]).title;
  }, [runningSession, getWeekContentWithFallback]);

  // --- Navigation between the V2 screens ----------------------------------

  const openDay = useCallback((day: PlanDayRef) => {
    logEvent('trainingsplan_day_opened', { weekKey: day.weekKey, dayIndex: day.dayIndex });
    push({ kind: "detail", day: { weekKey: day.weekKey, dayIndex: day.dayIndex, workoutDay: day.workoutDay } });
  }, [push]);
  const openPlan = useCallback(() => {
    logEvent('trainingsplan_plan_opened', {});
    push({ kind: "plan" });
  }, [push]);
  const openEdit = useCallback((day: PlanDayRef) => push({ kind: "edit", day }), [push]);

  useEffect(() => {
    onBottomNavHiddenChange?.(screen.kind === "detail" || screen.kind === "edit");
  }, [screen.kind, onBottomNavHiddenChange]);
  useEffect(() => () => onBottomNavHiddenChange?.(false), [onBottomNavHiddenChange]);

  /*
    A workout deep link (#/workout?w=&d=) is applied by the Dashboard as a
    date change after the plan loads. The V2 tab has no selected day of its
    own, so a changed date opens that day's detail instead.
  */
  const selectedDayStr = format(selectedDate, 'yyyy-MM-dd');
  const lastSelectedDayRef = useRef(selectedDayStr);
  useEffect(() => {
    if (selectedDayStr === lastSelectedDayRef.current || !inputs) return;
    lastSelectedDayRef.current = selectedDayStr;
    const dated = resolveDatedDay(inputs, selectedDayStr);
    if (dated && readDayExercises(dated.day).length > 0) openDay(dated);
  }, [selectedDayStr, inputs, openDay]);

  // --- Start / resume, always through the card ----------------------------

  const controlsRef = useRef<TodayExecutionControls | null>(null);
  // The visible screen's primary action; focus returns here after the workout.
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const startToday = useCallback(() => controlsRef.current?.start(), []);
  const resumeWorkout = useCallback(() => controlsRef.current?.resume(), []);
  /** Day Detail's start: only the card's own day, so it can never bind another. */
  const startDay = useCallback((day: PlanDayRef) => {
    if (normalizeWeekKey(day.weekKey) !== normalizeWeekKey(cardWeekKey) || day.dayIndex !== cardDayIndex) return;
    if (day.workoutDay !== todayStr) return;
    controlsRef.current?.start();
  }, [cardWeekKey, cardDayIndex, todayStr]);

  /*
    --- Editing (Edit Mode, TRAINING-PLAN-V2-02) ------------------------------
    Every edit addresses one plan day by its own weekKey/dayIndex and rewrites
    only that day's exercise array, exactly like the existing editors. Nothing
    is propagated to other weeks or to later days with the same workout.
  */

  const isCardDay = useCallback(
    (weekKey: string, dayIndex: number) =>
      normalizeWeekKey(weekKey) === normalizeWeekKey(cardWeekKey) && dayIndex === cardDayIndex,
    [cardWeekKey, cardDayIndex]
  );

  /**
    A running workout reads its exercises live from its own plan day and keys
    set completion, drafts and the rest timer by exercise position. That day's
    structure is therefore locked while it runs - checked here as well as in
    the UI, so no path can change the live session under the user.
  */
  const isEditLocked = (weekKey: string, dayIndex: number) =>
    isDayLockedBySession(isStarted ? session : null, livePlan?.id, livePlan?.content, { weekKey, dayIndex });

  /** Progress rings count exercises, so every week's completion is refreshed. */
  const invalidateWeekCompletions = () => {
    if (!livePlan?.id) return;
    ['Week 1', 'Week 2', 'Week 3', 'Week 4'].forEach((weekKey) => {
      queryClient.invalidateQueries({ queryKey: ['week-completion', livePlan.id, weekKey] });
    });
  };

  // Exercise update (the replace path); returns a promise for async handling
  const handleUpdateExercise = async (
    weekKey: string,
    dayIndex: number,
    exerciseIndex: number,
    updatedExercise: Exercise,
    /** The exercise the user acted on; the update is refused if it moved away. */
    expectedName?: string
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
          expectedName,
        },
        {
          onSuccess: () => {
            // Refresh progress rings.
            invalidateWeekCompletions();

            // The pre-start cache holds today's day only; an edit to another
            // day must not replace it.
            if (isCardDay(weekKey, dayIndex)) {
              const weekData = getWeekContentWithFallback(weekKey);
              const dayData = weekData[dayIndex];
              const updatedExercises = dayData?.exercises || [];
              syncFromPlan(updatedExercises, weekKey, dayIndex);
            }

            resolve();
          },
          onError: () => {
            resolve();
          },
        }
      );
    });
  };

  /**
    Swaps the exercise at a position for a catalogue entry the user picked.
    `current` is the exercise the user saw there, which carries the
    prescription over.
  */
  const handleReplaceExercise = (weekKey: string, dayIndex: number, exerciseIndex: number, name: string, current: Exercise) => {
    if (isEditLocked(weekKey, dayIndex)) return;
    logEvent('exercise_replaced', { weekKey, dayIndex, exerciseIndex, from: current.name, to: name });
    void handleUpdateExercise(weekKey, dayIndex, exerciseIndex, buildReplacement(current, name), current.name);
  };

  /** One exercise moved within one plan day; everything else keeps its data. Resolves once settled. */
  const handleMoveExercise = async (weekKey: string, dayIndex: number, fromIndex: number, toIndex: number, exerciseName: string) => {
    if (!livePlan?.id || isEditLocked(weekKey, dayIndex)) return;
    logEvent('exercise_reordered', { weekKey, dayIndex, fromIndex, toIndex });
    // Per-call promise: every move reports its own outcome, however quickly they follow.
    try {
      await reorderExerciseAsync({ planId: livePlan.id, weekKey, dayIndex, fromIndex, toIndex, exerciseName });
      invalidateWeekCompletions();
    } catch {
      // Reported by the shared handler; the cache is reconciled with the server.
    }
  };

  /** Appends a confirmed exercise to the end of one plan day. */
  const handleAddExercise = (weekKey: string, dayIndex: number, exercise: Exercise) => {
    if (!livePlan?.id || isEditLocked(weekKey, dayIndex)) return;
    logEvent('exercise_added', { weekKey, dayIndex, exerciseName: exercise.name });
    addExercise(
      { planId: livePlan.id, weekKey, dayIndex, exercise },
      { onSuccess: invalidateWeekCompletions }
    );
  };

  // Delete exercise with undo toast
  const handleDeleteExercise = (weekKey: string, dayIndex: number, exerciseIndex: number, knownExercise?: Exercise) => {
    if (!livePlan?.id || isEditLocked(weekKey, dayIndex)) return;

    // The exercise the caller saw at that place, else the one on record, kept for undo
    const exercise = knownExercise ?? getWeekContentWithFallback(weekKey)[dayIndex]?.exercises?.[exerciseIndex];

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
        // Never remove whatever else holds the position by the time this runs.
        expectedName: exercise.name,
      },
      {
        onSuccess: () => {
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
          // A refused delete already explains itself through the shared
          // handler; a second "failed to delete" would bury the reason.
          if (error instanceof PlanEditBlockedError) return;
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
          // Same as the delete path: the refusal has already been reported
          // with its real reason.
          if (error instanceof PlanEditBlockedError) return;
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

  // Keep the pre-start cache on today's plan day. Browsing never changes it.
  useEffect(() => {
    if (!livePlan) return;

    const dayData = weekData[cardDayIndex];
    const exercises = dayData?.exercises || [];
    syncFromPlan(exercises, wk, cardDayIndex);
  }, [wk, cardDayIndex, weekData, syncFromPlan, livePlan]);

  /*
    The Today module, rendered by the card so it reads the running session
    straight from execution. Only the main tab shows it; on pushed screens the
    card stays mounted (so resume and the rest timer keep working) but draws
    nothing outside Focus Mode.
  */
  const isMain = screen.kind === "main";
  const renderOverview = useCallback((exec: TodayExecutionView) => {
    if (!isMain || !todayState || !calendar) return null;
    return (
      <TodayModule
        state={todayState}
        exec={exec}
        today={todayStr}
        activeTitle={activeTitle}
        completedMinutes={completedMinutes}
        planStartDay={calendar.startDay}
        primaryRef={primaryActionRef}
        onStart={startToday}
        onResume={resumeWorkout}
        onOpenDay={openDay}
      />
    );
  }, [isMain, todayState, calendar, todayStr, activeTitle, completedMinutes, startToday, resumeWorkout, openDay]);

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

  const planFinished = todayState?.kind === "plan-finished";
  const planWeekNumber = agenda?.weekNumber ?? overview?.weekNumber ?? null;
  const totalWeeks = calendar?.totalWeeks ?? 4;

  const detailDay = screen.kind === "detail" || screen.kind === "edit" ? screen.day : null;
  const detailContent = detailDay
    ? getWeekContentWithFallback(detailDay.weekKey)[detailDay.dayIndex] ?? null
    : null;
  const detailSummary = summarizeWorkoutDay(detailContent);
  const editExercises = (detailContent?.exercises ?? EMPTY_EXERCISES) as Exercise[];
  const detailInPlan = !!(detailDay && inputs && resolveDatedDay(inputs, detailDay.workoutDay));

  return (
    <WorkoutErrorBoundary>
      {/*
        One stable container: the card keeps its place in the tree whichever
        screen is showing, so pushing a screen never remounts the running
        workout, its drafts or its rest timer.
      */}
      <div className={isMain ? "tp-root" : undefined} data-screen={isMain ? "main" : undefined}>
        {isMain && (
          <TrainingsplanHeader
            weekNumber={planWeekNumber}
            totalWeeks={totalWeeks}
            finished={planFinished}
            onOpenPlan={openPlan}
          />
        )}

        {/* Offline Indicator */}
        {isMain && (
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
        )}

        {/* Error State */}
        {isMain && (
          <AnimatePresence>
            {showLoadError && (
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
                          Trainingsfortschritt konnte nicht geladen werden
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
        )}

        {/* The execution host. On the main tab it draws the Today module. */}
        <TodayWorkoutCard
          selectedDate={cardDate}
          weekKey={wk}
          dayIndex={cardDayIndex}
          workoutPlan={livePlan}
          mirrorInfo={mirrorInfo}
          completionMap={completionMap}
          isLoading={isLoadingCompletion}
          toggleExercise={toggleExercise}
          isToggling={isToggling}
          isOnline={isOnline}
          isCached={isCached}
          dataUpdatedAt={dataUpdatedAt}
          renderOverview={renderOverview}
          controlsRef={controlsRef}
          focusReturnRef={primaryActionRef}
        />

        {isMain && agenda && !planFinished && (
          <WeekAgenda agenda={agenda} onOpenDay={openDay} onResume={resumeWorkout} />
        )}

        {isMain && nextWeekWorkout && !planFinished && (
          <NextWeekTeaser workout={nextWeekWorkout} onOpenDay={openDay} />
        )}

        {isMain && overview && (
          <CurrentPlanRow
            weekNumber={planWeekNumber}
            totalWeeks={totalWeeks}
            finished={planFinished}
            trainingDaysPerWeek={overview.trainingDaysPerWeek}
            onOpenPlan={openPlan}
          />
        )}

        {screen.kind === "detail" && inputs && (
          <DayDetail
            day={screen.day}
            summary={detailSummary}
            exercises={readDayExercises(detailContent)}
            action={resolveDayDetailAction(inputs, screen.day, isStarted)}
            isToday={screen.day.workoutDay === todayStr}
            isCompleted={isDayCompleted(screen.day.weekKey, screen.day.dayIndex)}
            onBack={back}
            onEdit={detailInPlan ? () => openEdit(screen.day) : undefined}
            onStart={() => startDay(screen.day)}
            onResume={resumeWorkout}
            primaryRef={primaryActionRef}
          />
        )}

        {screen.kind === "edit" && (
          <DayEditSurface
            day={screen.day}
            title={detailSummary.title}
            exercises={editExercises}
            lockedBySession={isEditLocked(screen.day.weekKey, screen.day.dayIndex)}
            onCancel={back}
            onDone={back}
            onMove={(fromIndex, toIndex, exerciseName) =>
              handleMoveExercise(screen.day.weekKey, screen.day.dayIndex, fromIndex, toIndex, exerciseName)
            }
            onReplace={(exerciseIndex, name, current) =>
              handleReplaceExercise(screen.day.weekKey, screen.day.dayIndex, exerciseIndex, name, current)
            }
            onRemove={(exerciseIndex, exercise) =>
              handleDeleteExercise(screen.day.weekKey, screen.day.dayIndex, exerciseIndex, exercise)
            }
            onAdd={(exercise) => handleAddExercise(screen.day.weekKey, screen.day.dayIndex, exercise)}
          />
        )}

        {screen.kind === "plan" && overview && (
          <PlanOverview
            model={overview}
            createdDay={livePlan.created_at ? format(new Date(livePlan.created_at), 'yyyy-MM-dd') : null}
            onBack={back}
            onOpenDay={openDay}
          />
        )}

      </div>
    </WorkoutErrorBoundary>
  );
};

export default WorkoutView;
