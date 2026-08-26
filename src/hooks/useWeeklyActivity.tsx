import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, format } from "date-fns";
import { de } from "date-fns/locale";
import { useAuth } from "@/hooks/useAuth";
import { readDurationSec } from "@/lib/workoutLog";

export type ViewMode = "weekly" | "monthly";

interface DayActivity { date: Date; minutes: number; workouts: number; measured: number; unmeasured: number; }

export interface WeeklyActivityData {
  /** Measured minutes per day. 0 means "nothing measured", not "no effort". */
  dailyData: number[];
  dayLabels: string[];
  activeDays: number;
  /** Minutes actually measured from session durations. Never an estimate. */
  measuredMinutes: number;
  /** Completed days whose session length was recorded. */
  measuredWorkouts: number;
  /**
   * Completed days with no recorded length — every workout logged before PR47.
   * Non-zero means `measuredMinutes` is a floor, not the period's total.
   */
  unmeasuredWorkouts: number;
  totalWorkouts: number;
  targetMinutes: number;
  isLoading: boolean;
}

/*
  There used to be a `MINUTES_PER_EXERCISE = 10` here, added once per log to
  produce a minutes figure. That was a constant presented as measurement: a
  10-minute mobility day and a 90-minute session both scored the same. Session
  duration is now measured for real (see lib/sessionRecord), so this reports
  only what was measured and says how much it could not account for.
*/
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
    days.forEach(day =>
      activityMap.set(format(day, "yyyy-MM-dd"), { date: day, minutes: 0, workouts: 0, measured: 0, unmeasured: 0 })
    );

    snap.docs.forEach(d => {
      const data = d.data();
      const a = activityMap.get(data.workoutDay as string);
      if (!a) return;
      a.workouts += 1;

      const seconds = readDurationSec(data.durationSec);
      if (seconds === null) {
        // Pre-PR47 document: the day happened, its length was never recorded.
        a.unmeasured += 1;
        return;
      }
      a.minutes += Math.round(seconds / 60);
      a.measured += 1;
    });

    const vals       = Array.from(activityMap.values());
    const dailyData  = vals.map(a => a.minutes);
    const dayLabels  = vals.map(a => format(a.date, viewMode === "weekly" ? "EEE" : "dd", { locale: de }));
    // Activity is "a workout happened", independent of whether it was timed.
    const activeDays         = vals.filter(a => a.workouts > 0).length;
    const measuredMinutes    = dailyData.reduce((sum, m) => sum + m, 0);
    const totalWorkouts      = vals.reduce((sum, a) => sum + a.workouts, 0);
    const measuredWorkouts   = vals.reduce((sum, a) => sum + a.measured, 0);
    const unmeasuredWorkouts = vals.reduce((sum, a) => sum + a.unmeasured, 0);

    return { dailyData, dayLabels, activeDays, measuredMinutes, measuredWorkouts,
      unmeasuredWorkouts, totalWorkouts,
      targetMinutes: viewMode === "weekly" ? WEEKLY_TARGET : MONTHLY_TARGET, isLoading: false };
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["weekly-activity", user?.id, viewMode],
    queryFn: fetchActivityData,
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  const defaultData: WeeklyActivityData = {
    dailyData: [], dayLabels: [], activeDays: 0, measuredMinutes: 0, measuredWorkouts: 0,
    unmeasuredWorkouts: 0, totalWorkouts: 0,
    targetMinutes: viewMode === "weekly" ? WEEKLY_TARGET : MONTHLY_TARGET, isLoading: true,
  };

  return { ...(data || defaultData), isLoading, refresh: refetch };
};
