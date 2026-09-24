import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import WorkoutSummaryModal from "@/components/workout/WorkoutSummaryModal";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { isBerlinPast, isBerlinFuture } from "@/lib/dateUtils";
import { useBerlinToday } from "@/hooks/useBerlinToday";
import { Play, WifiOff, Clock, Dumbbell, Maximize2, Minimize2 } from "lucide-react";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import FocusModePortal from "@/components/FocusModePortal";
import { isFocusableElement, useFocusModeContainment } from "@/hooks/useFocusModeContainment";
import { logEvent } from "@/lib/telemetryClient";
import { CompletionState } from "@/lib/completionUtils";
import { useThrottledToast } from "@/hooks/useThrottledToast";
import { TodayWorkoutSkeleton } from "@/components/skeletons/TodayWorkoutSkeleton";
import { useTraining } from "@/contexts/TrainingContext";
import { useFocusMode } from "@/contexts/FocusModeContext";
import { useWorkoutExecution, type ExecutionProgress } from "@/hooks/useWorkoutExecution";
import { buildRecordedPerformance, resolveSessionWorkoutDay, type ExecutionExercise, type ExecutionTarget } from "@/lib/workoutExecution";
import { setPerformanceFieldId } from "@/lib/setPerformanceDrafts";
import { FutureWorkoutDayError, recordSuccessfulWorkoutFinish, type SessionRecordOutcome } from "@/lib/sessionRecord";
import { useRestTimer } from "@/hooks/useRestTimer";
import ActiveWorkoutSession from "@/components/workout/ActiveWorkoutSession";
import RestBottomSheet from "@/components/workout/RestBottomSheet";
import { parseRestTime } from "@/lib/restTimeParser";
import workoutHeroBg from "@/assets/workout-hero-bg.jpg";
import "@/components/workout/workoutPresentation.css";

// Helper to get localStorage key for started state
const getStartedStorageKey = (dateStr: string) => `fitssai.workout_started_${dateStr}`;

// Helper to get localStorage key for timer start time
const getTimerStorageKey = (dateStr: string) => `fitssai.workout_timer_start_${dateStr}`;

/**
 * The running workout as the Trainingsplan overview reads it. Read-only
 * values plus the card's own start and resume, so the overview never binds a
 * session itself.
 */
export interface TodayExecutionView {
  isStarted: boolean;
  isBound: boolean;
  target: ExecutionTarget;
  exercises: ExecutionExercise[];
  progress: ExecutionProgress;
  getCompletedSetsCount: (exerciseIndex: number) => number;
  durationSeconds: number;
  /** The selected week's completion or the bound day's sets are still loading. */
  isLoading: boolean;
}

/** The card's start and resume, for surfaces outside it (Day Detail). */
export interface TodayExecutionControls {
  /** Starts the card's day. A running session is resumed instead, never replaced. */
  start: () => void;
  /** Opens the running workout. Does nothing when no session runs. */
  resume: () => void;
}

interface TodayWorkoutCardProps {
  selectedDate: Date;
  weekKey: string;
  dayIndex: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  /**
   * Trainingsplan V2. Outside Focus Mode the card renders this instead of its
   * own hero; the running workout itself, its finish flow and the rest timer
   * stay here unchanged. Without it the card renders as it always has.
   */
  renderOverview?: (view: TodayExecutionView) => React.ReactNode;
  /** Receives the card's start and resume for surfaces outside it. */
  controlsRef?: React.MutableRefObject<TodayExecutionControls | null>;
  /**
   * Where focus goes when the workout closes and the control that opened it
   * is gone: the surface's own primary action (Fortsetzen, Training starten).
   */
  focusReturnRef?: React.RefObject<HTMLElement>;
}

/*
  Finishing has three outcomes and they are not interchangeable: the duration
  was stored, there was no trustworthy duration to store, or the write itself
  never landed. Only the last is worth retrying, and only the first may be
  reported as a saved training.
*/
const FINISH_RETRY_MESSAGE =
  'Training konnte nicht gespeichert werden. Deine Session bleibt aktiv. Bitte erneut versuchen.';
const FINISH_WITHOUT_DURATION_MESSAGE =
  'Training beendet. Die Dauer konnte nicht gemessen werden und wurde nicht gespeichert.';
/*
  A tick or a recorded value that was still being saved failed. Finishing now
  would record the workout without it, so the session stays open; the set
  shows its stored value again and can be entered again.
*/
const SET_WRITES_NOT_SAVED_MESSAGE =
  'Einige Satzangaben konnten nicht gespeichert werden. Deine Session bleibt aktiv. Bitte prüfe die Sätze und versuche es erneut.';

class SetWritesNotSavedError extends Error {
  constructor() {
    super('A set write that was still in flight failed.');
    this.name = 'SetWritesNotSavedError';
  }
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
  renderOverview,
  controlsRef,
  focusReturnRef,
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useThrottledToast();
  const { isFocusMode, setFocusMode } = useFocusMode();
  const {
    isStarted,
    duration,
    session,
    startSession,
    endSession,
    markFinishAttempt,
    clearFinishAttempt
  } = useTraining();

  const DEFAULT_DURATION = 10;
  // Use current live duration unless we need to freeze it (handled by modal now)
  const currentDuration = duration;

  /*
    Once the finish instant is stamped the summary shows what will actually be
    persisted, not a timer still running through a failed save and its retry.
    Before that it is the live duration, so the modal keeps ticking for anyone
    who opens it and goes back to training.
  */
  const summaryDuration = session?.endedAt !== undefined
    ? Math.max(0, Math.floor((session.endedAt - session.startedAt) / 1000))
    : currentDuration;

  // Format selected date for storage key
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');

  // NOTE: isStarted state is now managed globally in TrainingContext

  // Summary dialog state
  const [showSummary, setShowSummary] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const savingSessionRef = useRef(false);

  /*
    The running workout. Once a session is bound, its plan day decides the
    exercises, the set-tracking key, every set write and the progress; the
    selected calendar day only feeds the pre-start preview and what Start
    binds. Browsing the calendar mid-workout therefore changes nothing here.
  */
  const {
    target: executionTarget,
    isBound: isExecutionBound,
    exercises,
    progress: progressStats,
    isSetCompleted,
    getCompletedSetsCount,
    getActualPerformance,
    getPreviousExercise,
    toggleSetAsync,
    performance: setPerformance,
    whenSetWritesSettled,
    isTogglingSet,
    isLoadingSets,
  } = useWorkoutExecution(workoutPlan, { weekKey, dayIndex, workoutDay: selectedDateStr });

  // Rest timer hook. Owned here, above Focus Mode's portal, so toggling
  // fullscreen does not reset a running countdown.
  const restTimer = useRestTimer(user?.uid, session);
  const { startTimer, cancelTimerForSet } = restTimer;


  // Reactive Berlin "today" - updates automatically at midnight
  const berlinToday = useBerlinToday();

  // A running workout never collapses into the rest-day card, even when its
  // bound day has nothing to show: finishing has to stay reachable.
  const isRestDay = !isStarted && !exercises.length;

  // Handle toggling a set
  const handleToggleSet = useCallback((params: {
    exerciseIndex: number;
    setNumber: number;
    completed: boolean;
  }) => {
    if (!user || !workoutPlan) return;

    logEvent('set_toggle_ui', {
      weekKey: executionTarget.weekKey,
      dayIndex: executionTarget.dayIndex,
      exerciseIndex: params.exerciseIndex,
      setNumber: params.setNumber,
      completed: params.completed,
      exerciseName: exercises[params.exerciseIndex]?.name,
    });

    // Written to the execution target: the bound session's day, not the day
    // on screen.
    const rollbackRest = params.completed
      ? startTimer(params.exerciseIndex, parseRestTime(exercises[params.exerciseIndex]?.rest), params.setNumber)
      : undefined;
    if (!params.completed) cancelTimerForSet(params.exerciseIndex, params.setNumber);
    /*
      Completing a set is its own feedback: the row ticks and the prescribed
      rest starts. A success toast on top of that only covered the pause, so
      there is none (TRAINING-UI-06). A failed write still rolls the rest back,
      and the error paths below still speak up.
    */
    void toggleSetAsync(params).catch(() => rollbackRest?.());
  }, [user, workoutPlan, executionTarget.weekKey, executionTarget.dayIndex, exercises, toggleSetAsync, startTimer, cancelTimerForSet]);

  /*
    Focus Mode is a keyboard modal. Toggling it swaps FocusModePortal between a
    fragment and a portal, which remounts the whole card subtree: the control
    that had focus is detached on every enter and exit. So focus is placed
    explicitly on the way in (the exit button) and restored on the way out.
  */
  const [focusModeContainer, setFocusModeContainer] = useState<HTMLDivElement | null>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const focusModeEntryRef = useRef<Element | null>(null);
  const exitFocusMode = useCallback(() => setFocusMode(false), [setFocusMode]);

  useFocusModeContainment({
    active: isFocusMode,
    container: focusModeContainer,
    initialFocusRef: fullscreenButtonRef,
    onEscape: exitFocusMode,
  });

  const wasFocusModeRef = useRef(isFocusMode);
  useEffect(() => {
    const wasFocusMode = wasFocusModeRef.current;
    wasFocusModeRef.current = isFocusMode;
    if (isFocusMode || !wasFocusMode) return;

    const entry = focusModeEntryRef.current;
    focusModeEntryRef.current = null;
    // Only recover focus that went down with the portal; never steal it.
    const current = document.activeElement;
    if (current && current !== document.body && current.isConnected) return;
    /*
      The launching control if it still exists; otherwise the card's own
      fullscreen toggle. That covers "Training starten", which is gone once the
      workout has started, and a finished workout, where the toggle is the one
      control that is always present in the same place.
    */
    const target = isFocusableElement(entry)
      ? entry
      : fullscreenButtonRef.current ?? focusReturnRef?.current ?? document.getElementById("main-content");
    target?.focus({ preventScroll: true });
  }, [isFocusMode, focusReturnRef]);

  /*
    Start binds the card's own day - never a browsed one - and a session that
    is already running is resumed instead: nothing here creates a second one.
    The legacy Start button only shows while nothing runs, so the guard does
    not change it.
  */
  const startTraining = useCallback(() => {
    if (isStarted) {
      focusModeEntryRef.current = document.activeElement;
      setFocusMode(true);
      return;
    }
    if (isBerlinFuture(selectedDateStr)) {
      showToast(t('dashboard.futureDay.locked'), 'info');
      return;
    }
    // Bind the session to this exact plan day so a reload resumes the same
    // workout instead of re-attaching to whatever day is shown.
    if (workoutPlan?.id) {
      startSession({ planId: workoutPlan.id, weekKey, dayIndex, workoutDay: selectedDateStr });
    } else {
      startSession();
    }
    if (isFocusMode) {
      // Already fullscreen: the Start button is about to disappear, so keep
      // focus inside Focus Mode rather than letting it fall to the body.
      fullscreenButtonRef.current?.focus({ preventScroll: true });
      return;
    }
    focusModeEntryRef.current = document.activeElement;
    setFocusMode(true);
  }, [isStarted, selectedDateStr, showToast, t, workoutPlan?.id, startSession, weekKey, dayIndex, isFocusMode, setFocusMode]);

  // Back into the running workout. Never starts one.
  const resumeTraining = useCallback(() => {
    if (!isStarted) return;
    focusModeEntryRef.current = document.activeElement;
    setFocusMode(true);
  }, [isStarted, setFocusMode]);

  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = { start: startTraining, resume: resumeTraining };
  }, [controlsRef, startTraining, resumeTraining]);
  useEffect(() => {
    if (!controlsRef) return;
    return () => { controlsRef.current = null; };
  }, [controlsRef]);

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

  /*
    Trainingsplan V2: outside Focus Mode the overview replaces the hero. The
    running workout, its summary and the rest sheet below are exactly the
    legacy ones, so execution behaves the same whichever surface launched it.
    An open summary keeps the started view mounted until it resolves.
  */
  if (renderOverview && !isFocusMode && !showSummary) {
    return (
      <WorkoutErrorBoundary>
        {renderOverview({
          isStarted,
          isBound: isExecutionBound,
          target: executionTarget,
          exercises,
          progress: progressStats,
          getCompletedSetsCount,
          durationSeconds: currentDuration,
          isLoading: (isLoading && !isExecutionBound) || isLoadingSets,
        })}
        <RestBottomSheet rest={restTimer} exercises={exercises} />
      </WorkoutErrorBoundary>
    );
  }

  // Render skeleton loading state. The selected week's completion query says
  // nothing about a bound workout, so browsing never blanks a running one.
  if ((isLoading && !isExecutionBound) || isLoadingSets) {
    const cardTitle = getCardTitle();
    return <TodayWorkoutSkeleton title={cardTitle.text} titleClassName={cardTitle.className} />;
  }

  // Calculate estimated total duration
  const estimatedTotalMinutes = exercises.length * DEFAULT_DURATION;

  // Get workout name from plan or use default
  const workoutName = workoutPlan?.content?.name || t('todayWorkout.dailyWorkout');

  /*
    The day the hero names. A running workout names its own session's date;
    only before Start does it follow the calendar. An older session whose date
    cannot be recovered names no day rather than the one on screen.
  */
  const executionDate = isExecutionBound
    ? (executionTarget.workoutDay ? parseISO(executionTarget.workoutDay) : null)
    : selectedDate;

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

  const handleFinishTraining = () => {
    // Typed but unsaved set values are saved before the summary reports on
    // them. A value that cannot be saved keeps the user in the workout, at it.
    const [invalid] = setPerformance.commitAll();
    if (invalid) {
      const exerciseName = exercises[invalid.exerciseIndex]?.name;
      showToast(
        `Ungültige Eingabe${exerciseName ? ` bei ${exerciseName}` : ''}, Satz ${invalid.setNumber}. Bitte korrigieren.`,
        'error'
      );
      document.getElementById(setPerformanceFieldId(invalid.exerciseIndex, invalid.setNumber, invalid.field))?.focus();
      return;
    }
    // Show summary modal - timer continues running!
    setShowSummary(true);
  };

  const handleCloseSummary = async (shouldEndSession: boolean = false) => {
    if (savingSessionRef.current) return;
    if (!shouldEndSession) {
      // Back to training. The stamped finish instant goes with it, or the next
      // finish would be capped at the moment they first thought about stopping.
      clearFinishAttempt();
      setFinishError(null);
      setShowSummary(false);
      return;
    }

    savingSessionRef.current = true;
    setIsSavingSession(true);
    setFinishError(null);
    let outcome: SessionRecordOutcome;
    try {
      if (!user?.uid || !session) throw new Error("Missing session identity");
      /*
        Stamp when the user stopped training before anything can fail. A finish
        that is retried after a reconnect — or after a reload — then measures
        the workout instead of the wait, because every attempt reuses this same
        instant.
      */
      const endedAt = markFinishAttempt();
      if (endedAt === null) throw new Error("Missing session identity");
      if (!isOnline || !navigator.onLine) throw new Error("Offline");
      // Every tick and recorded value still being saved lands - or is durably
      // queued - before the workout is recorded as finished. No timer: the
      // writes themselves are awaited.
      const setWrites = await whenSetWritesSettled();
      if (setWrites.failed > 0) throw new SetWritesNotSavedError();
      // Older bound sessions have a plan position but no captured date. Resolve
      // only against that same plan, never against the selected UI day.
      const workoutDay = resolveSessionWorkoutDay(session, workoutPlan);
      if (!workoutDay) throw new Error("Missing session date");
      outcome = await recordSuccessfulWorkoutFinish({
        uid: user.uid,
        planId: session.planId,
        weekKey: session.weekKey,
        dayIndex: session.dayIndex,
        workoutDay,
        startedAt: session.startedAt,
        endedAt,
      });
    } catch (error) {
      // The write did not land — a rejection, or no connection to attempt it
      // over. Session, timer and stamped finish instant all stay put so the
      // same finish can be retried, and nothing claims to have been saved.
      logEvent('session_duration_write_failed', {
        weekKey: session?.weekKey,
        dayIndex: session?.dayIndex,
        message: error instanceof Error ? error.message : String(error),
      });
      const message = error instanceof FutureWorkoutDayError
        ? t('dashboard.futureDay.locked')
        : error instanceof SetWritesNotSavedError
          ? SET_WRITES_NOT_SAVED_MESSAGE
          : FINISH_RETRY_MESSAGE;
      setFinishError(message);
      showToast(message, 'error');
      return;
    } finally {
      savingSessionRef.current = false;
      setIsSavingSession(false);
    }

    /*
      Both outcomes that get here are terminal. `written` atomically stored
      completion and measurement; `skipped` established there was no measurement worth
      storing — a session left running past MAX_SESSION_SEC, or metadata the
      writer will not accept. Neither improves by being retried, and holding
      the session open for a retry that cannot succeed would strand the user in
      a workout they can never end. So the session ends either way, and only a
      written duration is reported as one.
    */
    endSession();
    setShowSummary(false);
    setFocusMode(false);
    if (outcome.status === "written") {
      // Read the acknowledged record through the existing consumers. Never
      // optimistically complete a day or refetch/regenerate the workout plan.
      void queryClient.invalidateQueries({ queryKey: queryKeys.logs.byPlan(session.planId, user.id) });
      void queryClient.invalidateQueries({ queryKey: ['weekly-activity', user.id] });
      showToast(t('todayWorkout.finishMessage'));
      return;
    }
    logEvent('session_ended_without_duration', {
      weekKey: session?.weekKey,
      dayIndex: session?.dayIndex,
      reason: outcome.reason,
    });
    showToast(FINISH_WITHOUT_DURATION_MESSAGE, 'info');
  };

  // Handle starting training - also enables fullscreen
  const handleStartTraining = startTraining;

  // Toggle fullscreen mode
  const toggleFullScreen = () => {
    if (!isFocusMode) focusModeEntryRef.current = document.activeElement;
    setFocusMode(!isFocusMode);
  };

  return (
    <WorkoutErrorBoundary>
      <FocusModePortal active={isFocusMode}>
      <div
        ref={setFocusModeContainer}
        role={isFocusMode ? "dialog" : undefined}
        aria-modal={isFocusMode ? true : undefined}
        aria-label={isFocusMode ? "Trainings-Fokusmodus" : undefined}
        className={
          isFocusMode
            ? "fixed inset-0 w-screen h-[100dvh] z-[99999] bg-background m-0 p-0 overflow-y-auto overscroll-contain"
            : ""
        }
        style={isFocusMode ? { isolation: 'isolate' } : undefined}
      >
        <Card className={
          isFocusMode
            ? "border-0 rounded-none shadow-none min-h-full bg-background pt-[env(safe-area-inset-top)]"
            : "border-border overflow-hidden shadow-lg"
        }>
          {/* Hero Header Section */}
          <div className={isFocusMode ? "relative h-32 sm:h-40" : "relative h-48 sm:h-56"}>
            <img
              src={workoutHeroBg}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/*
              Fixed dark scrim, not theme tokens. `from-background` resolves to
              white in light mode, so the white hero text sat on a white
              gradient and disappeared. The photo needs a dark scrim in both
              themes for the same white-on-image treatment to read.
            */}
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-zinc-950/70 to-zinc-900/40" />

            {/* Fullscreen toggle button - top right */}
            <button
              ref={fullscreenButtonRef}
              onClick={toggleFullScreen}
              className="absolute top-3 right-3 z-30 p-2 rounded-full bg-black/50 text-white/90 backdrop-blur-sm hover:bg-black/70 transition-colors"
              aria-label={isFocusMode ? "Vollbild beenden" : "Vollbild"}
            >
              {isFocusMode ? (
                <Minimize2 className="w-5 h-5" />
              ) : (
                <Maximize2 className="w-5 h-5" />
              )}
            </button>

            {/* Offline badge - positioned below fullscreen toggle */}
            {isOfflineData && (
              <div className="absolute top-14 right-3 z-20">
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
              {executionDate && (
                <Badge
                  variant="secondary"
                  className="w-fit mb-2 bg-primary/30 text-white border-none backdrop-blur-sm"
                >
                  {format(executionDate, 'EEEE', { locale: de })}
                </Badge>
              )}

              {/* Workout title */}
              <h2 className="text-2xl sm:text-3xl font-bold text-white drop-shadow-lg">
                {workoutName}
              </h2>

              {/* Metadata row */}
              <div className="flex items-center gap-4 mt-2 text-white/90 text-sm">
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
          <CardContent className={`pt-4 ${isFocusMode ? 'px-4 pb-safe' : ''}`}>
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
                      {exercises.slice(0, 3).map((exercise: ExecutionExercise, index: number) => (
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
                    onClick={handleStartTraining}
                    disabled={isFuture}
                    className="w-full mt-4 h-14 text-lg font-semibold gap-2"
                    size="lg"
                  >
                    <Play className="w-5 h-5" />
                    {t('todayWorkout.startTraining')}
                  </Button>
                  {isFuture && <p className="mt-2 text-sm text-muted-foreground">
                    {t('dashboard.futureDay.locked')}
                  </p>}
                </motion.div>
              ) : (
                /* Started view: set-based exercise list */
                <motion.div
                  key="started"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <ActiveWorkoutSession
                    exercises={exercises}
                    progress={progressStats}
                    durationSeconds={currentDuration}
                    isSetCompleted={isSetCompleted}
                    getCompletedSetsCount={getCompletedSetsCount}
                    getActualPerformance={getActualPerformance}
                    getPreviousExercise={getPreviousExercise}
                    onToggleSet={handleToggleSet}
                    isTogglingSet={isTogglingSet}
                    performance={setPerformance}
                    rest={restTimer}
                    onFinish={handleFinishTraining}
                  />

                  {/* Summary Modal */}
                  <WorkoutSummaryModal
                    open={showSummary}
                    isSaving={isSavingSession}
                    error={finishError}
                    onClose={() => handleCloseSummary(false)} // User dismissed without finishing
                    onFinish={() => handleCloseSummary(true)} // User clicked "Terminate/Save" in modal
                    exercises={exercises}
                    duration={summaryDuration}
                    workoutName={workoutName}
                    selectedDate={executionDate}
                    getCompletedSetsCount={getCompletedSetsCount}
                    getPreviousExercise={getPreviousExercise}
                    // Explicitly recorded values only; never the prescription.
                    recordedPerformance={showSummary
                      ? buildRecordedPerformance(exercises, isSetCompleted, getActualPerformance)
                      : []}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>
      </FocusModePortal>
      <RestBottomSheet rest={restTimer} exercises={exercises} />
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
    prev.isOnline === next.isOnline &&
    // The plan itself, not only its id: a bound workout reads its exercises
    // from the plan, so an edit to the running day has to reach the card.
    prev.workoutPlan === next.workoutPlan &&
    prev.renderOverview === next.renderOverview &&
    prev.controlsRef === next.controlsRef &&
    prev.focusReturnRef === next.focusReturnRef
  );
});
