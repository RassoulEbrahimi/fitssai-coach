import { differenceInCalendarDays, isSameWeek, subWeeks } from "date-fns";
import { Insight, InsightType, InsightPriority } from "./types";
import { Profile } from "@/hooks/queries/useProfile";

/**
 * Only what the rules below actually read. Narrowed from the full hook shape so
 * the engine does not break every time an unused field is reshaped — it used to
 * require `totalMinutes`, which no rule consulted and which no longer exists
 * now that minutes are measured rather than estimated.
 */
interface WeeklyActivityData {
    activeDays: number;
}

// Simple deterministic ID generation
const generateId = (type: InsightType, value: any) => `${type}-${value}`;

export const generateInsights = (
    weeklyActivity: WeeklyActivityData | undefined,
    profile: Profile | undefined | null,
    totalWorkoutsAllTime: number,
    lastWorkoutDateStr: string | null // YYYY-MM-DD
): Insight | null => {

    const insights: Insight[] = [];
    const now = new Date();

    // 1. MILESTONE CHECK (High Priority)
    // We check if the total workouts is a round number or significant milestone.
    // For MVP, we assume if they are exactly at a milestone, we show it.
    // In a real app, we'd check if they *just* crossed it. 
    // Here we can simply check if totalWorkouts equals a milestone.
    const milestones = [1, 5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 1000];
    if (milestones.includes(totalWorkoutsAllTime)) {
        insights.push({
            id: generateId('milestone', totalWorkoutsAllTime),
            type: 'milestone',
            priority: 'high',
            title: 'Meilenstein erreicht! 🏆',
            message: `Wahnsinn! Du hast insgesamt ${totalWorkoutsAllTime} Trainings absolviert. Keep going!`,
            icon: 'Trophy',
            actionLabel: 'Feiern',
            actionType: 'dismiss',
            payload: { milestone: totalWorkoutsAllTime }
        });
    }

    // 2. MISSED WORKOUT CHECK (High Priority)
    // Use lastWorkoutDateStr. If > 3 days ago, show warning.
    if (lastWorkoutDateStr) {
        const lastWorkoutDate = new Date(lastWorkoutDateStr);
        const daysSinceLast = differenceInCalendarDays(now, lastWorkoutDate);

        if (daysSinceLast > 3 && daysSinceLast < 14) { // Only show if recent enough to care, but urgent
            insights.push({
                id: generateId('missed', daysSinceLast),
                type: 'missed',
                priority: 'high',
                title: 'Vermisst dich... 👀',
                message: `Dein letztes Training war vor ${daysSinceLast} Tagen. Zeit für ein Comeback?`,
                icon: 'Clock',
                actionLabel: 'Training starten',
                actionType: 'navigate',
                actionTarget: 'workout',
                payload: { daysSinceLast }
            });
        }
    } else if (totalWorkoutsAllTime === 0 && profile?.created_at) {
        // If user created account > 2 days ago and 0 workouts
        const daysSinceJoined = differenceInCalendarDays(now, new Date(profile.created_at));
        if (daysSinceJoined > 2) {
            insights.push({
                id: generateId('missed', 'start'),
                type: 'missed',
                priority: 'high',
                title: 'Der erste Schritt 🚀',
                message: 'Aller Anfang ist schwer. Starte heute dein erstes 10-Minuten Training!',
                icon: 'Flame',
                actionLabel: 'Los geht\'s',
                actionType: 'navigate',
                actionTarget: 'workout',
                payload: { daysSinceJoined }
            });
        }
    }


    // 3. STREAK CHECK (Medium Priority)
    // Based on weeklyActivity.activeDays.
    // If > 2 days this week, basic positive reinforcement.
    // Real "Streak" calculation needs historical data (consecutive weeks). 
    // For this MVP, we use "Weekly Consistency" as a proxy for streak if we strictly follow "No blocking renders / No additional data fetching".
    // HOWEVER, if we want a *real* multi-week streak, we need historical logs. 
    // The prompt says "Use existing data only". 
    // We only have `WeeklyActivity` (current week) readily available in `useWeeklyActivity` (unless we change view mode).
    // So we will focus on "Weekly Streak" (days per week) for now.

    if (weeklyActivity && weeklyActivity.activeDays >= 3) {
        insights.push({
            id: generateId('streak', weeklyActivity.activeDays),
            type: 'streak',
            priority: 'medium',
            title: 'Du bist on fire! 🔥',
            message: `Schon ${weeklyActivity.activeDays} Trainingstage diese Woche. Starke Leistung!`,
            icon: 'Flame',
            payload: { activeDays: weeklyActivity.activeDays }
        });
    }


    // 4. CONSISTENCY CHECK (Low Priority)
    // If mid-week and low activity.
    if (weeklyActivity) {
        const dayOfWeek = now.getDay(); // 0-6 (Sun-Sat)
        // Check mid-week (Wed/Thu)
        if ((dayOfWeek === 3 || dayOfWeek === 4) && weeklyActivity.activeDays === 0) {
            insights.push({
                id: generateId('consistency', 'midweek-check'),
                type: 'consistency',
                priority: 'low',
                title: 'Wochenmitte Check',
                message: 'Die Hälfte der Woche ist fast rum. Perfekter Zeitpunkt für ein kurzes Workout!',
                icon: 'Calendar',
                actionLabel: 'Plan ansehen',
                actionType: 'navigate',
                actionTarget: 'workout',
                payload: { type: 'midweek-check', dayOfWeek, activeDays: 0 }
            });
        }
    }

    // PRIORITIZATION LOGIC (Max 1)
    // Order: High > Medium > Low
    // If multiple High, pick Milestone over Missed.

    const priorityMap: Record<InsightPriority, number> = {
        high: 3,
        medium: 2,
        low: 1
    };

    insights.sort((a, b) => {
        const diff = priorityMap[b.priority] - priorityMap[a.priority];
        if (diff !== 0) return diff;
        // Tie-breaker: Milestone > Missed
        if (a.type === 'milestone') return -1;
        if (b.type === 'milestone') return 1;
        return 0;
    });

    return insights.length > 0 ? insights[0] : null;
};
