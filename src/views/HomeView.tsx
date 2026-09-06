import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { AnimatedAvatar } from "@/components/ui/animated-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Bell, Dumbbell, Utensils, Sparkles, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getAvatarUrl } from "@/lib/avatarUtils";
import { GradientCard } from "@/components/micro/GradientCard";
import { ProgressPill } from "@/components/micro/ProgressPill";
import { WeeklyActivity } from "@/components/charts/WeeklyActivity";
import { MotivationSkeleton } from "@/components/skeletons/MotivationSkeleton";
import HomeSkeleton from "@/components/skeletons/HomeSkeleton";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";
import { NotificationPopover } from "@/components/NotificationPopover";

import { Profile } from "@/hooks/queries/useProfile";
import { WorkoutPlan, NutritionPlan, TodayWorkout, WorkoutLog } from "@/lib/types";
import { useWeeklyActivity } from "@/hooks/useWeeklyActivity";
import { generateInsights } from "@/lib/insights/engine";
import { InsightHero } from "@/components/dashboard/InsightHero";
import { WeeklyReview } from "@/components/dashboard/WeeklyReview";
import {
  buildWeeklyFacts,
  buildWeeklyReviewMetrics,
  normaliseFitnessGoal,
  readPlanWeekDays,
} from "@/lib/coaching";
import { resolvePlanDay } from "@/lib/planLifecycle";
import {
  filterDaySessionLogs,
  readCompletedDayDates,
  readCompletedDays,
} from "@/lib/workoutCompletion";

interface HomeViewProps {
  generatingPlans: boolean;
  workoutPlan?: WorkoutPlan;
  nutritionPlan?: NutritionPlan;
  onGeneratePlans: () => void;
  profile?: Profile | null;
  workoutProgress?: { completed: number; total: number };
  getTodayWorkout?: () => TodayWorkout | null; // Returns TodayWorkout object
  isDayCompleted?: (weekKey: string, dayIndex: number) => boolean;
  getWeeklyProgress?: () => { completed: number; total: number };
  selectedDate: Date;
  onProgressUpdate?: (weeklyProgress: { completed: number; total: number }) => void;
  isLoadingPlans?: boolean;
  onNavigate?: (tab: 'dashboard' | 'workout' | 'nutrition' | 'profile') => void;
  /** True once the fixed four-week programme is over. */
  planFinished?: boolean;
  workoutLogs?: WorkoutLog[];
}

// David Goggins quotes moved outside to be stable
const gogginsQuotes = [
  "Stay hard!",
  "Nobody cares, work harder.",
  "You are in danger of living a life so comfortable and soft, that you will die without ever realizing your true potential.",
  "Don't stop when you're tired. Stop when you're done.",
  "Suffering is the true test of life.",
  "You are in charge of your mind. Stop being a victim.",
  "It's so easy to be great nowadays, because everyone else is weak.",
  "The most important conversations you'll ever have are the ones you'll have with yourself.",
  "We live in an external world. Everything, you have to see it, touch it. If you can for the rest of your life live inside of yourself — to find greatness — you have to go inside.",
  "You have to build calluses on your brain just like how you build calluses on your hands. Callus your mind through pain and suffering.",
  "The only person who was going to turn my life around was me.",
  "You are stopping you. You are giving up instead of getting hard.",
  "Life is one big tug-of-war between mediocrity and trying to find your best self.",
  "Don't count on motivation. Count on discipline.",
  "Pain unlocks a secret doorway in the mind, one that leads to both peak performance and beautiful silence.",
  "Be uncommon amongst uncommon people.",
  "You are in control. You decide what you want your life to be.",
  "Greatness pulls mediocrity into the mud. Get out there and get after it.",
  "The most important thing is to stay in the fight.",
  "There is no shortcut. There is no hack. There's only one way: So, get after it.",
  "Don't stop when you feel pain. Stop when you're finished.",
  "Every day is an opportunity to learn, adapt, and grow.",
  "Most of us live in our own little cocoons. Break free.",
  "You may lose the battle of the morning, but don't lose the war of the day.",
  "When you think you're done, you're only at 40% of your potential.",
  "The most powerful weapon is your mind.",
  "You can't hurt me.",
  "Be the hardest worker in the room.",
  "Don't stop when you fail. Stop when you succeed.",
  "It's not about winning. It's about not quitting."
];

const getRandomQuote = () => {
  return gogginsQuotes[Math.floor(Math.random() * gogginsQuotes.length)];
};

const HomeView: React.FC<HomeViewProps> = ({
  generatingPlans,
  workoutPlan,
  nutritionPlan,
  planFinished = false,
  onGeneratePlans,
  profile,
  workoutProgress = { completed: 0, total: 0 },
  getTodayWorkout,
  isDayCompleted,
  getWeeklyProgress,
  selectedDate,
  onProgressUpdate,
  isLoadingPlans = false,
  onNavigate,
  workoutLogs = []
}) => {
  const { t } = useTranslation();
  const [quote, setQuote] = useState<string>("");
  const [isLoadingQuote, setIsLoadingQuote] = useState(true);
  const [quoteKey, setQuoteKey] = useState(0);

  // Fetch weekly activity data (shared with Chart)
  const weeklyActivity = useWeeklyActivity('weekly');

  // Compute Smart Insight
  const activeInsight = useMemo(() => {
    /*
      Completed training days, from the day session records only — the same
      rule the dashboard and the weekly review apply. This used to be
      `workoutLogs.length`, which counted every exercise row and every
      unfinished day, so the milestone card congratulated people on trainings
      they had not done.
    */
    const completedDays = readCompletedDayDates(workoutLogs).sort();
    const totalPlanWorkouts = completedDays.length;
    const lastWorkoutDateStr = completedDays.length > 0 ? completedDays[completedDays.length - 1] : null;

    return generateInsights(weeklyActivity, profile, totalPlanWorkouts, lastWorkoutDateStr);
  }, [weeklyActivity, workoutLogs, profile]);


  /*
    The deterministic week, assembled from data this view already has: the
    plan, the plan's own logs and the profile. No extra query, and no new
    collection — the engine is pure and takes the resolved week explicitly
    rather than reading a clock.
  */
  const weeklyFacts = useMemo(() => {
    const resolved = resolvePlanDay(workoutPlan, selectedDate);
    const weekKey = resolved.weekKey;
    if (!workoutPlan || !weekKey) return null;

    const planDays = readPlanWeekDays(workoutPlan, weekKey);

    /*
      Completion comes from the day session record and from weekKey + dayIndex
      only — the shared rule in `shared/workoutCompletion.ts`, so this card,
      the dashboard and the backend agree. An exercise row carries the same
      three fields, so reading them alone counted one ticked exercise as a
      finished training day. A day log written before PR47 can carry a date
      derived from the plan's creation date rather than its start Monday, so
      that date is not a fallback either.
    */
    const weekLogs = filterDaySessionLogs(workoutLogs).filter((log) => log.week_key === weekKey);
    const completions = readCompletedDays(workoutLogs)
      .filter((day) => day.weekKey === weekKey)
      .map((day) => ({ ...day, completed: true }));

    return buildWeeklyFacts({
      weekKey,
      planDays,
      completions,
      weekLogs: weekLogs.map((log) => ({
        weekKey: log.week_key as string | null,
        dayIndex: log.day_index as number | null,
        workoutDay: log.workout_day,
        completed: log.completed === true,
        durationSec: (log as { duration_sec?: number | null }).duration_sec ?? null,
      })),
      preferences: {
        daysPerWeek: profile?.daysPerWeek,
        sessionMinutes: profile?.sessionMinutes,
      },
      goal: normaliseFitnessGoal(profile?.fitness_goal),
      planFinished,
    });
  }, [workoutPlan, workoutLogs, profile, selectedDate, planFinished]);

  /*
    The same week, in the shape the coaching recommendation needs — and in the
    shape the backend computes for itself. The arithmetic is shared code, so
    the number on screen and the number the backend reasons about cannot drift
    apart; this only supplies the inputs.
  */
  const weeklyReviewMetrics = useMemo(
    () => {
      const resolved = resolvePlanDay(workoutPlan, selectedDate);
      return buildWeeklyReviewMetrics({
        plan: workoutPlan,
        weekKey: resolved.weekKey,
        weekNumber: resolved.weekNumber,
        logs: workoutLogs,
      });
    },
    [workoutPlan, selectedDate, workoutLogs]
  );

  const refreshQuote = () => {
    setQuoteKey(prev => prev + 1);
    setQuote(getRandomQuote());
  };

  // Calculate today's training progress
  const todayWorkout = getTodayWorkout ? getTodayWorkout() : null;
  const todayTrainingProgress = useMemo(() => {
    // Once the programme is finished there is no "today" in the plan; say so
    // explicitly rather than implying a plan is merely missing.
    if (planFinished) return { value: 100, label: "4-Wochen-Plan abgeschlossen" };
    if (!todayWorkout) return { value: 0, label: t('dashboard.progress.noPlan', "Kein Training geplant") };
    if (todayWorkout.__restDay) return { value: 0, label: t('dashboard.progress.restDay', "Ruhetag genießen") };
    if (todayWorkout.isCompleted) return { value: 100, label: "Training abgeschlossen" };
    return { value: 0, label: "Training ausstehend" };
  }, [todayWorkout, planFinished, t]);

  /**
   * Nutrition is read-only in Phase 1: nothing is logged, so there is no real
   * completion to report. A 0/100 bar derived purely from "does a plan exist"
   * reads as progress the user never made, so this shows plan status instead.
   */
  const nutritionStatus = nutritionPlan ? "Plan aktiv" : "Kein Plan";
  const nutritionMealCount = useMemo(() => {
    if (!nutritionPlan?.content) return 0;
    return Object.values(nutritionPlan.content).reduce(
      (sum, meals) => sum + (Array.isArray(meals) ? meals.length : 0),
      0
    );
  }, [nutritionPlan]);


  // Load random Goggins quote on mount
  useEffect(() => {
    const loadQuote = () => {
      setQuote(getRandomQuote());
      setIsLoadingQuote(false);
    };

    // Small delay for skeleton
    const timer = setTimeout(loadQuote, 500);
    return () => clearTimeout(timer);
  }, []);

  /*
    These two must stay above the early returns below. They used to sit after
    them, so the loading and empty-state branches rendered four hooks while the
    loaded branch rendered six — React throws "Rendered more hooks than during
    the previous render" the moment the component crosses that boundary.
  */
  // Get user's first name from full_name or email
  const firstName = useMemo(() => {
    if (profile?.full_name) {
      return profile.full_name.split(' ')[0];
    }
    if (profile?.email) {
      return profile.email.split('@')[0];
    }
    return "";
  }, [profile]);

  // Dynamic time-based greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();

    if (!firstName) {
      return "Willkommen zurück! 💪";
    }

    if (hour >= 5 && hour < 12) return `Guten Morgen, ${firstName}! ☀️`;
    if (hour >= 12 && hour < 18) return `Hallo, ${firstName}! 🌤`;
    if (hour >= 18 && hour < 22) return `Guten Abend, ${firstName}! 🌙`;
    return `Gute Nacht, ${firstName}! 🌌`;
  }, [firstName]);

  // Show skeleton when initially loading or generating plans
  if (isLoadingPlans || (generatingPlans && !workoutPlan && !nutritionPlan)) {
    return <HomeSkeleton />;
  }

  // Show empty state when no plans exist and not generating
  if (!generatingPlans && !workoutPlan && !nutritionPlan) {
    return (
      <WorkoutErrorBoundary>
        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="flex items-center justify-center min-h-[60vh]"
          >
            <Card className="max-w-lg w-full" role="status">
              <CardContent className="pt-12 pb-12 text-center space-y-6">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="flex justify-center"
                >
                  <div className="relative">
                    <TrendingUp className="h-20 w-20 text-muted-foreground/40" aria-hidden="true" />
                    <div className="absolute -bottom-1 -right-1 bg-primary/20 rounded-full p-2">
                      <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
                    </div>
                  </div>
                </motion.div>

                <div className="space-y-3">
                  <h2 className="text-2xl font-bold text-foreground">
                    {t('home.emptyState.title')}
                  </h2>
                  <p className="text-muted-foreground text-lg">
                    {t('home.emptyState.description')}
                  </p>
                </div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="pt-2"
                >
                  <Button
                    onClick={onGeneratePlans}
                    size="lg"
                    className="gap-2"
                  >
                    <Sparkles className="h-5 w-5" aria-hidden="true" />
                    {t('home.emptyState.button')}
                  </Button>
                </motion.div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </WorkoutErrorBoundary>
    );
  }

  const avatarUrl = getAvatarUrl(profile?.avatar_path);
  const progressPercentage = workoutProgress.total > 0
    ? (workoutProgress.completed / workoutProgress.total) * 100
    : 0;

  return (
    <WorkoutErrorBoundary>
      <div className="space-y-6">
        {/* Welcome Header */}
        <div
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <h1
              className="text-2xl font-bold bg-gradient-to-r from-emerald-400 via-green-500 to-emerald-600 text-transparent bg-clip-text"
            >
              {greeting}
            </h1>
            <NotificationPopover />
          </div>

          {/* Profile Avatar with Progress Ring */}
          <div className="relative">
            <div className="relative w-12 h-12">
              {/* Progress Ring */}
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-muted/30"
                />
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="text-primary transition-all duration-500"
                  style={{
                    strokeDasharray: 125.6,
                    strokeDashoffset: 125.6 - (progressPercentage / 100) * 125.6,
                  }}
                />
              </svg>

              {/* Avatar */}
              <div className="absolute inset-1">
                <AnimatedAvatar
                  src={avatarUrl || undefined}
                  alt="Profilbild"
                  fallback={firstName.charAt(0).toUpperCase()}
                  className="w-10 h-10"
                  fallbackClassName="bg-primary/20 text-primary text-sm font-medium"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Insight Hero (Smart Insights) */}
        <InsightHero
          insight={activeInsight}
          onDismiss={() => {
            // Optional: Persist dismissal in local state or session storage if desired
          }}
        />

        {/* Motivation Quote Card */}
        {isLoadingQuote ? (
          <MotivationSkeleton />
        ) : (
          <div className="relative">
            <GradientCard>
              <motion.blockquote
                key={quoteKey}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="text-base font-medium text-foreground leading-relaxed"
              >
                "{quote}"
              </motion.blockquote>
              <cite className="text-xs text-muted-foreground not-italic mt-2 block">
                — David Goggins
              </cite>
            </GradientCard>

            {/* Refresh Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={refreshQuote}
              className="absolute top-3 right-3 h-8 w-8 rounded-full hover:bg-background/80 transition-colors"
              aria-label="Neues Zitat laden"
            >
              <motion.div
                whileTap={{ rotate: 180 }}
                transition={{ duration: 0.3 }}
              >
                ↻
              </motion.div>
            </Button>
          </div>
        )}

        {/* Progress Rows */}
        <motion.ul
          className="space-y-3 list-none"
          role="list"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          {/* Today's Training Progress */}
          <motion.li
            className="flex items-center justify-between p-4 bg-card/70 backdrop-blur rounded-2xl ring-1 ring-border/50 cursor-pointer hover:bg-card/90 transition-colors active:bg-primary/5 active:scale-[0.97]"
            onClick={() => onNavigate?.('workout')}
            whileTap={{ scale: 0.97 }}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/20">
                <Dumbbell className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-medium text-foreground text-base">Heutiges Training</h2>
                <p className="text-xs font-medium text-muted-foreground">
                  {todayTrainingProgress.label}
                </p>
              </div>
            </div>
            <ProgressPill
              value={todayTrainingProgress.value}
              aria-label={`Training Fortschritt: ${todayTrainingProgress.value} Prozent`}
            />
          </motion.li>

          {/* Nutrition Progress */}
          <motion.li
            className="flex items-center justify-between p-4 bg-card/70 backdrop-blur rounded-2xl ring-1 ring-border/50 cursor-pointer hover:bg-card/90 transition-colors active:bg-primary/5 active:scale-[0.97]"
            onClick={() => onNavigate?.('nutrition')}
            whileTap={{ scale: 0.97 }}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/20">
                <Utensils className="h-4 w-4 text-success" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-medium text-foreground text-base">Ernährung</h2>
                <p className="text-xs font-medium text-muted-foreground">
                  {nutritionStatus}
                  {nutritionMealCount > 0 && ` · ${nutritionMealCount} Mahlzeiten`}
                </p>
              </div>
            </div>
            {/* No percentage: nothing is logged, so there is no progress to show. */}
            <span
              className="text-xs font-medium text-muted-foreground whitespace-nowrap"
              aria-label={`Ernährungsplan-Status: ${nutritionStatus}`}
            >
              {nutritionStatus}
            </span>
          </motion.li>
        </motion.ul>

        {/* Deterministic weekly review — computed, never generated. */}
        {weeklyFacts && (
          <WeeklyReview
            facts={weeklyFacts}
            metrics={weeklyReviewMetrics}
            /* Reading the plan, never rewriting it. */
            onViewPlan={onNavigate ? () => onNavigate('workout') : undefined}
          />
        )}

        {/* Weekly Activity Chart */}
        <div role="region" aria-label="Wöchentliche Aktivitätsübersicht">
          <WeeklyActivity />
        </div>
      </div>
    </WorkoutErrorBoundary>
  );
};

export default HomeView;