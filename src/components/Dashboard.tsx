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
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { format, addDays, isSameDay, startOfWeek, differenceInCalendarDays } from "date-fns";
import { toZonedTime } from 'date-fns-tz';
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
  
  useEffect(() => {
    if (user) {
      fetchProfile();
      fetchPlans();
      fetchWorkoutLogs();
    }
  }, [user]);

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

  const getWeekdayName = (dayIndex: number) => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    return t(`dashboard.workoutDays.${days[dayIndex]}`);
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
    if (!user) return;

    setGeneratingPlans(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-plans', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: {},
      });

      if (error) throw error;

      if (data.success) {
        toast.success('Plans generated successfully!');
        await fetchPlans(); // Refresh the plans
      } else {
        throw new Error(data.error || 'Failed to generate plans');
      }
    } catch (error) {
      console.error('Error generating plans:', error);
      const errorMsg = error?.message || 'Failed to generate plans. Please try again.';
      toast.error(errorMsg);
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
    <motion.div 
      className="max-w-7xl mx-auto p-6"
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
          <Tabs defaultValue="workout" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.4 }}
            >
              <TabsList className="grid w-full md:w-fit grid-cols-3 md:grid-cols-3 bg-card border border-border">
                <TabsTrigger value="workout" className="flex items-center gap-2 transition-all duration-200 data-[state=active]:scale-105">
                  <Dumbbell className="h-4 w-4" />
                  {t('dashboard.tabs.workoutPlan')}
                </TabsTrigger>
                <TabsTrigger value="nutrition" className="flex items-center gap-2 transition-all duration-200 data-[state=active]:scale-105">
                  <Apple className="h-4 w-4" />
                  {t('dashboard.tabs.nutritionPlan')}
                </TabsTrigger>
                <TabsTrigger value="profile" className="flex items-center gap-2 transition-all duration-200 data-[state=active]:scale-105">
                  <User className="h-4 w-4" />
                  {t('dashboard.tabs.profile')}
                </TabsTrigger>
              </TabsList>
            </motion.div>

          <TabsContent value="workout" className="space-y-6">
            <AnimatePresence mode="wait">
              <motion.div
                key="workout-content"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {/* Weekly Progress */}
                {workoutPlan && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    whileHover={{ scale: 1.01 }}
                  >
                    <Card className="gradient-card border-primary/20 hover-scale">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">{t('dashboard.workoutCompletion.weeklyProgress')}</span>
                          <span className="text-sm text-muted-foreground">
                            {getWeeklyProgress().completed} / {getWeeklyProgress().total} {t('dashboard.workoutCompletion.daysCompleted')}
                          </span>
                        </div>
                        <Progress 
                          value={getWeeklyProgress().total > 0 ? (getWeeklyProgress().completed / getWeeklyProgress().total) * 100 : 0} 
                          className="h-2" 
                        />
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
            
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                  whileHover={{ scale: 1.01, boxShadow: "0 10px 25px -3px rgba(0, 0, 0, 0.1)" }}
                >
                  <Card className="gradient-card border-primary/20 hover-scale">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Dumbbell className="h-5 w-5 text-primary" />
                        {t('dashboard.workoutPlan.title')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                 {workoutPlan ? (
                   <div className="space-y-6">
                     {/* Sticky Today's Workout */}
                     <motion.div
                       className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border pb-4 mb-6"
                       initial={{ opacity: 0, y: -20 }}
                       animate={{ opacity: 1, y: 0 }}
                       transition={{ duration: 0.3 }}
                     >
                      {(() => {
                          const todayWorkout = getTodayWorkout();
                          if (!todayWorkout) {
                            return (
                              <Card className="border-muted">
                                <CardContent className="py-4">
                                  <p className="text-sm text-muted-foreground text-center">
                                    Kein Training für heute geplant
                                  </p>
                                </CardContent>
                              </Card>
                            );
                          }

                          if (todayWorkout.__restDay) {
                            const nextWorkout = findNextWorkoutInCurrentWeek();
                            const nextWorkoutLater = findNextWorkoutAcrossWeeks();
                            const getGermanWeekday = (dayIdx: number) => {
                              const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
                              return days[dayIdx] || '';
                            };

                            return (
                              <Card className="border-muted bg-gradient-to-r from-muted/20 to-muted/10">
                                <CardHeader className="pb-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <CardTitle className="text-lg font-bold text-muted-foreground">
                                        Ruhetag
                                      </CardTitle>
                                      <Badge variant="secondary" className="text-xs">
                                        Heute
                                      </Badge>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled
                                      className="h-8 w-8 p-0 text-muted-foreground cursor-not-allowed opacity-50"
                                    >
                                      <Check className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </CardHeader>
                                <CardContent className="pt-0">
                                  <div className="space-y-2">
                                    <p className="text-sm text-muted-foreground">
                                      Kein Training für heute geplant.
                                    </p>
                                    {nextWorkout ? (
                                      <p className="text-xs text-muted-foreground">
                                        Nächstes Training: {getGermanWeekday(nextWorkout.dayIndex)}
                                      </p>
                                    ) : nextWorkoutLater ? (
                                      <p className="text-xs text-muted-foreground">
                                        Nächstes Training: {formatDateForDisplay(nextWorkoutLater.date, 'EEEE, d. MMMM')}
                                      </p>
                                    ) : (
                                      <p className="text-xs text-muted-foreground">
                                        Keine zukünftigen Trainings geplant.
                                      </p>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          }

                          return (
                            <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-primary/10">
                              <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <CardTitle className="text-lg font-bold text-primary">
                                      Heutiges Training
                                    </CardTitle>
                                    <Badge className="gradient-primary text-xs">
                                      Heute
                                    </Badge>
                                  </div>
                                   <TooltipProvider>
                                     <Tooltip>
                                       <TooltipTrigger asChild>
                                         <motion.div
                                           whileHover={{ scale: isDayInFuture(todayWorkout.weekKey, todayWorkout.dayIndex) ? 1 : 1.1 }}
                                           whileTap={{ scale: isDayInFuture(todayWorkout.weekKey, todayWorkout.dayIndex) ? 1 : 0.9 }}
                                         >
                                           <Button
                                             variant="ghost"
                                             size="sm"
                                             onClick={() => toggleDayComplete(todayWorkout.weekKey, todayWorkout.dayIndex)}
                                             disabled={isDayInFuture(todayWorkout.weekKey, todayWorkout.dayIndex) || completingWorkout === todayWorkout.dayIndex}
                                             className={`h-8 w-8 p-0 ${
                                               isDayInFuture(todayWorkout.weekKey, todayWorkout.dayIndex)
                                                 ? 'text-muted-foreground cursor-not-allowed opacity-50'
                                                 : todayWorkout.isCompleted 
                                                   ? 'text-green-600 bg-green-100 dark:bg-green-900/20' 
                                                   : 'hover:bg-primary/10'
                                             }`}
                                           >
                                             <AnimatePresence mode="wait">
                                               {isDayInFuture(todayWorkout.weekKey, todayWorkout.dayIndex) ? (
                                                 <motion.div
                                                   key="locked"
                                                   initial={{ scale: 0 }}
                                                   animate={{ scale: 1 }}
                                                 >
                                                   <Lock className="h-4 w-4" />
                                                 </motion.div>
                                               ) : completingWorkout === todayWorkout.dayIndex ? (
                                                 <motion.div
                                                   key="completing"
                                                   initial={{ scale: 0, rotate: -180 }}
                                                   animate={{ scale: 1, rotate: 0 }}
                                                   exit={{ scale: 0, rotate: 180 }}
                                                 >
                                                   <CheckCircle className="h-4 w-4 text-green-500" />
                                                 </motion.div>
                                               ) : todayWorkout.isCompleted ? (
                                                 <motion.div
                                                   key="completed"
                                                   initial={{ scale: 0 }}
                                                   animate={{ scale: 1 }}
                                                 >
                                                   <CheckCircle className="h-4 w-4 text-green-600" />
                                                 </motion.div>
                                               ) : (
                                                 <motion.div
                                                   key="incomplete"
                                                   initial={{ scale: 0 }}
                                                   animate={{ scale: 1 }}
                                                 >
                                                   <Check className="h-4 w-4" />
                                                 </motion.div>
                                               )}
                                             </AnimatePresence>
                                           </Button>
                                         </motion.div>
                                       </TooltipTrigger>
                                       {isDayInFuture(todayWorkout.weekKey, todayWorkout.dayIndex) && (
                                         <TooltipContent>
                                           <p>Zukünftige Trainingstage sind gesperrt</p>
                                         </TooltipContent>
                                       )}
                                     </Tooltip>
                                   </TooltipProvider>
                                </div>
                              </CardHeader>
                              <CardContent className="pt-0">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                                    <span>{['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][todayWorkout.dayIndex]}</span>
                                    <span>{todayWorkout.dayData.exercises?.length || 0} Übungen</span>
                                  </div>
                                  <div className={`space-y-1 ${todayWorkout.isCompleted ? 'opacity-60' : ''}`}>
                                    {todayWorkout.dayData.exercises?.slice(0, 3).map((exercise: any, index: number) => (
                                      <div key={index} className="flex justify-between items-center text-xs">
                                        <span className="font-medium">{exercise.name}</span>
                                        <span className="text-muted-foreground">
                                          {exercise.sets}×{exercise.reps}
                                        </span>
                                      </div>
                                    ))}
                                    {todayWorkout.dayData.exercises?.length > 3 && (
                                      <div className="text-xs text-muted-foreground">
                                        +{todayWorkout.dayData.exercises.length - 3} weitere Übungen
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })()}
                     </motion.div>

                     {/* Weekly Progress */}
                     <motion.div
                       className="mb-6"
                       initial={{ opacity: 0, y: -20 }}
                       animate={{ opacity: 1, y: 0 }}
                       transition={{ duration: 0.3 }}
                     >
                       <div className="flex items-center justify-between mb-2">
                         <h4 className="font-semibold text-primary">
                           {activeWeek ? getWeekTitle(activeWeek) : 'Current Week'}
                         </h4>
                         <span className="text-sm text-muted-foreground">
                           {t('dashboard.workoutCompletion.daysCompletedShort', { 
                             completed: currentWeekProgress.completed, 
                             total: currentWeekProgress.total 
                           })}
                         </span>
                       </div>
                       <Progress 
                         value={currentWeekProgress.total > 0 ? (currentWeekProgress.completed / currentWeekProgress.total) * 100 : 0} 
                         className="h-2 mb-4" 
                       />
                       
                       {/* Week Navigation with Progress Badges */}
                       <div className="flex gap-2 overflow-x-auto pb-2">
                         {Object.keys(workoutPlan.content).map((weekKey) => {
                           const progress = getWeekProgress(weekKey);
                           return (
                             <motion.div
                               key={weekKey}
                               whileHover={{ scale: 1.02 }}
                               whileTap={{ scale: 0.98 }}
                             >
                               <Button
                                 variant={activeWeek === weekKey ? "default" : "outline"}
                                 size="sm"
                                 onClick={() => setActiveWeek(weekKey)}
                                 className="whitespace-nowrap"
                               >
                                 {getWeekTitle(weekKey)} ({progress.completed}/{progress.total})
                               </Button>
                             </motion.div>
                           );
                         })}
                       </div>
                     </motion.div>

                     {/* Week Accordion */}
                     <Accordion 
                       type="single" 
                       value={activeWeek || ''} 
                       onValueChange={setActiveWeek}
                       className="space-y-4"
                     >
                       {Object.entries(workoutPlan.content).map(([weekKey, days]: [string, any]) => (
                         <AccordionItem key={weekKey} value={weekKey} className="border border-border rounded-lg">
                           <AccordionTrigger className="px-4 py-3 hover:no-underline">
                             <div className="flex items-center justify-between w-full mr-4">
                               <div className="flex items-center gap-3">
                                 <h3 className="text-lg font-semibold text-primary">
                                   {getWeekTitle(weekKey)}
                                 </h3>
                                 <Badge variant="secondary" className="text-xs">
                                   {getWeekProgress(weekKey).completed} / {getWeekProgress(weekKey).total} {t('dashboard.workoutCompletion.daysCompleted')}
                                 </Badge>
                               </div>
                             </div>
                           </AccordionTrigger>
                           <AccordionContent className="px-4 pb-4">
                             {/* Day Accordions within Week */}
                             <Accordion 
                               type="multiple" 
                               value={Array.from(activeDays)}
                               onValueChange={(value) => setActiveDays(new Set(value))}
                               className="space-y-3"
                             >
                               {days.map((day: any, dayIndex: number) => {
                                 const isCurrentDay = isTodayInWeekDay(weekKey, dayIndex);
                                 const isCompleted = isDayCompleted(weekKey, dayIndex);
                                 const dayKey = `${weekKey}-${dayIndex}`;
                                 
                                 return (
                                   <AccordionItem key={dayIndex} value={dayKey} className="border border-border/50 rounded-lg">
                                     <AccordionTrigger className="px-4 py-3 hover:no-underline">
                                       <div className="flex items-center justify-between w-full mr-4">
                                         <div className="flex items-center gap-2">
                                           <CardTitle className={`text-base ${isCurrentDay ? 'text-primary font-bold' : ''}`}>
                                             {getWeekdayName(dayIndex)}
                                           </CardTitle>
                                           {isCurrentDay && (
                                             <motion.div
                                               initial={{ scale: 0 }}
                                               animate={{ scale: 1 }}
                                               transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                             >
                                               <Badge className="text-xs gradient-primary">
                                                 {t('dashboard.workoutCompletion.today')}
                                               </Badge>
                                             </motion.div>
                                           )}
                                           <AnimatePresence>
                                             {isCompleted && (
                                               <motion.div
                                                 initial={{ scale: 0, rotate: -180 }}
                                                 animate={{ scale: 1, rotate: 0 }}
                                                 exit={{ scale: 0, rotate: 180 }}
                                                 transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                               >
                                                 <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                                                   ✅ {t('dashboard.workoutCompletion.completed')}
                                                 </Badge>
                                               </motion.div>
                                             )}
                                           </AnimatePresence>
                                         </div>
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <motion.div
                                                  whileHover={{ scale: isDayInFuture(weekKey, dayIndex) ? 1 : 1.1 }}
                                                  whileTap={{ scale: isDayInFuture(weekKey, dayIndex) ? 1 : 0.9 }}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (!isDayInFuture(weekKey, dayIndex)) {
                                                      toggleDayComplete(weekKey, dayIndex);
                                                    }
                                                  }}
                                                >
                                                  <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={isDayInFuture(weekKey, dayIndex) || completingWorkout === dayIndex}
                                                    className={`h-8 w-8 p-0 ${
                                                      isDayInFuture(weekKey, dayIndex)
                                                        ? 'text-muted-foreground cursor-not-allowed opacity-50'
                                                        : isCompleted 
                                                          ? 'text-green-600 bg-green-100 dark:bg-green-900/20' 
                                                          : 'hover:bg-primary/10'
                                                    }`}
                                                  >
                                                    <AnimatePresence mode="wait">
                                                      {isDayInFuture(weekKey, dayIndex) ? (
                                                        <motion.div
                                                          key="locked"
                                                          initial={{ scale: 0 }}
                                                          animate={{ scale: 1 }}
                                                        >
                                                          <Lock className="h-4 w-4" />
                                                        </motion.div>
                                                      ) : completingWorkout === dayIndex ? (
                                                        <motion.div
                                                          key="completing"
                                                          initial={{ scale: 0, rotate: -180 }}
                                                          animate={{ scale: 1, rotate: 0 }}
                                                          exit={{ scale: 0, rotate: 180 }}
                                                        >
                                                          <CheckCircle className="h-4 w-4 text-green-500" />
                                                        </motion.div>
                                                      ) : isCompleted ? (
                                                        <motion.div
                                                          key="completed"
                                                          initial={{ scale: 0 }}
                                                          animate={{ scale: 1 }}
                                                        >
                                                          <CheckCircle className="h-4 w-4 text-green-600" />
                                                        </motion.div>
                                                      ) : (
                                                        <motion.div
                                                          key="incomplete"
                                                          initial={{ scale: 0 }}
                                                          animate={{ scale: 1 }}
                                                        >
                                                          <Check className="h-4 w-4" />
                                                        </motion.div>
                                                      )}
                                                    </AnimatePresence>
                                                  </Button>
                                                </motion.div>
                                              </TooltipTrigger>
                                              {isDayInFuture(weekKey, dayIndex) && (
                                                <TooltipContent>
                                                  <p>{t('dashboard.futureDay.tooltip')}</p>
                                                </TooltipContent>
                                              )}
                                            </Tooltip>
                                          </TooltipProvider>
                                       </div>
                                     </AccordionTrigger>
                                     <AccordionContent className="px-4 pb-4">
                                       <motion.div
                                         initial={{ opacity: 0, y: 10 }}
                                         animate={{ opacity: isCompleted ? 0.6 : 1, y: 0 }}
                                         transition={{ duration: 0.3 }}
                                       >
                                         {/* Grouped Exercise Card */}
                                         <Card className="border-primary/10 bg-muted/30">
                                           <CardContent className="p-4">
                                             <div className="space-y-2">
                                               <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                                                 <span>{day.exercises?.length || 0} {t('dashboard.exerciseGroup.exercises')}</span>
                                                 <div className="flex items-center gap-4 text-xs">
                                                   <span className="flex items-center gap-1">
                                                     <Dumbbell className="h-3 w-3" />
                                                     {t('dashboard.exerciseGroup.sets')}
                                                   </span>
                                                   <span className="flex items-center gap-1">
                                                     <Target className="h-3 w-3" />
                                                     {t('dashboard.exerciseGroup.reps')}
                                                   </span>
                                                 </div>
                                               </div>
                                               {day.exercises?.map((exercise: any, exerciseIndex: number) => (
                                                 <motion.div 
                                                   key={exerciseIndex} 
                                                   className="flex justify-between items-center py-2 px-3 bg-background/50 rounded-md"
                                                   whileHover={{ x: 2 }}
                                                   transition={{ duration: 0.2 }}
                                                 >
                                                   <div className="flex items-center gap-2">
                                                     <Dumbbell className="h-3 w-3 text-primary/60" />
                                                     <span className="font-medium text-sm">{exercise.name}</span>
                                                   </div>
                                                   <div className="text-xs text-muted-foreground">
                                                     {exercise.sets} × {exercise.reps} • {exercise.rest}
                                                   </div>
                                                 </motion.div>
                                               ))}
                                             </div>
                                           </CardContent>
                                         </Card>
                                       </motion.div>
                                     </AccordionContent>
                                   </AccordionItem>
                                 );
                               })}
                             </Accordion>
                           </AccordionContent>
                         </AccordionItem>
                       ))}
                     </Accordion>
                   </div>
                ) : (
                      <motion.div 
                        className="text-center py-8"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                      >
                        <p className="text-muted-foreground">
                          No workout plan generated yet. Click "Generate Plans" to create your personalized plan.
                        </p>
                      </motion.div>
                     )}
                     </CardContent>
                  </Card>
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </TabsContent>

          <TabsContent value="nutrition" className="space-y-6">
            <AnimatePresence mode="wait">
              <motion.div
                key="nutrition-content"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  whileHover={{ scale: 1.01, boxShadow: "0 10px 25px -3px rgba(0, 0, 0, 0.1)" }}
                >
                  <Card className="gradient-card border-primary/20 hover-scale">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Apple className="h-5 w-5 text-primary" />
                        {t('dashboard.nutritionPlan.title')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {nutritionPlan ? (
                        <div className="space-y-6">
                          {Object.entries(nutritionPlan.content).map(([mealType, meals]: [string, any]) => (
                            <div key={mealType} className="space-y-3">
                              <h3 className="text-lg font-semibold capitalize text-primary">{mealType}</h3>
                              <div className="grid gap-3">
                                {meals.map((meal: any, mealIndex: number) => (
                                  <motion.div
                                    key={mealIndex}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, delay: mealIndex * 0.1 }}
                                    whileHover={{ scale: 1.02, y: -2 }}
                                  >
                                    <Card className="border-primary/10 hover-scale">
                                      <CardContent className="p-4">
                                        <div className="flex justify-between items-start">
                                          <div className="flex-1">
                                            <h4 className="font-medium">{meal.meal}</h4>
                                            <p className="text-sm text-muted-foreground mt-1">{meal.description}</p>
                                          </div>
                                          <motion.div
                                            whileHover={{ scale: 1.1 }}
                                            transition={{ duration: 0.2 }}
                                          >
                                            <Badge variant="secondary" className="ml-3">
                                              {meal.calories} cal
                                            </Badge>
                                          </motion.div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  </motion.div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <motion.div 
                          className="text-center py-8"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.3 }}
                        >
                          <p className="text-muted-foreground">
                            No nutrition plan generated yet. Click "Generate Plans" to create your personalized plan.
                          </p>
                        </motion.div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </TabsContent>

          <TabsContent value="profile" className="space-y-6">
            <AnimatePresence mode="wait">
              <motion.div
                key="profile-content"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <ProfileCard 
                  profile={profile}
                  onProfileUpdate={fetchProfile}
                  workoutProgress={getWeeklyProgress()}
                />
              </motion.div>
            </AnimatePresence>
          </TabsContent>
          </Tabs>
        </motion.div>
      </motion.div>
    );
  };

export default Dashboard;