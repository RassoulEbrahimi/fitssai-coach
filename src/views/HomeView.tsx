import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Bell, Dumbbell, Utensils, Sparkles, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { getAvatarUrl } from "@/lib/avatarUtils";
import { GradientCard } from "@/components/micro/GradientCard";
import { ProgressPill } from "@/components/micro/ProgressPill";
import { WeeklyActivity } from "@/components/charts/WeeklyActivity";
import { MotivationSkeleton } from "@/components/skeletons/MotivationSkeleton";
import HomeSkeleton from "@/components/skeletons/HomeSkeleton";
import WorkoutErrorBoundary from "@/components/WorkoutErrorBoundary";

interface HomeViewProps {
  generatingPlans: boolean;
  workoutPlan: any;
  nutritionPlan: any;
  onGeneratePlans: () => void;
  profile?: any;
  workoutProgress?: { completed: number; total: number };
  getTodayWorkout?: () => any;
  isDayCompleted?: (weekKey: string, dayIndex: number) => boolean;
  getWeeklyProgress?: () => { completed: number; total: number };
  selectedDate: Date;
  onProgressUpdate?: (weeklyProgress: { completed: number; total: number }) => void;
  isLoadingPlans?: boolean;
}

const HomeView: React.FC<HomeViewProps> = ({
  generatingPlans,
  workoutPlan,
  nutritionPlan,
  onGeneratePlans,
  profile,
  workoutProgress = { completed: 0, total: 0 },
  getTodayWorkout,
  isDayCompleted,
  getWeeklyProgress,
  selectedDate,
  onProgressUpdate,
  isLoadingPlans = false
}) => {
  const { t } = useTranslation();
  const [quote, setQuote] = useState<string>("");
  const [quoteAuthor, setQuoteAuthor] = useState<string>("");
  const [isLoadingQuote, setIsLoadingQuote] = useState(true);

  // German fallback quotes
  const fallbackQuotes = [
    { text: "Der Körper erreicht, was der Geist glaubt.", author: "Napoleon Hill" },
    { text: "Stärke wächst nicht aus körperlicher Kraft - sondern aus unbeugsamen Willen.", author: "Mahatma Gandhi" },
    { text: "Erfolg ist die Summe kleiner Anstrengungen, die täglich wiederholt werden.", author: "Robert Collier" },
    { text: "Du bist stärker als du denkst und mutiger als du fühlst.", author: "Unbekannt" },
    { text: "Jeder Tag ist eine neue Chance, besser zu werden.", author: "Unbekannt" }
  ];

  // Calculate today's training progress
  const todayWorkout = getTodayWorkout ? getTodayWorkout() : null;
  const todayTrainingProgress = (() => {
    if (!todayWorkout) return { value: 0, label: "Kein Training geplant" };
    if (todayWorkout.__restDay) return { value: 0, label: "Ruhetag" };
    if (todayWorkout.isCompleted) return { value: 100, label: "Training abgeschlossen" };
    return { value: 0, label: "Training ausstehend" };
  })();

  // Calculate nutrition progress (100% if plan exists, 0% otherwise)
  const nutritionProgress = nutritionPlan ? 100 : 0;

  // Calculate weekly activity data using actual workout completion
  const weeklyActivityData = (() => {
    const weeklyProg = getWeeklyProgress ? getWeeklyProgress() : { completed: 0, total: 0 };
    // Generate 7 values for Mon-Sun based on completion pattern
    // For now, use simplified logic - in production, track daily completion
    return [
      weeklyProg.completed > 0 ? 100 : 30, // Mo
      weeklyProg.completed > 1 ? 100 : 30, // Di  
      weeklyProg.completed > 2 ? 100 : 30, // Mi
      weeklyProg.completed > 3 ? 100 : 30, // Do
      weeklyProg.completed > 4 ? 100 : 30, // Fr
      0, // Sa (rest day)
      weeklyProg.completed > 5 ? 100 : 30  // So
    ];
  })();

  // Load motivation quote from fallback (DB table will be created later)
  useEffect(() => {
    const loadQuote = () => {
      // Use fallback quotes for now (motivationszitate table will be created later)
      const randomQuote = fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)];
      setQuote(randomQuote.text);
      setQuoteAuthor(randomQuote.author);
      setIsLoadingQuote(false);
    };

    // Small delay for skeleton
    const timer = setTimeout(loadQuote, 500);
    return () => clearTimeout(timer);
  }, []);

  // Show skeleton when initially loading or generating plans
  if (isLoadingPlans || (generatingPlans && !workoutPlan && !nutritionPlan)) {
    return <HomeSkeleton />;
  }

  // Show empty state when no plans exist and not generating
  if (!generatingPlans && !workoutPlan && !nutritionPlan) {
    return (
      <WorkoutErrorBoundary>
        <div className="px-4 md:px-6 space-y-6">
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

  // Get user's first name from full_name or email
  const firstName = (() => {
    if (profile?.full_name) {
      return profile.full_name.split(' ')[0];
    }
    if (profile?.email) {
      return profile.email.split('@')[0];
    }
    return "Nutzer";
  })();
  
  const avatarUrl = getAvatarUrl(profile?.avatar_path);
  const progressPercentage = workoutProgress.total > 0 
    ? (workoutProgress.completed / workoutProgress.total) * 100 
    : 0;

  return (
    <WorkoutErrorBoundary>
      <div id="main-content" className="px-4 md:px-6 space-y-6">
      {/* Welcome Header */}
      <motion.div 
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">
            Hallo, {firstName}!
          </h1>
          <Button variant="ghost" size="sm" className="p-2">
            <Bell className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Benachrichtigungen</span>
          </Button>
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
            <Avatar className="absolute inset-1 w-10 h-10">
              <AvatarImage src={avatarUrl || undefined} alt="Profilbild" />
              <AvatarFallback className="bg-primary/20 text-primary text-sm font-medium">
                {firstName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </motion.div>

      {/* Motivation Quote Card */}
      {isLoadingQuote ? (
        <MotivationSkeleton />
      ) : (
        <GradientCard>
          <blockquote className="text-lg font-medium text-foreground leading-relaxed mb-3">
            "{quote}"
          </blockquote>
          {quoteAuthor && (
            <cite className="text-sm text-muted-foreground not-italic">
              — {quoteAuthor}
            </cite>
          )}
        </GradientCard>
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
        <li className="flex items-center justify-between p-4 bg-card/70 backdrop-blur rounded-2xl ring-1 ring-border/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/20">
              <Dumbbell className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-medium text-foreground text-base">Heutiges Training</h2>
              <p className="text-xs text-muted-foreground">
                {todayTrainingProgress.label}
              </p>
            </div>
          </div>
          <ProgressPill 
            value={todayTrainingProgress.value} 
            aria-label={`Training Fortschritt: ${todayTrainingProgress.value} Prozent`}
          />
        </li>

        {/* Nutrition Progress */}
        <li className="flex items-center justify-between p-4 bg-card/70 backdrop-blur rounded-2xl ring-1 ring-border/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/20">
              <Utensils className="h-4 w-4 text-success" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-medium text-foreground text-base">Ernährung</h2>
              <p className="text-xs text-muted-foreground">
                {nutritionProgress > 0 ? "Plan verfügbar" : "Kein Plan"}
              </p>
            </div>
          </div>
          <ProgressPill 
            value={nutritionProgress} 
            aria-label={`Ernährungs-Fortschritt: ${nutritionProgress} Prozent`}
          />
        </li>
      </motion.ul>

      {/* Weekly Activity Chart */}
      <div role="region" aria-label="Wöchentliche Aktivitätsübersicht">
        <WeeklyActivity data={weeklyActivityData} />
      </div>
      </div>
    </WorkoutErrorBoundary>
  );
};

export default HomeView;