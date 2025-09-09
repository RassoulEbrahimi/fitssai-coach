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
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ProfileCard } from "@/components/ProfileCard";
import VideoBackground from '@/components/VideoBackground';
import { useState, useEffect, Suspense, useRef, useCallback } from "react";
import React from "react";
import { toast } from "sonner";
import { format, addDays, isSameDay, startOfWeek, differenceInCalendarDays } from "date-fns";
import { toZonedTime } from 'date-fns-tz';
import BottomNav from './BottomNav';
import { default as SectionSkeleton, WorkoutSkeleton, NutritionSkeleton, ProfileSkeleton } from "@/components/skeletons/SectionSkeleton";

// Lazy load view components for code splitting
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
        heading.focus();
        // Remove tabIndex after focus to avoid affecting tab order
        setTimeout(() => { heading.tabIndex = 0; }, 100);
      }
    }
  }, [activeTab]);
  
  return { setViewRef };
};
import { 
  getBerlinNow, 
  getBerlinToday, 
  getBerlinCurrentWeek, 
  isBerlinToday, 
  isBerlinFuture, 
  isBerlinPast,
  formatDateForDisplay,
  getWeekDays,
  TARGET_TIMEZONE,
  WEEK_OPTIONS
} from "@/lib/dateUtils";

const Dashboard = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [workoutPlan, setWorkoutPlan] = useState<any>(null);
  const [nutritionPlan, setNutritionPlan] = useState<any>(null);
  const [generatingPlans, setGeneratingPlans] = useState(false);
  const [workoutLogs, setWorkoutLogs] = useState<any[]>([]);
  const [completingWorkout, setCompletingWorkout] = useState<number | null>(null);
  const [activeWeek, setActiveWeek] = useState<string | null>(null);
  const [currentWeekProgress, setCurrentWeekProgress] = useState({ completed: 0, total: 0 });
  const [activeDays, setActiveDays] = useState<Set<string>>(new Set());

  // Hash-based navigation helpers
  const hashToTab = (hash: string): 'workout' | 'nutrition' | 'profile' | null => {
    switch (hash.replace('#', '').replace('/', '')) {
      case 'workout': return 'workout';
      case 'nutrition': return 'nutrition';
      case 'profile': return 'profile';
      case '':
      case undefined:
      case null:
        return null; // dashboard
      default:
        return null;
    }
  };

  const setHashForTab = (tab: 'dashboard' | 'workout' | 'nutrition' | 'profile') => {
    if (tab === 'dashboard') {
      history.pushState(null, '', '#/');
    } else {
      history.pushState(null, '', `#/${tab}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const initialTab = hashToTab(location.hash) ?? 'workout'; // default to workout if null
  const [activeTab, setActiveTab] = useState<'workout' | 'nutrition' | 'profile'>(initialTab);

  // Performance optimization hooks
  const { prefetchOnIntersection } = useIntersectionPrefetch();
  const { setViewRef } = useFocusManagement(activeTab);
  const bottomNavRef = useRef<HTMLElement>(null);
  
  useEffect(() => {
    if (user) {
      fetchProfile();
      fetchPlans();
      fetchWorkoutLogs();
    }
  }, [user]);

  // Focus management and intersection observer for prefetching
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

  // Focus management for accessibility
  useEffect(() => {
    const onHashChange = () => {
      const next = hashToTab(location.hash);
      if (next) {
        setActiveTab(next);
        // Focus management is handled by useFocusManagement hook
      }
      // If null (dashboard), stay on current tab visually
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const fetchProfile = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPlans = async () => {
    if (!user) return;

    try {
      // Fetch latest workout plan
      const { data: workoutData } = await supabase
        .from('workout_plans')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      // Fetch latest nutrition plan
      const { data: nutritionData } = await supabase
        .from('nutrition_plans')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      setWorkoutPlan(workoutData?.[0] || null);
      setNutritionPlan(nutritionData?.[0] || null);
    } catch (error) {
      console.error('Error fetching plans:', error);
    }
  };

  const fetchWorkoutLogs = async () => {
    if (!user || !workoutPlan) return;

    try {
      const { data, error } = await supabase
        .from('workout_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('plan_id', workoutPlan.id);

      if (error) throw error;
      setWorkoutLogs(data || []);
    } catch (error) {
      console.error('Error fetching workout logs:', error);
    }
  };

  // Fetch workout logs when workout plan changes
  useEffect(() => {
    if (workoutPlan) {
      fetchWorkoutLogs();
    }
  }, [workoutPlan]);

  // Robust workout logging with timezone handling and toggle functionality
  const toggleDayComplete = async (weekKey: string, dayIndex: number) => {
    if (!user || !workoutPlan || completingWorkout === dayIndex) return;

    // Calculate the workout date using Berlin timezone
    const berlinToday = getBerlinToday();
    const weekNumber = parseInt(weekKey.replace(/\D/g, '')) - 1;
    const totalDaysFromStart = (weekNumber * 7) + dayIndex;
    
    // For demo, using plan creation date as reference. In production, use actual plan start date
    const planCreatedDate = new Date(workoutPlan.created_at);
    const workoutDate = addDays(planCreatedDate, totalDaysFromStart);
    const workoutDateStr = format(workoutDate, 'yyyy-MM-dd');

    // Prevent future day completion
    if (isBerlinFuture(workoutDateStr)) {
      toast.error(t('dashboard.futureDay.locked'));
      return;
    }

    setCompletingWorkout(dayIndex);
    
    try {
      // Check if log already exists
      const { data: existingLog, error: fetchError } = await supabase
        .from('workout_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('plan_id', workoutPlan.id)
        .eq('workout_day', workoutDateStr)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existingLog) {
        // Toggle existing log
        if (existingLog.completed) {
          // Mark as incomplete
          const { error } = await supabase
            .from('workout_logs')
            .update({
              completed: false,
              completed_at: null
            })
            .eq('id', existingLog.id);

          if (error) throw error;
          toast.success('Workout marked as incomplete');
        } else {
          // Mark as complete
          const { error } = await supabase
            .from('workout_logs')
            .update({
              completed: true,
              completed_at: new Date().toISOString()
            })
            .eq('id', existingLog.id);

          if (error) throw error;
          toast.success(t('dashboard.workoutCompletion.dayCompleted'));
        }
      } else {
        // Create new log as completed
        const { error } = await supabase
          .from('workout_logs')
          .upsert({
            user_id: user.id,
            plan_id: workoutPlan.id,
            workout_day: workoutDateStr,
            completed: true,
            completed_at: new Date().toISOString()
          }, {
            onConflict: 'user_id,plan_id,workout_day'
          });

        if (error) throw error;
        toast.success(t('dashboard.workoutCompletion.dayCompleted'));
      }
      
      // Add delay for animation effect
      setTimeout(() => {
        fetchWorkoutLogs(); // Refresh logs
        setCompletingWorkout(null);
      }, 600);
    } catch (error) {
      console.error('Error toggling day completion:', error);
      toast.error('Failed to update workout status');
      setCompletingWorkout(null);
    }
  };

  // Check if a specific day in a specific week is completed (timezone-aware)
  const isDayCompleted = (weekKey: string, dayIndex: number) => {
    if (!workoutPlan) return false;
    
    const weekNumber = parseInt(weekKey.replace(/\D/g, '')) - 1;
    const totalDaysFromStart = (weekNumber * 7) + dayIndex;
    const planCreatedDate = new Date(workoutPlan.created_at);
    const workoutDate = addDays(planCreatedDate, totalDaysFromStart);
    const dateString = format(workoutDate, 'yyyy-MM-dd');
    
    return workoutLogs.some(log => log.workout_day === dateString && log.completed);
  };

  // Check if today matches a specific week and day (Berlin timezone)
  const isTodayInWeekDay = (weekKey: string, dayIndex: number) => {
    if (!workoutPlan?.created_at) return false;

    // 1) Plan creation instant → Berlin local time
    const createdAt = new Date(workoutPlan.created_at);
    const createdAtBerlin = toZonedTime(createdAt, TARGET_TIMEZONE);

    // 2) Align start to Monday of that week (German standard)
    const planStartMonday = startOfWeek(createdAtBerlin, WEEK_OPTIONS);

    // 3) Advance by (weekIndex*7 + dayIndex)
    const weekIndex = parseInt(weekKey.replace(/\D/g, '')) - 1; // Week1 → 0
    const offsetDays = weekIndex * 7 + dayIndex;
    const targetDate = addDays(planStartMonday, offsetDays);

    // 4) Compare with Berlin "today" using our utility (DATE-only compare)
    const targetStr = format(targetDate, 'yyyy-MM-dd');
    return isBerlinToday(targetStr);
  };

  // Check if a day is in the future (Berlin timezone)
  const isDayInFuture = (weekKey: string, dayIndex: number) => {
    if (!workoutPlan) return false;
    
    const weekNumber = parseInt(weekKey.replace(/\D/g, '')) - 1;
    const totalDaysFromStart = (weekNumber * 7) + dayIndex;
    const planCreatedDate = new Date(workoutPlan.created_at);
    const targetDate = addDays(planCreatedDate, totalDaysFromStart);
    const targetDateStr = format(targetDate, 'yyyy-MM-dd');
    
    return isBerlinFuture(targetDateStr);
  };

  // Get current week based on today's date
  const getCurrentWeek = () => {
    if (!workoutPlan || !workoutPlan.content) return null;
    const weekKeys = Object.keys(workoutPlan.content);
    return weekKeys[0]; // For demo purposes, return first week. In real app, calculate based on start date
  };

  // Get week progress for a specific week (accurate calculation)
  const getWeekProgress = (weekKey: string) => {
    if (!workoutPlan || !workoutPlan.content) return { completed: 0, total: 0 };
    
    const weekData = workoutPlan.content[weekKey];
    if (!Array.isArray(weekData)) return { completed: 0, total: 0 };
    
    // Count only non-rest days as total
    const totalWorkoutDays = weekData.filter((day: any) => 
      day.exercises && day.exercises.length > 0
    ).length;
    
    // Count completed days, excluding future days
    const completedDays = weekData.filter((_, dayIndex) => {
      if (isDayInFuture(weekKey, dayIndex)) return false; // Exclude future days
      return isDayCompleted(weekKey, dayIndex);
    }).length;
    
    return { 
      completed: Math.min(completedDays, totalWorkoutDays), // Cap at total
      total: totalWorkoutDays 
    };
  };

  // Get today's day index for a specific week
  const getTodayDayIndex = (weekKey: string) => {
    if (!workoutPlan || !workoutPlan.content) return -1;
    const weekData = workoutPlan.content[weekKey];
    if (!Array.isArray(weekData)) return -1;
    
    for (let dayIndex = 0; dayIndex < weekData.length; dayIndex++) {
      if (isTodayInWeekDay(weekKey, dayIndex)) {
        return dayIndex;
      }
    }
    return -1;
  };

  // Format week title for display
  const getWeekTitle = (weekKey: string) => {
    const weekNumber = weekKey.replace(/([A-Z])/g, ' $1').trim();
    return weekNumber.charAt(0).toUpperCase() + weekNumber.slice(1);
  };

  // Returns the workout object for a given (weekKey, dayIndex) or null
  const getWorkoutAt = (weekKey: string, dayIndex: number) => {
    const days = workoutPlan?.content?.[weekKey];
    if (!days) return null;
    const day = days[dayIndex];
    if (!day || !Array.isArray(day.exercises) || day.exercises.length === 0) return null;
    return day;
  };

  // Get plan start Monday from created_at
  const getPlanStartMonday = () => {
    if (!workoutPlan?.created_at) return null;
    const createdAt = new Date(workoutPlan.created_at);
    const createdAtBerlin = toZonedTime(createdAt, TARGET_TIMEZONE);
    return startOfWeek(createdAtBerlin, WEEK_OPTIONS); // Monday-aligned
  };

  // Get calendar date for a given weekKey and dayIndex
  const getDateFor = (weekKey: string, dayIndex: number) => {
    const startMonday = getPlanStartMonday();
    if (!startMonday) return null;
    const weekIdx = parseInt(weekKey.replace(/\D/g, '')) - 1; // week1 → 0
    const offsetDays = (weekIdx * 7) + dayIndex;
    return addDays(startMonday, offsetDays); // Date object in Berlin timeline
  };

  // Get ordered week keys (week1..week4)
  const getOrderedWeekKeys = () => {
    if (!workoutPlan?.content) return [];
    // Sort keys by their numeric index: "week1","week2",...
    return Object.keys(workoutPlan.content)
      .sort((a, b) => (parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, ''))));
  };

  // Get current week key based on days since plan start
  const getCurrentWeekKey = () => {
    const startMonday = getPlanStartMonday();
    if (!startMonday) return null;
    const today = new Date(); // Berlin alignment is handled in isTodayInWeekDay()
    const days = differenceInCalendarDays(today, startMonday);
    const idx = Math.max(0, Math.min(3, Math.floor(days / 7))); // clamp 0..3
    const weekKeys = getOrderedWeekKeys();
    return weekKeys[idx] || weekKeys[0] || null;
  };

  // Finds the next workout (>= today) in the current week; returns { weekKey, dayIndex } or null
  const findNextWorkoutInCurrentWeek = () => {
    if (!workoutPlan) return null;
    const currentWeekKey = getCurrentWeekKey();
    if (!currentWeekKey) return null;
    
    for (let i = 0; i < 7; i++) {
      if (isTodayInWeekDay(currentWeekKey, i)) {
        // start from today, look ahead including today
        for (let d = i; d < 7; d++) {
          if (getWorkoutAt(currentWeekKey, d)) {
            return { weekKey: currentWeekKey, dayIndex: d };
          }
        }
        break;
      }
    }
    return null;
  };

  // Find next workout across all weeks (start from *next* week)
  const findNextWorkoutAcrossWeeks = () => {
    const startMonday = getPlanStartMonday();
    const weekKeys = getOrderedWeekKeys();
    const currentKey = getCurrentWeekKey();
    if (!startMonday || weekKeys.length === 0 || !currentKey) return null;

    const currentIdx = Math.max(0, weekKeys.indexOf(currentKey));
    for (let w = currentIdx + 1; w < weekKeys.length; w++) {
      const wk = weekKeys[w];
      for (let d = 0; d < 7; d++) {
        const day = getWorkoutAt(wk, d);
        if (day) {
          const offsetDays = (w * 7) + d;
          const targetDate = addDays(startMonday, offsetDays);
          return { weekKey: wk, dayIndex: d, date: targetDate };
        }
      }
    }
    return null;
  };

  // Get today's workout data
  const getTodayWorkout = () => {
    if (!workoutPlan || !workoutPlan.content) return null;
    
    for (const [weekKey, days] of Object.entries(workoutPlan.content)) {
      const weekData = days as any[];
      // Check full week (0..6) not just weekData.length
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        if (isTodayInWeekDay(weekKey, dayIndex)) {
          const workoutData = getWorkoutAt(weekKey, dayIndex);
          if (workoutData) {
            return {
              weekKey,
              dayIndex,
              dayData: workoutData,
              isCompleted: isDayCompleted(weekKey, dayIndex)
            };
          } else {
            // Rest day sentinel
            return {
              __restDay: true,
              weekKey,
              dayIndex,
              isCompleted: false
            };
          }
        }
      }
    }
    return null;
  };

  // Toggle day accordion
  const toggleDay = (dayKey: string) => {
    const newActiveDays = new Set(activeDays);
    if (newActiveDays.has(dayKey)) {
      newActiveDays.delete(dayKey);
    } else {
      newActiveDays.add(dayKey);
    }
    setActiveDays(newActiveDays);
  };

  // Set initial active week and today's day on load
  useEffect(() => {
    if (workoutPlan && !activeWeek) {
      const currentWeek = getCurrentWeek();
      setActiveWeek(currentWeek);
      
      // Auto-expand today's day
      if (currentWeek) {
        const todayDayIndex = getTodayDayIndex(currentWeek);
        if (todayDayIndex !== -1) {
          setActiveDays(new Set([`${currentWeek}-${todayDayIndex}`]));
        }
      }
    }
  }, [workoutPlan]);

  // Update current week progress
  useEffect(() => {
    if (activeWeek && workoutLogs.length > 0) {
      const progress = getWeekProgress(activeWeek);
      setCurrentWeekProgress(progress);
    }
  }, [activeWeek, workoutLogs]);


  // Accurate weekly progress calculation using Berlin timezone
  const getWeeklyProgress = () => {
    if (!workoutPlan || !workoutLogs) return { completed: 0, total: 0 };
    
    const { startStr, endStr } = getBerlinCurrentWeek();
    
    // Filter logs for current week in Berlin timezone
    const weeklyLogs = workoutLogs.filter(log => {
      return log.workout_day >= startStr && 
             log.workout_day <= endStr && 
             log.completed &&
             !isBerlinFuture(log.workout_day); // Exclude future days
    });
    
    // Calculate total planned workout days for current week
    let totalPlannedDays = 0;
    if (workoutPlan.content) {
      // For demo, use first week's structure. In production, calculate based on current week
      const firstWeek = Object.values(workoutPlan.content)[0] as any[];
      totalPlannedDays = Array.isArray(firstWeek) 
        ? firstWeek.filter((day: any) => day.exercises && day.exercises.length > 0).length 
        : 0;
    }
    
    return {
      completed: Math.min(weeklyLogs.length, totalPlannedDays), // Cap at total planned
      total: totalPlannedDays
    };
  };


  const formatWorkoutDate = (startDate: Date, dayIndex: number) => {
    const date = addDays(startDate, dayIndex);
    return formatDateForDisplay(date, 'EEEE, d. MMMM');
  };

  const isToday = (startDate: Date, dayIndex: number) => {
    const date = addDays(startDate, dayIndex);
    return isSameDay(date, new Date());
  };

  const generatePlans = async () => {
    if (generatingPlans) return;
    setGeneratingPlans(true);
    try {
      // Get a fresh session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Bitte melde dich erneut an.');
        return;
      }

      // Call Edge Function with explicit headers + non-empty body
      const { data, error } = await supabase.functions.invoke('generate-plans', {
        body: { trigger: 'manual' },
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        // If the SDK returns error object
        toast.error(error.message || 'Fehler beim Erstellen der Pläne. Bitte später erneut versuchen.');
        return;
      }

      // If you're using fetch elsewhere, always parse server JSON and surface German `data.error`
      if (data?.error) {
        toast.error(data.error);
        return;
      }

      // If the Edge Function used the mock fallback (quota), surface an info toast
      if (data && (data as any).warning === 'mocked') {
        toast('Hinweis: Demo-Pläne (Fallback) wurden erstellt.', {
          description: 'Die KI-Generierung ist derzeit nicht verfügbar.',
          duration: 5000,
        });
      } else {
        toast.success('Pläne erfolgreich erstellt!');
      }
      await fetchPlans(); // Refresh the plans
    } catch (err: any) {
      toast.error('Fehler beim Erstellen der Pläne. Bitte später erneut versuchen.');
    } finally {
      setGeneratingPlans(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xl">Loading your profile...</div>
      </div>
    );
  }
  
  return (
    <div className="relative min-h-screen z-20">
      <VideoBackground />
      <motion.div 
        className="relative z-10 max-w-7xl mx-auto p-6 pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
      {/* Header */}
      <motion.div 
        className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
          <div>
            <h1 className="text-3xl font-bold mb-2">{t('dashboard.welcome')}</h1>
            <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Button 
                className="gradient-primary text-primary-foreground shadow-glow hover-scale" 
                onClick={generatePlans}
                disabled={generatingPlans}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${generatingPlans ? 'animate-spin' : ''}`} />
                {generatingPlans ? t('dashboard.stats.generating') : (workoutPlan || nutritionPlan ? t('dashboard.regenerate.button') : t('dashboard.stats.generatePlans'))}
              </Button>
            </motion.div>
          </div>
        </motion.div>

        {/* Quick Stats */}
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, staggerChildren: 0.1 }}
        >
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0 }
            }}
            whileHover={{ scale: 1.02, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" }}
            transition={{ duration: 0.2 }}
          >
            <Card className="gradient-card border-primary/20 hover-scale">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('dashboard.stats.currentStreak')}</p>
                    <p className="text-2xl font-bold text-primary">12 {t('dashboard.stats.days')}</p>
                  </div>
                  <Flame className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0 }
            }}
            whileHover={{ scale: 1.02, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" }}
            transition={{ duration: 0.2 }}
          >
            <Card className="gradient-card border-primary/20 hover-scale">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('dashboard.stats.weeklyGoal')}</p>
                    <p className="text-2xl font-bold text-primary">4/5</p>
                  </div>
                  <Target className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0 }
            }}
            whileHover={{ scale: 1.02, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" }}
            transition={{ duration: 0.2 }}
          >
            <Card className="gradient-card border-primary/20 hover-scale">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('dashboard.stats.caloriesBurned')}</p>
                    <p className="text-2xl font-bold text-primary">2,450</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0 }
            }}
            whileHover={{ scale: 1.02, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" }}
            transition={{ duration: 0.2 }}
          >
            <Card className="gradient-card border-primary/20 hover-scale">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('dashboard.stats.nextWorkout')}</p>
                    <p className="text-2xl font-bold text-primary">{t('dashboard.stats.today')}</p>
                  </div>
                  <Clock className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>

        {/* Main Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.4 }}
            >
              <div className="hidden md:grid w-full md:w-fit grid-cols-3 md:grid-cols-3 bg-card border border-border rounded-lg p-1">
                <button
                  onClick={() => setHashForTab('workout')}
                  className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-all duration-200 ${
                    activeTab === 'workout' 
                      ? 'bg-primary text-primary-foreground scale-105' 
                      : 'hover:bg-muted'
                  }`}
                >
                  <Dumbbell className="h-4 w-4" />
                  {t('dashboard.tabs.workoutPlan')}
                </button>
                <button
                  onClick={() => setHashForTab('nutrition')}
                  className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-all duration-200 ${
                    activeTab === 'nutrition' 
                      ? 'bg-primary text-primary-foreground scale-105' 
                      : 'hover:bg-muted'
                  }`}
                >
                  <Apple className="h-4 w-4" />
                  {t('dashboard.tabs.nutritionPlan')}
                </button>
                <button
                  onClick={() => setHashForTab('profile')}
                  className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-all duration-200 ${
                    activeTab === 'profile' 
                      ? 'bg-primary text-primary-foreground scale-105' 
                      : 'hover:bg-muted'
                  }`}
                >
                  <User className="h-4 w-4" />
                  {t('dashboard.tabs.profile')}
                </button>
              </div>
            </motion.div>

            {activeTab === 'workout' && (
              <div className="space-y-6">
                <Suspense fallback={<WorkoutSkeleton />}>
                  <div ref={(el) => setViewRef('workout', el)}>
                    <WorkoutView
                      workoutPlan={workoutPlan}
                      workoutLogs={workoutLogs}
                      completingWorkout={completingWorkout}
                      activeWeek={activeWeek}
                      currentWeekProgress={currentWeekProgress}
                      activeDays={activeDays}
                      getTodayWorkout={getTodayWorkout}
                      findNextWorkoutInCurrentWeek={findNextWorkoutInCurrentWeek}
                      findNextWorkoutAcrossWeeks={findNextWorkoutAcrossWeeks}
                      isDayCompleted={isDayCompleted}
                      isDayInFuture={isDayInFuture}
                      isTodayInWeekDay={isTodayInWeekDay}
                      getDateFor={getDateFor}
                      getWeekTitle={getWeekTitle}
                      getWeekProgress={getWeekProgress}
                      getWeeklyProgress={getWeeklyProgress}
                      toggleDayComplete={toggleDayComplete}
                      setActiveWeek={setActiveWeek}
                      setActiveDays={setActiveDays}
                      toggleDay={toggleDay}
                    />
                  </div>
                </Suspense>
              </div>
            )}

            {activeTab === 'nutrition' && (
              <div className="space-y-6">
                <Suspense fallback={<NutritionSkeleton />}>
                  <div ref={(el) => setViewRef('nutrition', el)}>
                    <NutritionView nutritionPlan={nutritionPlan} />
                  </div>
                </Suspense>
              </div>
            )}

            {activeTab === 'profile' && (
              <div className="space-y-6">
                <Suspense fallback={<ProfileSkeleton />}>
                  <div ref={(el) => setViewRef('profile', el)}>
                    <ProfileView 
                      profile={profile}
                      onProfileUpdate={fetchProfile}
                      workoutProgress={getWeeklyProgress()}
                    />
                  </div>
                </Suspense>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
      
      <BottomNav 
        ref={bottomNavRef}
        activeTab={activeTab} 
        onChange={(tab) => {
          if (tab === 'dashboard') {
            setHashForTab('dashboard');
            // Stay on current tab visually when user taps Dashboard
            return;
          }
          setHashForTab(tab);
          setActiveTab(tab);  // Immediately update state for instant UI response
        }}
      />
    </div>
  );
};

export default Dashboard;