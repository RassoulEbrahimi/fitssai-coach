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
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ProfileCard } from "@/components/ProfileCard";
import VideoBackground from '@/components/VideoBackground';
import { useState, useEffect, Suspense, useRef, useCallback, useLayoutEffect } from "react";
import React from "react";
import { toast } from "sonner";
import { format, addDays, isSameDay, startOfWeek, differenceInCalendarDays } from "date-fns";
import { toZonedTime } from 'date-fns-tz';
import BottomNav from './BottomNav';
import BottomNavPortal from './BottomNavPortal';
import { default as SectionSkeleton, WorkoutSkeleton, NutritionSkeleton, ProfileSkeleton } from "@/components/skeletons/SectionSkeleton";
import HomeSkeleton from "@/components/skeletons/HomeSkeleton";

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
        heading.focus({ preventScroll: true } as any);
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
  getWorkoutDateString 
} from "@/lib/workoutDateUtils";
import { useBerlinToday } from "@/hooks/useBerlinToday";

const Dashboard = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  
  // Reactive Berlin "today" - updates automatically at midnight
  const berlinToday = useBerlinToday();
  
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [workoutPlan, setWorkoutPlan] = useState<any>(null);
  const [nutritionPlan, setNutritionPlan] = useState<any>(null);
  const [generatingPlans, setGeneratingPlans] = useState(false);
  const [workoutLogs, setWorkoutLogs] = useState<any[]>([]);
  const [completingWorkout, setCompletingWorkout] = useState<number | null>(null);
  const [activeWeek, setActiveWeek] = useState<string | null>(null);
  const [activeDays, setActiveDays] = useState<Set<string>>(new Set());
  const [activeDayIndex, setActiveDayIndex] = useState<number>(0);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date()); // New date selection state

  // Hash-based navigation helpers
  const hashToTab = (hash: string): 'dashboard' | 'workout' | 'nutrition' | 'profile' | null => {
    const clean = (hash || '').replace(/^#\/?/, '').toLowerCase();
    if (clean === '' || clean === 'dashboard' || clean === '/') return 'dashboard';
    if (clean === 'workout') return 'workout';
    if (clean === 'nutrition') return 'nutrition';
    if (clean === 'profile') return 'profile';
    return null; // unknown → caller will fallback to 'dashboard'
  };

  const setHashForTab = (tab: 'dashboard' | 'workout' | 'nutrition' | 'profile') => {
    if (tab === 'dashboard') {
      history.pushState(null, '', '#/');
    } else {
      history.pushState(null, '', `#/${tab}`);
    }
    if (tab === 'dashboard' || tab === 'workout') {
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    }
  };

  const initialTab = hashToTab(location.hash) ?? 'dashboard'; // default to dashboard if null
  const [activeTab, setActiveTab] = useState<'dashboard' | 'workout' | 'nutrition' | 'profile'>(initialTab);

  // Scroll memory for per-tab scroll positions
  const scrollPosRef = useRef<Record<'dashboard' | 'workout' | 'nutrition' | 'profile', number>>({
    dashboard: 0,
    workout: 0,
    nutrition: 0,
    profile: 0
  });
  const previousTabRef = useRef<'dashboard' | 'workout' | 'nutrition' | 'profile'>(initialTab);

  // Performance optimization hooks
  const { prefetchOnIntersection } = useIntersectionPrefetch();
  const { setViewRef } = useFocusManagement(activeTab);
  const bottomNavRef = useRef<HTMLElement>(null);
  
  // Animation state for mobile tab switching
  const prefersReducedMotion = useReducedMotion();
  const [direction, setDirection] = useState<1 | -1>(1); // 1 = forward (slide left), -1 = backward (slide right)
  
  // Mobile detection for constraining animations to mobile only
  const isMobile = (() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(max-width: 767px)').matches;
  })();
  
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

  // Scroll memory and document title management
  useLayoutEffect(() => {
    const prevTab = previousTabRef.current;
    
    // Store previous tab's scroll position
    if (prevTab !== activeTab) {
      scrollPosRef.current[prevTab] = window.scrollY;
    }
    
    // Update slide direction based on tab order
    const order = ['dashboard', 'workout', 'nutrition', 'profile'] as const;
    const prev = previousTabRef.current as typeof order[number];
    const next = activeTab as typeof order[number];
    if (prev !== next) {
      setDirection(order.indexOf(next) > order.indexOf(prev) ? 1 : -1);
    }
    
    // Update document title based on active tab
    const titles = {
      dashboard: "FitssAI — Dashboard",
      workout: "FitssAI — Trainingsplan", 
      nutrition: "FitssAI — Ernährungsplan",
      profile: "FitssAI — Profil"
    };
    document.title = titles[activeTab];
    
    // Note: Scroll restoration removed to prevent jump-to-bottom on back navigation
    
    previousTabRef.current = activeTab;
  }, [activeTab]);

  // Focus management for accessibility
  useEffect(() => {
    const onHashChange = () => {
      const next = hashToTab(location.hash) ?? 'dashboard';
      setActiveTab(next);
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

  // Listen for workout logs changes from TodayWorkoutCard
  useEffect(() => {
    const handleWorkoutLogsChanged = () => {
      fetchWorkoutLogs();
    };
    
    window.addEventListener('workoutLogsChanged', handleWorkoutLogsChanged);
    return () => window.removeEventListener('workoutLogsChanged', handleWorkoutLogsChanged);
  }, [workoutPlan]);

  // Robust workout logging with timezone handling and toggle functionality
  const toggleDayComplete = async (weekKey: string, dayIndex: number) => {
    if (!user || !workoutPlan || completingWorkout === dayIndex) return;

    // Calculate the workout date using Berlin timezone
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
    if (!workoutPlan?.created_at) return false;
    
    const dateString = getWorkoutDateString(workoutPlan.created_at, weekKey, dayIndex);
    return workoutLogs.some(log => log.workout_day === dateString && log.completed);
  };

  // Check if today matches a specific week and day (Berlin timezone)
  const isTodayInWeekDay = (weekKey: string, dayIndex: number) => {
    if (!workoutPlan?.created_at) return false;
    
    const targetStr = getWorkoutDateString(workoutPlan.created_at, weekKey, dayIndex);
    return targetStr === berlinToday;
  };

  // Check if a day is in the future (Berlin timezone)
  const isDayInFuture = (weekKey: string, dayIndex: number) => {
    if (!workoutPlan?.created_at) return false;
    
    const targetDateStr = getWorkoutDateString(workoutPlan.created_at, weekKey, dayIndex);
    return isBerlinFuture(targetDateStr);
  };

  // Get current week based on selected date
  const getCurrentWeek = () => {
    if (!workoutPlan?.created_at) return null;
    return getWeekKeyForDate(selectedDate);
  };

  // Get week key for a specific date using plan-based mapping
  const getWeekKeyForDate = (date: Date): string => {
    if (!workoutPlan?.created_at) return 'Week 1';
    const { weekKey } = getWorkoutWeekDay(workoutPlan.created_at, date);
    return weekKey;
  };

  // Get week content with fallback - mirror Week 2 to Weeks 3-4 if only Week 2 exists
  // IMPORTANT: This function only provides UI display data (exercise lists).
  // When users interact with exercises (mark complete, etc.), the actual weekKey 
  // passed to backend functions MUST be the real selected week, never the mirror source.
  const getWeekContentWithFallback = (weekKey: string) => {
    if (!workoutPlan?.content) return [];
    
    // If week exists in plan (even with empty/partial days), return it directly - no mirroring
    const existing = workoutPlan.content[weekKey] || workoutPlan.content[weekKey.toLowerCase().replace(' ', '')];
    if (existing) return existing;
    
    const weekNumber = parseInt(weekKey.replace(/\D/g, ''));
    
    // Special fallback logic: if only Week 2 exists, keep Week 1 empty, mirror Week 2 to Weeks 3-4
    const week2 = workoutPlan.content['Week 2'] || workoutPlan.content['week2'];
    const week1 = workoutPlan.content['Week 1'] || workoutPlan.content['week1'];
    
    if (weekNumber === 1 && !week1 && week2) {
      // Keep Week 1 empty (return empty array) - UI only
      return [];
    }
    
    if ((weekNumber === 3 || weekNumber === 4) && !existing && week2) {
      // Mirror Week 2 into Weeks 3-4 - UI display only, backend still uses actual weekKey
      return week2;
    }
    
    // Default fallback to Week 1 - UI display only, backend still uses actual weekKey
    if (weekNumber > 1 && weekNumber <= 4 && week1) {
      return week1;
    }
    
    return [];
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

  // Get calendar date for a given weekKey and dayIndex using plan-based mapping
  const getDateFor = (weekKey: string, dayIndex: number): Date | null => {
    if (!workoutPlan?.created_at) return null;
    return getWorkoutDate(workoutPlan.created_at, weekKey, dayIndex);
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
    if (!workoutPlan?.created_at) return null;
    const today = getBerlinNow();
    const { weekKey } = getWorkoutWeekDay(workoutPlan.created_at, today);
    return weekKey;
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
    if (!workoutPlan?.created_at) return null;
    const weekKeys = getOrderedWeekKeys();
    const currentKey = getCurrentWeekKey();
    if (weekKeys.length === 0 || !currentKey) return null;

    const currentIdx = Math.max(0, weekKeys.indexOf(currentKey));
    for (let w = currentIdx + 1; w < weekKeys.length; w++) {
      const wk = weekKeys[w];
      for (let d = 0; d < 7; d++) {
        const day = getWorkoutAt(wk, d);
        if (day) {
          const targetDate = getWorkoutDate(workoutPlan.created_at, wk, d);
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

  // Set initial active week and today's day on load, sync with date changes
  useEffect(() => {
    if (workoutPlan) {
      const currentWeek = getCurrentWeek();
      setActiveWeek(currentWeek);
      
      // Auto-expand today's day if it's today
      if (currentWeek && isSameDay(selectedDate, new Date())) {
        const todayDayIndex = getTodayDayIndex(currentWeek);
        if (todayDayIndex !== -1) {
          setActiveDays(new Set([`${currentWeek}-${todayDayIndex}`]));
        }
      }
    }
  }, [workoutPlan, selectedDate]); // Depend on selectedDate changes

  // Handle date changes from calendar - update selected date and active week
  const handleDateChange = (date: Date) => {
    setSelectedDate(date);
    
    if (!workoutPlan?.created_at) return;
    
    // Calculate day index and week key using plan-based mapping
    const { weekKey, dayIndex } = getWorkoutWeekDay(workoutPlan.created_at, date);
    
    if (dayIndex >= 0 && dayIndex <= 6) {
      setActiveDayIndex(dayIndex);
    }
    
    // Update active week based on the new date
    if (weekKey !== activeWeek) {
      setActiveWeek(weekKey);
    }
  };



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
        className="relative z-10 max-w-7xl mx-auto px-0 md:px-6 pt-[var(--nav-h)] pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >

        {/* Main Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <div className="space-y-6">
            {/* View stack: one child mounted at a time with slide animations */}
            <div className="relative">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={activeTab}
                  custom={direction}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  variants={{
                    enter: (dir: 1 | -1) => ({ 
                      x: prefersReducedMotion || !isMobile ? 0 : dir * 40, 
                      opacity: prefersReducedMotion || !isMobile ? 1 : 0 
                    }),
                    center: { x: 0, opacity: 1 },
                    exit: (dir: 1 | -1) => ({ 
                      x: prefersReducedMotion || !isMobile ? 0 : dir * -40, 
                      opacity: prefersReducedMotion || !isMobile ? 1 : 0 
                    })
                  }}
                  transition={{ 
                    type: 'tween', 
                    duration: prefersReducedMotion || !isMobile ? 0 : 0.18, 
                    ease: 'easeOut' 
                  }}
                >
                  {activeTab === 'dashboard' && (
                    <div className="space-y-6">
                      <Suspense fallback={<HomeSkeleton />}>
                        <div ref={(el) => setViewRef('dashboard', el)}>
                           <HomeView
                             generatingPlans={generatingPlans}
                             workoutPlan={workoutPlan}
                             nutritionPlan={nutritionPlan}
                             onGeneratePlans={generatePlans}
                             profile={profile}
                             workoutProgress={getWeeklyProgress()}
                             getTodayWorkout={getTodayWorkout}
                             isDayCompleted={isDayCompleted}
                             getWeeklyProgress={getWeeklyProgress}
                             selectedDate={selectedDate}
                             onProgressUpdate={(weeklyProgress) => {
                               // Update weekly progress state
                               fetchWorkoutLogs();
                             }}
                           />
                        </div>
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'workout' && (
                    <div className="space-y-6">
                      <Suspense fallback={<WorkoutSkeleton />}>
                        <div ref={(el) => setViewRef('workout', el)}>
            <WorkoutView
              workoutPlan={workoutPlan}
              workoutLogs={workoutLogs}
              completingWorkout={completingWorkout}
              selectedDate={selectedDate}
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
              getWeekContentWithFallback={getWeekContentWithFallback}
              getWeekKeyForDate={getWeekKeyForDate}
              toggleDayComplete={toggleDayComplete}
              handleDateChange={handleDateChange}
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
                            generatingPlans={generatingPlans}
                            workoutPlan={workoutPlan}
                            nutritionPlan={nutritionPlan}
                            onGeneratePlans={generatePlans}
                          />
                        </div>
                      </Suspense>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </motion.div>
      
      <BottomNavPortal>
        <BottomNav 
          ref={bottomNavRef}
          activeTab={activeTab} 
          onChange={(tab) => {
            setHashForTab(tab);
            setActiveTab(tab);  // Immediately update state for instant UI response
            
            // Optional haptic feedback for supported devices
            try {
              if (navigator.vibrate) navigator.vibrate(8); // very subtle
            } catch {}
          }}
        />
      </BottomNavPortal>
    </div>
  );
};

export default Dashboard;