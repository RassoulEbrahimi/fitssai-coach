import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { RefreshCw, Bell, Dumbbell, Utensils } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { getAvatarUrl } from "@/lib/avatarUtils";
import { GradientCard } from "@/components/micro/GradientCard";
import { ProgressPill } from "@/components/micro/ProgressPill";
import { WeeklyActivity } from "@/components/charts/WeeklyActivity";
import { MotivationSkeleton } from "@/components/skeletons/MotivationSkeleton";
import HomeSkeleton from "@/components/skeletons/HomeSkeleton";

interface HomeViewProps {
  generatingPlans: boolean;
  workoutPlan: any;
  nutritionPlan: any;
  onGeneratePlans: () => void;
  profile?: any;
  workoutProgress?: { completed: number; total: number };
}

const HomeView: React.FC<HomeViewProps> = ({
  generatingPlans,
  workoutPlan,
  nutritionPlan,
  onGeneratePlans,
  profile,
  workoutProgress = { completed: 0, total: 0 }
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

  // Mock data for activity chart
  const weeklyActivityData = [
    { day: "Mo", value: 85 },
    { day: "Di", value: 92 },
    { day: "Mi", value: 78 },
    { day: "Do", value: 100 },
    { day: "Fr", value: 88 },
    { day: "Sa", value: 0 },
    { day: "So", value: 95 }
  ];

  // Calculate progress values
  const workoutProgressPercentage = workoutProgress.total > 0 
    ? (workoutProgress.completed / workoutProgress.total) * 100 
    : 0;
  const nutritionProgressPercentage = 65; // Mock value for now

  // Load motivation quote
  useEffect(() => {
    const loadQuote = () => {
      // Use fallback quote for now (database table will be created later)
      const randomQuote = fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)];
      setQuote(randomQuote.text);
      setQuoteAuthor(randomQuote.author);
      setIsLoadingQuote(false);
    };

    // Small delay to show skeleton briefly
    const timer = setTimeout(loadQuote, 500);
    return () => clearTimeout(timer);
  }, []);

  // Show skeleton when initially loading or generating plans
  if (generatingPlans && !workoutPlan && !nutritionPlan) {
    return <HomeSkeleton />;
  }

  // Get user's first name
  const firstName = profile?.first_name || "Nutzer";
  const avatarUrl = getAvatarUrl(profile?.avatar_path);
  const progressPercentage = workoutProgress.total > 0 
    ? (workoutProgress.completed / workoutProgress.total) * 100 
    : 0;

  return (
    <div className="space-y-6">
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
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-primary/80">
              Motivationsspruch
            </h2>
            <blockquote className="text-lg font-medium text-foreground leading-relaxed">
              "{quote}"
            </blockquote>
            {quoteAuthor && (
              <cite className="text-sm text-muted-foreground not-italic">
                — {quoteAuthor}
              </cite>
            )}
          </div>
        </GradientCard>
      )}

      {/* Progress Rows */}
      <motion.div
        className="space-y-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
      >
        {/* Today's Training Progress */}
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/20">
              <Dumbbell className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-medium text-foreground">Heutiges Training</h3>
              <p className="text-sm text-muted-foreground">
                {workoutProgress.completed} von {workoutProgress.total} Übungen
              </p>
            </div>
          </div>
          <ProgressPill 
            value={Math.round(workoutProgressPercentage)} 
            aria-label={`Training Fortschritt: ${Math.round(workoutProgressPercentage)} Prozent`}
          />
        </div>

        {/* Nutrition Progress */}
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-info/20">
              <Utensils className="h-5 w-5 text-info" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-medium text-foreground">Ernährung</h3>
              <p className="text-sm text-muted-foreground">
                Tagesziel erreicht
              </p>
            </div>
          </div>
          <ProgressPill 
            value={nutritionProgressPercentage} 
            aria-label={`Ernährungs-Fortschritt: ${nutritionProgressPercentage} Prozent`}
          />
        </div>
      </motion.div>

      {/* Weekly Activity Chart */}
      <WeeklyActivity data={weeklyActivityData} />

      {/* Generate Plans Button */}
      <motion.div
        className="pt-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
      >
        <Button 
          className="w-full gradient-primary text-primary-foreground shadow-glow hover-scale" 
          onClick={onGeneratePlans}
          disabled={generatingPlans}
          size="lg"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${generatingPlans ? 'animate-spin' : ''}`} />
          {generatingPlans ? "Pläne werden erstellt..." : (workoutPlan || nutritionPlan ? "Pläne neu generieren" : "Neue Pläne erstellen")}
        </Button>
      </motion.div>
    </div>
  );
};

export default HomeView;