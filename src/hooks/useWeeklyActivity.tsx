import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, format } from "date-fns";
import { de } from "date-fns/locale";
import { useAuth } from "@/hooks/useAuth";

export type ViewMode = "weekly" | "monthly";

interface WorkoutLog {
  workout_day: string;
  completed: boolean;
  completed_at: string | null;
}

interface DayActivity {
  date: Date;
  minutes: number;
  workouts: number;
}

interface WeeklyActivityData {
  dailyData: number[]; // Minutes per day for chart
  dayLabels: string[]; // Day labels (Mo, Di, etc.)
  activeDays: number;
  totalMinutes: number;
  totalWorkouts: number;
  targetMinutes: number;
  isLoading: boolean;
}

const MINUTES_PER_EXERCISE = 10; // Estimated minutes per completed exercise
const WEEKLY_TARGET = 350; // 350 minutes = ~50 min/day
const MONTHLY_TARGET = 1500; // ~50 min/day for 30 days

export const useWeeklyActivity = (viewMode: ViewMode = "weekly") => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const fetchActivityData = async (): Promise<WeeklyActivityData> => {
    if (!user) throw new Error("User not authenticated");

    const now = new Date();
    const startDate = viewMode === "weekly"
      ? startOfWeek(now, { weekStartsOn: 1 }) // Monday
      : startOfMonth(now);
    const endDate = viewMode === "weekly"
      ? endOfWeek(now, { weekStartsOn: 1 })
      : endOfMonth(now);

    // Fetch workout logs for the period
    const { data: logs, error } = await supabase
      .from("workout_logs")
      .select("workout_day, completed, completed_at")
      .eq("user_id", user.id)
      .eq("completed", true)
      .gte("workout_day", format(startDate, "yyyy-MM-dd"))
      .lte("workout_day", format(endDate, "yyyy-MM-dd"));

    if (error) throw error;

    // Create daily activity map
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const activityMap = new Map<string, DayActivity>();

    // Initialize all days
    days.forEach(day => {
      activityMap.set(format(day, "yyyy-MM-dd"), {
        date: day,
        minutes: 0,
        workouts: 0,
      });
    });

    // Aggregate workout data
    (logs || []).forEach((log: WorkoutLog) => {
      const dateKey = log.workout_day;
      const activity = activityMap.get(dateKey);
      if (activity) {
        activity.workouts += 1;
        activity.minutes += MINUTES_PER_EXERCISE;
      }
    });

    // Convert to array for chart
    const dailyData = Array.from(activityMap.values()).map(a => a.minutes);
    const dayLabels = Array.from(activityMap.values()).map(a =>
      format(a.date, viewMode === "weekly" ? "EEE" : "dd", { locale: de })
    );

    // Calculate totals
    const activeDays = dailyData.filter(m => m > 0).length;
    const totalMinutes = dailyData.reduce((sum, m) => sum + m, 0);
    const totalWorkouts = Array.from(activityMap.values()).reduce((sum, a) => sum + a.workouts, 0);

    return {
      dailyData,
      dayLabels,
      activeDays,
      totalMinutes,
      totalWorkouts,
      targetMinutes: viewMode === "weekly" ? WEEKLY_TARGET : MONTHLY_TARGET,
      isLoading: false,
    };
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['weekly-activity', user?.id, viewMode],
    queryFn: fetchActivityData,
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Default empty state
  const defaultData: WeeklyActivityData = {
    dailyData: [],
    dayLabels: [],
    activeDays: 0,
    totalMinutes: 0,
    totalWorkouts: 0,
    targetMinutes: viewMode === "weekly" ? WEEKLY_TARGET : MONTHLY_TARGET,
    isLoading: true,
  };

  return {
    ...(data || defaultData),
    isLoading, // Use query loading state
    refresh: refetch,
  };
};
