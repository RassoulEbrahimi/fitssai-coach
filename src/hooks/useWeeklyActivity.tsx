import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, format } from "date-fns";
import { de } from "date-fns/locale";
import { useAuth } from "@/hooks/useAuth";

export type ViewMode = "weekly" | "monthly";

interface DayActivity { date: Date; minutes: number; workouts: number; }
interface WeeklyActivityData {
  dailyData: number[]; dayLabels: string[]; activeDays: number;
  totalMinutes: number; totalWorkouts: number; targetMinutes: number; isLoading: boolean;
}

const MINUTES_PER_EXERCISE = 10;
const WEEKLY_TARGET  = 350;
const MONTHLY_TARGET = 1500;

export const useWeeklyActivity = (viewMode: ViewMode = "weekly") => {
  const { user } = useAuth();

  const fetchActivityData = async (): Promise<WeeklyActivityData> => {
    if (!user) throw new Error("User not authenticated");

    const now = new Date();
    const startDate = viewMode === "weekly" ? startOfWeek(now, { weekStartsOn: 1 }) : startOfMonth(now);
    const endDate   = viewMode === "weekly" ? endOfWeek(now,   { weekStartsOn: 1 }) : endOfMonth(now);

    const logsRef = collection(db, "users", user.uid, "workout_logs");
    const snap = await getDocs(query(logsRef,
      where("completed",   "==", true),
      where("workoutDay",  ">=", format(startDate, "yyyy-MM-dd")),
      where("workoutDay",  "<=", format(endDate,   "yyyy-MM-dd")),
    ));

    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const activityMap = new Map<string, DayActivity>();
    days.forEach(day => activityMap.set(format(day, "yyyy-MM-dd"), { date: day, minutes: 0, workouts: 0 }));

    snap.docs.forEach(d => {
      const dateKey = d.data().workoutDay as string;
      const a = activityMap.get(dateKey);
      if (a) { a.workouts += 1; a.minutes += MINUTES_PER_EXERCISE; }
    });

    const vals       = Array.from(activityMap.values());
    const dailyData  = vals.map(a => a.minutes);
    const dayLabels  = vals.map(a => format(a.date, viewMode === "weekly" ? "EEE" : "dd", { locale: de }));
    const activeDays    = dailyData.filter(m => m > 0).length;
    const totalMinutes  = dailyData.reduce((s, m) => s + m, 0);
    const totalWorkouts = vals.reduce((s, a) => s + a.workouts, 0);

    return { dailyData, dayLabels, activeDays, totalMinutes, totalWorkouts,
      targetMinutes: viewMode === "weekly" ? WEEKLY_TARGET : MONTHLY_TARGET, isLoading: false };
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["weekly-activity", user?.id, viewMode],
    queryFn: fetchActivityData,
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  const defaultData: WeeklyActivityData = {
    dailyData: [], dayLabels: [], activeDays: 0, totalMinutes: 0, totalWorkouts: 0,
    targetMinutes: viewMode === "weekly" ? WEEKLY_TARGET : MONTHLY_TARGET, isLoading: true,
  };

  return { ...(data || defaultData), isLoading, refresh: refetch };
};
