import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dumbbell,
  Apple,
  User,
  RefreshCw,
  Calendar,
  Clock,
  TrendingUp,
  Target,
  Flame,
  Check,
  CheckCircle,
  ChevronDown,
  Lock
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { WorkoutLog, WeekContent } from "@/lib/types";
// Removed direct useQuery and supabase import for data fetching
import { ProfileCard } from "@/components/ProfileCard";
import VideoBackground from '@/components/VideoBackground';
import { useState, useEffect, Suspense, useRef, useCallback, useMemo, useLayoutEffect } from "react";
import React from "react";
import { toast } from "sonner";
import { format, addDays, isSameDay, startOfWeek, differenceInCalendarDays, startOfDay, parseISO } from "date-fns";
import { toZonedTime } from 'date-fns-tz';
import { FitssNavBar } from './FitssNavBar';
import { OfflineBanner } from '@/components/OfflineBanner';
import BottomNavPortal from './BottomNavPortal';
import { default as SectionSkeleton, WorkoutSkeleton, NutritionSkeleton, ProfileSkeleton } from "@/components/skeletons/SectionSkeleton";
import HomeSkeleton from "@/components/skeletons/HomeSkeleton";

import { useWorkoutPlan } from "@/hooks/queries/useWorkoutPlan";
import { useWorkoutLogs } from "@/hooks/queries/useWorkoutLogs";
import { useProfile } from "@/hooks/queries/useProfile";
import { useNutritionPlan } from "@/hooks/queries/useNutritionPlan";
import { useQueryClient } from "@tanstack/react-query";
import { useWeeklyActivity } from "@/hooks/useWeeklyActivity";
import { isCalendarDayComplete, readCompletedDayDates } from "@/lib/workoutCompletion";

// Lazy load view components for code splitting
const HomeView = React.lazy(() => import('@/views/HomeView'));
const WorkoutView = React.lazy(() => import('@/views/WorkoutView'));
const NutritionView = React.lazy(() => import('@/views/NutritionView'));
const ProfileView = React.lazy(() => import('@/views/ProfileView'));

/**
 * Hook for intersection-based prefetching of view components when BottomNav enters viewport
 */
const useIntersectionPrefetch = () => {
  const [hasIntersected, setHasIntersected] = useState(false);

  const prefetchOnIntersection = useCallback(async () => {
    if (hasIntersected) return;
    setHasIntersected(true);

    // Prefetch most likely next tabs when BottomNav is visible
    try {
      await Promise.all([
        import('@/views/WorkoutView'),
        import('@/views/NutritionView')
      ]);
    } catch (error) {
      console.warn('Failed to prefetch views on intersection:', error);
    }
  }, [hasIntersected]);

  return { prefetchOnIntersection, hasIntersected };
};

/**
 * Hook for managing focus when tabs change for accessibility
 */
const useFocusManagement = (activeTab: string) => {
  const viewRefs = useRef<Record<string, HTMLElement | null>>({});

  const setViewRef = useCallback((tab: string, element: HTMLElement | null) => {
    viewRefs.current[tab] = element;
  }, []);

  useEffect(() => {
    // Focus the first heading of the active view for screen readers
    const activeElement = viewRefs.current[activeTab];
    if (activeElement) {
      const heading = activeElement.querySelector('h1, h2, [role="heading"]') as HTMLElement;
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true } as FocusOptions);
        // Remove tabIndex after focus to avoid affecting tab order
        setTimeout(() => { heading.tabIndex = 0; }, 100);
      }
    }
  }, [activeTab]);

  return { setViewRef };
};
import {
  getBerlinNow,
  getBerlinCurrentWeek,
  isBerlinFuture,
  isBerlinPast,
  formatDateForDisplay,
  getWeekDays,
  TARGET_TIMEZONE,
  WEEK_OPTIONS
} from "@/lib/dateUtils";
import {
  getPlanStartMonday,
  getWorkoutDate,
  getWorkoutWeekDay,
  getWorkoutDateString,
  isBerlinTodayForWeekDay
} from "@/lib/workoutDateUtils";
import { useBerlinToday } from "@/hooks/useBerlinToday";
import { resolvePlanDay, isPlanFinished, getWeekDayProgress } from "@/lib/planLifecycle";
import { useTrainingSession } from "@/contexts/TrainingSessionContext";
import { useWorkoutHelpers } from "@/hooks/useWorkoutHelpers";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useFocusMode } from "@/contexts/FocusModeContext";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { NAVIGATION_CONFIG } from "@/lib/navigation";

const Dashboard = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { enableAdvancedGlass } = usePreferences();
  const { isFocusMode } = useFocusMode();

  // Reactive Berlin "today" - updates automatically at midnight
  const berlinToday = useBerlinToday();

  // Navigation State
  const { activeView, navigateTo, direction, routeParams } = useAppNavigation();

  // Custom Hooks Data Access
  const { data: profile, isLoading: isLoadingProfile, refetch: refetchProfile } = useProfile();
  const {
    data: liveWorkoutPlan,
    isLoading: isLoadingPlans,
    generatePlan,
    isGenerating: generatingPlans
  } = useWorkoutPlan();
  const {
    data: workoutLogs,
    toggleDay,
    isToggling: completingWorkout
  } = useWorkoutLogs(liveWorkoutPlan?.id);
  const { data: nutritionPlan } = useNutritionPlan();

  // Prefetch weekly activity data immediately so it's ready when HomeView mounts
  useWeeklyActivity('weekly');

  // Derived state or local UI state
  const [activeWeek, setActiveWeek] = useState<string | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState<number>(0);
  const [selectedDate, setSelectedDate] = useState<Date>(getBerlinNow()); // Initialize with Berlin timezone

  // Performance optimization hooks
  const { prefetchOnIntersection } = useIntersectionPrefetch();
  const { setViewRef } = useFocusManagement(activeView);
  const bottomNavRef = useRef<HTMLElement>(null);

  // Focus management and intersectionObserver for prefetching
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          prefetchOnIntersection();
        }
      },
      { threshold: 0.1 }
    );

    if (bottomNavRef.current) {
      observer.observe(bottomNavRef.current);
    }

    return () => observer.disconnect();
  }, [prefetchOnIntersection]);

  const prefersReducedMotion = useReducedMotion();

  // Mobile detection for constraining animations to mobile only
  const isMobile = (() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(max-width: 767px)').matches;
  })();

  // Robust workout logging with timezone handling and toggle functionality
  const toggleDayComplete = useCallback(async (weekKey: string, dayIndex: number) => {
    if (!user || !liveWorkoutPlan || completingWorkout) return;

    /*
      One date, from the one authority. This used to derive the date it *wrote*
      with addDays(created_at) while checking completion against
      getWorkoutDateString, which anchors to the plan's start Monday. For any
      plan not created on a Monday the two disagreed, so the write landed on a
      different day than the read-back looked at: the day never registered as
      complete, and weekly activity attributed it to the wrong calendar day.
    */
    const workoutDateStr = getWorkoutDateString(liveWorkoutPlan.created_at, weekKey, dayIndex);

    // Prevent future day completion
    if (isBerlinFuture(workoutDateStr)) {
      toast.error(t('dashboard.futureDay.locked'));
      return;
    }

    /*
      Completion status, through the one shared rule: only the day session
      record speaks for a day. Read inline rather than through isDayCompleted
      to keep this callback's dependencies stable.
    */
    const isCompleted = isCalendarDayComplete(workoutLogs, workoutDateStr);

    toggleDay({ workoutDateStr, completed: !isCompleted, weekKey, dayIndex });
  }, [user, liveWorkoutPlan, completingWorkout, workoutLogs, toggleDay, t]);

  /*
    Whether a plan day is completed (timezone-aware).

    The single authority is `shared/workoutCompletion.ts`: only the day session
    record counts, never an exercise or a set. Set tracking can leave an
    exercise row carrying this day's `workoutDay`, so matching on the date and
    a completion flag alone would let one ticked exercise complete the day.
  */
  const isDayCompleted = useCallback((weekKey: string, dayIndex: number): boolean => {
    if (!liveWorkoutPlan?.created_at) return false;

    const dateString = getWorkoutDateString(liveWorkoutPlan.created_at, weekKey, dayIndex);
    return isCalendarDayComplete(workoutLogs, dateString);
  }, [liveWorkoutPlan, workoutLogs]);

  // Check if today matches a specific week and day (Berlin timezone)
  // Centralized function from workoutDateUtils
  const isTodayInWeekDay = useCallback((weekKey: string, dayIndex: number): boolean => {
    if (!liveWorkoutPlan?.created_at) return false;
    return isBerlinTodayForWeekDay(liveWorkoutPlan.created_at, weekKey, dayIndex);
  }, [liveWorkoutPlan]);

  // Check if a day is in the future (Berlin timezone)
  const isDayInFuture = useCallback((weekKey: string, dayIndex: number): boolean => {
    if (!liveWorkoutPlan?.created_at) return false;

    const targetDateStr = getWorkoutDateString(liveWorkoutPlan.created_at, weekKey, dayIndex);
    return isBerlinFuture(targetDateStr);
  }, [liveWorkoutPlan]);

  // Get week key for a specific date using plan-based mapping
  const getWeekKeyForDate = useCallback((date: Date): string => {
    if (!liveWorkoutPlan?.created_at) return 'Week 1';
    const { weekKey } = getWorkoutWeekDay(liveWorkoutPlan.created_at, date);
    return weekKey;
  }, [liveWorkoutPlan]);

  // Get current week based on selected date
  const getCurrentWeek = useCallback(() => {
    if (!liveWorkoutPlan?.created_at) return null;
    return getWeekKeyForDate(selectedDate);
  }, [liveWorkoutPlan, selectedDate, getWeekKeyForDate]);

  // Use consolidated workout helpers hook (not currently used in Dashboard but available)
  const { getWeekContentWithFallback } = useWorkoutHelpers(liveWorkoutPlan);

  // Get today's day index for a specific week
  const getTodayDayIndex = (weekKey: string) => {
    if (!liveWorkoutPlan || !liveWorkoutPlan.content) return -1;
    const weekData = liveWorkoutPlan.content[weekKey];
    if (!Array.isArray(weekData)) return -1;

    for (let dayIndex = 0; dayIndex < weekData.length; dayIndex++) {
      if (isTodayInWeekDay(weekKey, dayIndex)) {
        return dayIndex;
      }
    }
    return -1;
  };

  // Format week title for display
  const getWeekTitle = useCallback((weekKey: string) => {
    const weekNumber = weekKey.replace(/([A-Z])/g, ' $1').trim();
    return weekNumber.charAt(0).toUpperCase() + weekNumber.slice(1);
  }, []);

  // Returns the workout object for a given (weekKey, dayIndex) or null
  const getWorkoutAt = (weekKey: string, dayIndex: number) => {
    const days = liveWorkoutPlan?.content?.[weekKey];
    if (!days) return null;
    const day = days[dayIndex];
    if (!day || !Array.isArray(day.exercises) || day.exercises.length === 0) return null;
    return day;
  };

  // Get calendar date for a given weekKey and dayIndex using plan-based mapping
  const getDateFor = useCallback((weekKey: string, dayIndex: number): Date | null => {
    if (!liveWorkoutPlan?.created_at) return null;
    return getWorkoutDate(liveWorkoutPlan.created_at, weekKey, dayIndex);
  }, [liveWorkoutPlan]);

  // Get ordered week keys (week1..week4)
  const getOrderedWeekKeys = () => {
    if (!liveWorkoutPlan?.content) return [];
    // Sort keys by their numeric index: "week1","week2",...
    return Object.keys(liveWorkoutPlan.content)
      .sort((a, b) => (parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, ''))));
  };

  // Get current week key based on days since plan start
  const getCurrentWeekKey = useCallback(() => {
    if (!liveWorkoutPlan?.created_at) return null;
    const today = getBerlinNow();
    const { weekKey } = getWorkoutWeekDay(liveWorkoutPlan.created_at, today);
    return weekKey;
  }, [liveWorkoutPlan]);


  // Get today's workout data
  /**
   * Today's plan day, resolved through the shared four-week lifecycle so the
   * Dashboard and the Workout view can never disagree. Returns null once the
   * programme is finished — no Week 1 content is served after Week 4.
   */
  const getTodayWorkout = useCallback(() => {
    if (!liveWorkoutPlan?.created_at) return null;

    const resolved = resolvePlanDay(liveWorkoutPlan, getBerlinNow(), {
      isDayCompleted: (weekKey, dayIndex) => {
        const dateString = getWorkoutDateString(liveWorkoutPlan.created_at, weekKey, dayIndex);
        return isCalendarDayComplete(workoutLogs, dateString);
      },
    });

    if (resolved.status !== 'active') return null;

    if (resolved.isRestDay) {
      return {
        __restDay: true,
        weekKey: resolved.weekKey,
        dayIndex: resolved.dayIndex,
        isCompleted: false,
      };
    }

    return {
      weekKey: resolved.weekKey,
      dayIndex: resolved.dayIndex,
      dayData: resolved.dayData,
      isCompleted: resolved.isCompleted,
    };
  }, [liveWorkoutPlan, workoutLogs]);

  /**
   * Validate any stored session against the loaded plan. A session bound to a
   * different plan, or to a day the plan no longer has, is ended here rather
   * than silently re-attached to today's workout.
   */
  const { validateSessionAgainstPlan, rejectionNotice, clearRejectionNotice } = useTrainingSession();

  useEffect(() => {
    if (!liveWorkoutPlan?.id) return;
    validateSessionAgainstPlan({
      planId: liveWorkoutPlan.id,
      hasDay: (weekKey, dayIndex) => {
        const days = liveWorkoutPlan.content?.[weekKey];
        return Array.isArray(days) && !!days[dayIndex];
      },
    });
  }, [liveWorkoutPlan, validateSessionAgainstPlan]);

  useEffect(() => {
    if (!rejectionNotice) return;
    toast.info(rejectionNotice);
    clearRejectionNotice();
  }, [rejectionNotice, clearRejectionNotice]);

  /** True once the four-week programme is over. */
  const planFinished = useMemo(
    () => isPlanFinished(liveWorkoutPlan, getBerlinNow()),
    [liveWorkoutPlan]
  );

  // Set initial active week and today's day on load, sync with date changes
  useEffect(() => {
    if (liveWorkoutPlan) {
      const currentWeek = getCurrentWeek();
      setActiveWeek(currentWeek);
      // Removed auto-expand activeDays logic relying on dead state
    }
  }, [liveWorkoutPlan, selectedDate, getCurrentWeek]); // Depend on selectedDate changes

  // Handle date changes from calendar - update selected date and active week
  const handleDateChange = useCallback((date: Date) => {
    setSelectedDate(date);

    if (!liveWorkoutPlan?.created_at) return;

    // Calculate day index and week key using plan-based mapping
    const { weekKey, dayIndex } = getWorkoutWeekDay(liveWorkoutPlan.created_at, date);

    if (dayIndex >= 0 && dayIndex <= 6) {
      setActiveDayIndex(dayIndex);
    }

    // Update active week based on the new date
    // We need to use valid dependency for activeWeek
    // But since we are inside a callback, and we can't easily access previous state if it's not in deps
    // We will just set it. The check `if (weekKey !== activeWeek)` is an optimization that requires activeWeek in deps.
    // To keep it stable, we can use the functional update or just always set it, React bails out if value is same.
    setActiveWeek(weekKey);
  }, [liveWorkoutPlan]);

  /**
   * Restore a workout deep link (`#/workout?w=<week>&d=<day>`) once the plan
   * is loaded. Week and day are derived from the plan's start date, so this
   * has to wait for `liveWorkoutPlan`; the ref makes it fire exactly once so
   * it never fights the hash WorkoutView rewrites as the user browses.
   */
  const deepLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    if (activeView !== 'workout') return;
    if (!liveWorkoutPlan?.created_at) return;

    const weekParam = Number(routeParams.get('w'));
    const dayParam = Number(routeParams.get('d'));
    if (!Number.isInteger(weekParam) || weekParam < 1 || weekParam > 4) return;
    if (!Number.isInteger(dayParam) || dayParam < 0 || dayParam > 6) return;

    const target = getWorkoutDate(liveWorkoutPlan.created_at, `Week ${weekParam}`, dayParam);
    if (!target) return;

    deepLinkAppliedRef.current = true;
    handleDateChange(target);
  }, [activeView, liveWorkoutPlan?.created_at, routeParams, handleDateChange]);



  // Accurate weekly progress calculation using Berlin timezone
  const getWeeklyProgress = useCallback(() => {
    if (!liveWorkoutPlan || !workoutLogs) return { completed: 0, total: 0 };

    const { startStr, endStr } = getBerlinCurrentWeek();

    /*
      Completed days of the current Berlin week. Day sessions only, and one
      entry per date: an exercise row carries a completion flag too, and a
      count of ticked exercises is not a count of training days.
    */
    const completedThisWeek = readCompletedDayDates(workoutLogs).filter(
      (day) => day >= startStr && day <= endStr && !isBerlinFuture(day)
    ).length;

    // Planned training days for the week the user is actually in. This used to
    // read Object.values(content)[0] — the plan's *first* week — so every week
    // was measured against Week 1's shape, and a finished plan still reported a
    // target.
    const today = resolvePlanDay(liveWorkoutPlan, getBerlinNow());
    if (today.status !== 'active' || !today.weekKey) {
      return { completed: 0, total: 0 };
    }

    const totalPlannedDays = getWeekDayProgress(
      liveWorkoutPlan,
      today.weekKey,
      () => false
    ).total;

    return {
      completed: Math.min(completedThisWeek, totalPlannedDays), // Cap at total planned
      total: totalPlannedDays
    };
  }, [liveWorkoutPlan, workoutLogs]);


  const formatWorkoutDate = (startDate: Date, dayIndex: number) => {
    const date = addDays(startDate, dayIndex);
    return formatDateForDisplay(date, 'EEEE, d. MMMM');
  };

  // Loading state handled by Suspense

  return (
    <div className={`relative overflow-x-clip ${isFocusMode ? '' : 'z-20'}`}>
      {!isFocusMode && <VideoBackground />}
      <motion.div
        id="main-content"
        tabIndex={-1}
        className={`relative max-w-7xl mx-auto ${isFocusMode ? 'px-0 pt-0 pb-0' : 'z-10 px-4 md:px-6 pt-6'}`}
        initial={isFocusMode ? false : { opacity: 0, y: 20 }}
        animate={isFocusMode ? false : { opacity: 1, y: 0 }}
      >
        <OfflineBanner className="mb-6" />

        {/* Main Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >


          <div className="space-y-6">
            {/*
              Exactly one view is mounted at a time. There is deliberately no
              exit animation: an outgoing view kept alive for a transition
              stays focusable and clickable, so tab order and hit-testing
              briefly span two screens. The enter animation is keyed on the
              active view, which gives the same perceived motion.
            */}
            <div className="relative">
                <motion.div
                  key={activeView}
                  custom={direction}
                  initial="enter"
                  animate="center"
                  className="w-full"
                  variants={{
                    enter: (dir: 1 | -1) => ({
                      x: prefersReducedMotion || !isMobile ? 0 : dir * 40,
                      opacity: prefersReducedMotion || !isMobile ? 1 : 0
                    }),
                    center: { x: 0, opacity: 1 }
                  }}
                  transition={{
                    type: 'tween',
                    duration: prefersReducedMotion || !isMobile ? 0 : 0.18,
                    ease: 'easeOut'
                  }}
                >
                  {activeView === 'dashboard' && (
                    <div className="space-y-6">
                      <Suspense fallback={<HomeSkeleton />}>
                        <div ref={(el) => setViewRef('dashboard', el)}>
                          {(isLoadingProfile || isLoadingPlans) && (!profile || !liveWorkoutPlan) ? (
                            <HomeSkeleton />
                          ) : (
                            <HomeView
                              generatingPlans={generatingPlans}
                              workoutPlan={liveWorkoutPlan}
                              nutritionPlan={nutritionPlan}
                              onGeneratePlans={generatePlan}
                              profile={profile}
                              workoutProgress={getWeeklyProgress()}
                              planFinished={planFinished}
                              getTodayWorkout={getTodayWorkout}
                              isDayCompleted={isDayCompleted}
                              getWeeklyProgress={getWeeklyProgress}
                              selectedDate={selectedDate}
                              isLoadingPlans={isLoadingPlans}
                              workoutLogs={workoutLogs || []} // Pass available logs or empty array
                              onProgressUpdate={() => {
                                // No-op: logs update automatically via hooks query invalidation
                              }}
                              onNavigate={(target) => {
                                // Map view switching
                                if (target === 'dashboard' || target === 'workout' || target === 'nutrition' || target === 'profile') {
                                  navigateTo(target);
                                }
                              }}
                            />
                          )}
                        </div>
                      </Suspense>
                    </div>
                  )}

                  {activeView === 'workout' && (
                    <div className="space-y-6">
                      <Suspense fallback={<WorkoutSkeleton />}>
                        <div ref={(el) => setViewRef('workout', el)}>
                          {isLoadingPlans && !liveWorkoutPlan ? (
                            <WorkoutSkeleton />
                          ) : (
                            <WorkoutView
                              workoutPlan={liveWorkoutPlan}
                              workoutLogs={workoutLogs}
                              completingWorkout={completingWorkout}
                              selectedDate={selectedDate}
                              isDayCompleted={isDayCompleted}
                              isDayInFuture={isDayInFuture}
                              isTodayInWeekDay={isTodayInWeekDay}
                              getDateFor={getDateFor}
                              getWeekTitle={getWeekTitle}
                              getWeeklyProgress={getWeeklyProgress}
                              getWeekKeyForDate={getWeekKeyForDate}
                              toggleDayComplete={toggleDayComplete}
                              handleDateChange={handleDateChange}
                            />
                          )}
                        </div>
                      </Suspense>
                    </div>
                  )}

                  {activeView === 'nutrition' && (
                    <div className="space-y-6">
                      <Suspense fallback={<NutritionSkeleton />}>
                        <div ref={(el) => setViewRef('nutrition', el)}>
                          {isLoadingPlans && !nutritionPlan ? (
                            <NutritionSkeleton />
                          ) : (
                            <NutritionView nutritionPlan={nutritionPlan} />
                          )}
                        </div>
                      </Suspense>
                    </div>
                  )}

                  {activeView === 'profile' && (
                    <div className="space-y-6">
                      <Suspense fallback={<ProfileSkeleton />}>
                        <div ref={(el) => setViewRef('profile', el)}>
                          {isLoadingProfile && !profile ? (
                            <ProfileSkeleton />
                          ) : (
                            <ProfileView
                              profile={profile}
                              onProfileUpdate={refetchProfile}
                              workoutProgress={getWeeklyProgress()}
                              generatingPlans={generatingPlans}
                              workoutPlan={liveWorkoutPlan}
                              nutritionPlan={nutritionPlan}
                              onGeneratePlans={generatePlan}
                            />
                          )}
                        </div>
                      </Suspense>
                    </div>
                  )}

                </motion.div>
            </div>
          </div>
        </motion.div>
      </motion.div>

      <BottomNavPortal>
        <FitssNavBar
          ref={bottomNavRef}
          activeView={activeView}
          enableAdvancedGlass={enableAdvancedGlass}
          onChange={(view) => {
            navigateTo(view);

            // Optional haptic feedback for supported devices
            try {
              if (navigator.vibrate) navigator.vibrate(8); // very subtle
            } catch (e) {
              // no-op
            }
          }}
        />
      </BottomNavPortal>
    </div>
  );
};

export default Dashboard;