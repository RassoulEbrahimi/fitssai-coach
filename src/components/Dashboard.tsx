import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
  ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ProfileCard } from "@/components/ProfileCard";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { format, addDays, isSameDay, startOfWeek } from "date-fns";
import { enUS, faIR } from "date-fns/locale";

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
  // TODO: Re-enable Quote of the Day feature
  // const [dailyQuote, setDailyQuote] = useState<any>(null);
  // const [loadingQuote, setLoadingQuote] = useState(true);
  
  useEffect(() => {
    if (user) {
      fetchProfile();
      fetchPlans();
      fetchWorkoutLogs();
      // TODO: Re-enable quote fetching
      // fetchDailyQuote();
    }
  }, [user]);

  // TODO: Re-enable quote fetching on language change
  // useEffect(() => {
  //   if (user) {
  //     fetchDailyQuote();
  //   }
  // }, [i18n.language]);

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

  // TODO: Re-enable Quote of the Day feature - fetchDailyQuote function
  // const fetchDailyQuote = async (forceRefresh = false) => {
  //   if (!user) return;
  //
  //   setLoadingQuote(true);
  //   try {
  //     const { data, error } = await supabase.functions.invoke('get-daily-quote', {
  //       body: { 
  //         language: i18n.language,
  //         forceRefresh 
  //       },
  //     });
  //
  //     if (error) throw error;
  //     setDailyQuote(data);
  //   } catch (error) {
  //     console.error('Error fetching daily quote:', error);
  //     setDailyQuote({
  //       quote: i18n.language === 'fa' 
  //         ? 'هر روز فرصتی جدید برای بهتر شدن است.'
  //         : 'Every day is a new opportunity to become better.',
  //       author: 'FitssAI',
  //       language: i18n.language
  //     });
  //   } finally {
  //     setLoadingQuote(false);
  //   }
  // };

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

  // Simplified day completion function - marks entire day as done
  const markDayComplete = async (weekKey: string, dayIndex: number) => {
    if (!user || !workoutPlan || completingWorkout === dayIndex) return;

    setCompletingWorkout(dayIndex);
    
    try {
      // Calculate the actual date based on week and day
      const weekNumber = parseInt(weekKey.replace(/\D/g, '')) - 1; // Extract week number (0-based)
      const totalDaysFromStart = (weekNumber * 7) + dayIndex;
      const startDate = new Date(); // For demo, using current date as reference
      const workoutDate = addDays(startDate, totalDaysFromStart - new Date().getDay());
      
      const { error } = await supabase
        .from('workout_logs')
        .insert({
          user_id: user.id,
          plan_id: workoutPlan.id,
          workout_day: workoutDate.toISOString().split('T')[0],
          completed: true,
          completed_at: new Date().toISOString()
        });

      if (error) throw error;
      
      // Add delay for animation effect
      setTimeout(() => {
        toast.success(t('dashboard.workoutCompletion.dayCompleted'));
        fetchWorkoutLogs(); // Refresh logs
        setCompletingWorkout(null);
      }, 600);
    } catch (error) {
      console.error('Error marking day complete:', error);
      toast.error('Failed to mark day as complete');
      setCompletingWorkout(null);
    }
  };

  // Check if a specific day in a specific week is completed
  const isDayCompleted = (weekKey: string, dayIndex: number) => {
    const weekNumber = parseInt(weekKey.replace(/\D/g, '')) - 1;
    const totalDaysFromStart = (weekNumber * 7) + dayIndex;
    const startDate = new Date();
    const workoutDate = addDays(startDate, totalDaysFromStart - new Date().getDay());
    const dateString = workoutDate.toISOString().split('T')[0];
    return workoutLogs.some(log => log.workout_day === dateString && log.completed);
  };

  // Check if today matches a specific week and day
  const isTodayInWeekDay = (weekKey: string, dayIndex: number) => {
    const weekNumber = parseInt(weekKey.replace(/\D/g, '')) - 1;
    const totalDaysFromStart = (weekNumber * 7) + dayIndex;
    const startDate = new Date();
    const targetDate = addDays(startDate, totalDaysFromStart - new Date().getDay());
    return isSameDay(targetDate, new Date());
  };

  // Get current week based on today's date
  const getCurrentWeek = () => {
    if (!workoutPlan || !workoutPlan.content) return null;
    const weekKeys = Object.keys(workoutPlan.content);
    return weekKeys[0]; // For demo purposes, return first week. In real app, calculate based on start date
  };

  // Get week progress for a specific week
  const getWeekProgress = (weekKey: string) => {
    if (!workoutPlan || !workoutPlan.content) return { completed: 0, total: 0 };
    
    const weekData = workoutPlan.content[weekKey];
    if (!Array.isArray(weekData)) return { completed: 0, total: 0 };
    
    const completed = weekData.filter((_, dayIndex) => isDayCompleted(weekKey, dayIndex)).length;
    return { completed, total: weekData.length };
  };

  // Format week title for display
  const getWeekTitle = (weekKey: string) => {
    const weekNumber = weekKey.replace(/([A-Z])/g, ' $1').trim();
    return weekNumber.charAt(0).toUpperCase() + weekNumber.slice(1);
  };

  // Set initial active week on load
  useEffect(() => {
    if (workoutPlan && !activeWeek) {
      const currentWeek = getCurrentWeek();
      setActiveWeek(currentWeek);
    }
  }, [workoutPlan]);

  // Update current week progress
  useEffect(() => {
    if (activeWeek && workoutLogs.length > 0) {
      const progress = getWeekProgress(activeWeek);
      setCurrentWeekProgress(progress);
    }
  }, [activeWeek, workoutLogs]);

  const isWorkoutCompleted = (dayIndex: number) => {
    const startDate = startOfWeek(new Date(), { weekStartsOn: 6 });
    const workoutDate = addDays(startDate, dayIndex);
    const dateString = workoutDate.toISOString().split('T')[0];
    return workoutLogs.some(log => log.workout_day === dateString && log.completed);
  };

  const getWeeklyProgress = () => {
    const startDate = startOfWeek(new Date(), { weekStartsOn: 6 });
    const weeklyLogs = workoutLogs.filter(log => {
      const logDate = new Date(log.workout_day);
      const weekStart = startOfWeek(logDate, { weekStartsOn: 6 });
      return weekStart.getTime() === startDate.getTime() && log.completed;
    });
    
    let totalDays = 0;
    if (workoutPlan && workoutPlan.content) {
      const firstWeek = Object.values(workoutPlan.content)[0];
      totalDays = Array.isArray(firstWeek) ? firstWeek.length : 0;
    }
    
    return {
      completed: weeklyLogs.length,
      total: totalDays
    };
  };

  const getWeekdayName = (dayIndex: number) => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    return t(`dashboard.workoutDays.${days[dayIndex]}`);
  };

  const formatWorkoutDate = (startDate: Date, dayIndex: number) => {
    const date = addDays(startDate, dayIndex);
    const locale = i18n.language === 'fa' ? faIR : enUS;
    
    if (i18n.language === 'fa') {
      // Format for Persian: "شنبه ۲ شهریور"
      return format(date, 'EEEE d MMMM', { locale });
    } else {
      // Format for English: "Saturday, Aug 24"
      return format(date, 'EEEE, MMM d', { locale });
    }
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
        body: {
          language: i18n.language, // Pass current language to edge function
        },
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
      toast.error('Failed to generate plans. Please try again.');
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

        {/* TODO: Re-enable Quote of the Day feature */}
        {/* Daily Quote - DISABLED */}
        {/* <Card className="gradient-card border-primary/20 mb-8">
          <CardContent className="p-6">
            <div className={`flex items-start justify-between ${i18n.language === 'fa' ? 'flex-row-reverse' : ''}`}>
              <div className={`flex-1 ${i18n.language === 'fa' ? 'text-right' : 'text-left'}`}>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <span>💡</span>
                  <span>{i18n.language === 'fa' ? 'نقل قول روز' : 'Quote of the Day'}</span>
                </h3>
                {loadingQuote ? (
                  <div className="animate-pulse">
                    <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                  </div>
                ) : (
                  <div className={`${i18n.language === 'fa' ? 'rtl' : 'ltr'}`}>
                    <p className="text-foreground mb-2 italic text-lg leading-relaxed">
                      "{dailyQuote?.quote}"
                    </p>
                    <p className="text-muted-foreground text-sm">
                      — {dailyQuote?.author}
                    </p>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchDailyQuote(true)}
                disabled={loadingQuote}
                className={`${i18n.language === 'fa' ? 'ml-4' : 'mr-4'} shrink-0`}
              >
                <RefreshCw className={`h-4 w-4 ${loadingQuote ? 'animate-spin' : ''} ${i18n.language === 'fa' ? 'ml-2' : 'mr-2'}`} />
                {i18n.language === 'fa' ? 'تجدید' : 'Refresh'}
              </Button>
            </div>
          </CardContent>
        </Card> */}

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
                    {/* Sticky Weekly Progress */}
                    <motion.div 
                      className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm p-4 -mx-4 -mt-2 rounded-lg border border-border/50"
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
                      
                      {/* Week Navigation */}
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {Object.keys(workoutPlan.content).map((weekKey) => (
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
                              {getWeekTitle(weekKey)}
                            </Button>
                          </motion.div>
                        ))}
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
                            <motion.div
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3, staggerChildren: 0.1 }}
                              className="space-y-4"
                            >
                              {days.map((day: any, dayIndex: number) => {
                                const isCurrentDay = isTodayInWeekDay(weekKey, dayIndex);
                                const isCompleted = isDayCompleted(weekKey, dayIndex);
                                
                                return (
                                  <motion.div
                                    key={dayIndex}
                                    layout
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ 
                                      opacity: isCompleted ? 0.7 : 1, 
                                      scale: isCompleted ? 0.98 : 1 
                                    }}
                                    transition={{ duration: 0.3 }}
                                    whileHover={{ scale: isCompleted ? 0.98 : 1.02, y: -2 }}
                                    id={isCurrentDay ? 'today-workout' : undefined}
                                  >
                                    <Card className={`
                                      border-primary/10 transition-all duration-300 
                                      ${isCompleted ? 'bg-muted/30' : 'hover-scale'}
                                      ${isCurrentDay ? 'ring-2 ring-primary/50 border-primary/30' : ''}
                                    `}>
                                      <CardHeader className="pb-3">
                                        <div className="flex items-center justify-between">
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
                                        </div>
                                      </CardHeader>
                                      <CardContent>
                                        <motion.div 
                                          className="space-y-2 mb-4"
                                          animate={{ opacity: isCompleted ? 0.6 : 1 }}
                                          transition={{ duration: 0.3 }}
                                        >
                                          {day.exercises.map((exercise: any, exerciseIndex: number) => (
                                            <motion.div 
                                              key={exerciseIndex} 
                                              className="flex justify-between items-center p-3 bg-muted/50 rounded-lg"
                                              whileHover={{ x: 4 }}
                                              transition={{ duration: 0.2 }}
                                            >
                                              <div>
                                                <span className="font-medium text-sm">{exercise.name}</span>
                                              </div>
                                              <div className="text-xs text-muted-foreground">
                                                {exercise.sets} sets × {exercise.reps} • {exercise.rest}
                                              </div>
                                            </motion.div>
                                          ))}
                                        </motion.div>
                                        
                                        {/* Single Day Completion Button */}
                                        <AnimatePresence>
                                          {!isCompleted && (
                                            <motion.div 
                                              initial={{ opacity: 1, height: "auto" }}
                                              exit={{ opacity: 0, height: 0 }}
                                              transition={{ duration: 0.3 }}
                                            >
                                              <motion.div
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                              >
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() => markDayComplete(weekKey, dayIndex)}
                                                  disabled={completingWorkout === dayIndex}
                                                  className={`
                                                    w-full transition-all duration-200
                                                    ${isCurrentDay 
                                                      ? 'gradient-primary text-primary-foreground shadow-glow hover:shadow-glow' 
                                                      : 'bg-primary/10 hover:bg-primary/20 border-primary/30'
                                                    }
                                                  `}
                                                >
                                                  <AnimatePresence mode="wait">
                                                    {completingWorkout === dayIndex ? (
                                                      <motion.div
                                                        key="completing"
                                                        initial={{ scale: 0, rotate: -180 }}
                                                        animate={{ scale: 1, rotate: 0 }}
                                                        exit={{ scale: 0, rotate: 180 }}
                                                        className="flex items-center"
                                                      >
                                                        <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
                                                        <span className="text-green-600">{t('dashboard.workoutCompletion.dayCompleted')}</span>
                                                      </motion.div>
                                                    ) : (
                                                      <motion.div
                                                        key="mark-done"
                                                        initial={{ scale: 0 }}
                                                        animate={{ scale: 1 }}
                                                        exit={{ scale: 0 }}
                                                        className="flex items-center"
                                                      >
                                                        <Check className="h-4 w-4 mr-2" />
                                                        {t('dashboard.workoutCompletion.markDayAsDone')}
                                                      </motion.div>
                                                    )}
                                                  </AnimatePresence>
                                                </Button>
                                              </motion.div>
                                            </motion.div>
                                          )}
                                        </AnimatePresence>
                                      </CardContent>
                                    </Card>
                                  </motion.div>
                                );
                              })}
                            </motion.div>
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