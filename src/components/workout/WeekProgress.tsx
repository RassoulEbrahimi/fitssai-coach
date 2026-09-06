import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import ProgressRing from "@/components/ProgressRing";
import { cn } from "@/lib/utils";

/**
 * Exercise-level progress for one plan week.
 *
 * These are counts of *exercises*, not of training days: the ring answers "how
 * much of this week's work is ticked off", which is a different question from
 * whether a day was completed — that one only the day session record answers
 * (see `shared/workoutCompletion.ts`). The labels below say "exercises" so the
 * two numbers cannot be read as the same claim.
 */
interface WeekStats {
    completed: number;
    total: number;
    missed: number;
    percent: number;
}

interface WeekProgressProps {
    currentWeekNum: number;
    focusedWeek: number;
    setFocusedWeek: (week: number) => void;
    handleWeekActivation: (week: number) => void;
    // Function to get stats for a specific week number
    getWeekStats: (weekNum: number) => WeekStats;
    // Function to get progress color class for a specific week
    getProgressColor: (percent: number, isFuture: boolean) => string;
}

export const WeekProgress: React.FC<WeekProgressProps> = ({
    currentWeekNum,
    focusedWeek,
    setFocusedWeek,
    handleWeekActivation,
    getWeekStats,
    getProgressColor,
}) => {
    const { t } = useTranslation();

    const handleStepperKeyDown = (e: React.KeyboardEvent, weekNum: number) => {
        // Dynamic weeks array based on current week to allow navigation
        const maxWeek = Math.max(4, weekNum + 1);
        const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
        const currentIndex = weeks.indexOf(weekNum);
        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                if (currentIndex > 0) {
                    setFocusedWeek(weeks[currentIndex - 1]);
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (currentIndex < weeks.length - 1) {
                    setFocusedWeek(weeks[currentIndex + 1]);
                }
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                handleWeekActivation(weekNum);
                break;
        }
    };

    return (
        <Card className="border-border">
            <CardHeader className="pb-4">
                <CardTitle className="text-lg">
                    {t('workout.planProgress.title')}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <TooltipProvider>
                    <div className="flex items-center justify-between">
                        {[1, 2, 3, 4].map((weekNum, index, arr) => {
                            const isActive = currentWeekNum === weekNum;
                            const isPast = currentWeekNum > weekNum;
                            const isFuture = currentWeekNum < weekNum;
                            const isFocused = focusedWeek === weekNum;

                            const stats = getWeekStats(weekNum);
                            const progressColor = getProgressColor(stats.percent, isFuture);

                            // Get aria-label with completion stats
                            const ariaLabel = `Week ${weekNum}: ${stats.completed}/${stats.total} exercises done, ${stats.percent}% complete`;

                            return (
                                <React.Fragment key={weekNum}>
                                    <div className="flex flex-col items-center gap-2">
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <motion.button
                                                    type="button"
                                                    aria-label={ariaLabel}
                                                    aria-current={isActive ? "page" : undefined}
                                                    tabIndex={isFocused ? 0 : -1}
                                                    onClick={() => handleWeekActivation(weekNum)}
                                                    onKeyDown={e => handleStepperKeyDown(e, weekNum)}
                                                    onFocus={() => setFocusedWeek(weekNum)}
                                                    whileTap={!window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { scale: 0.95 } : {}}
                                                    transition={{ duration: 0.15, ease: 'easeOut' }}
                                                    className="relative outline-none ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                                                >
                                                    <ProgressRing
                                                        size={44}
                                                        strokeWidth={4}
                                                        progress={stats.percent}
                                                        trackClassName={isFuture ? 'text-muted-foreground/15' : 'text-muted-foreground/20'}
                                                        progressClassName={progressColor}
                                                        className={isActive ? 'ring-2 ring-primary ring-offset-2' : ''}
                                                    >
                                                        <span className="text-xs font-bold tabular-nums">
                                                            {stats.total > 0 ? `${stats.percent}%` : '0%'}
                                                        </span>
                                                    </ProgressRing>
                                                </motion.button>
                                            </TooltipTrigger>
                                            <TooltipContent className="text-sm" sideOffset={5}>
                                                <div className="space-y-1">
                                                    <div className="font-semibold">Week {weekNum} Summary:</div>
                                                    <div>✅ {stats.completed} exercises completed</div>
                                                    <div>❌ {stats.missed} exercises open</div>
                                                    <div>📊 {stats.percent}% complete</div>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>

                                        <span className={cn('text-xs transition-colors duration-200', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                                            {t('workout.weekLabel', { num: weekNum })}
                                        </span>
                                    </div>

                                    {/* Connector line except after the last item */}
                                    {index < arr.length - 1 && (
                                        <div className="flex-1 flex items-center px-2" style={{ alignItems: 'center', height: '44px' }}>
                                            <div
                                                aria-hidden="true"
                                                className={cn('h-0.5 w-full rounded-full transition-colors duration-300', isPast || (isActive && index < arr.length - 1) ? 'bg-primary' : 'bg-border')}
                                                style={{ marginTop: '-22px' }}
                                            />
                                        </div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </TooltipProvider>

                {/* Screen reader navigation instructions */}
                <div className="sr-only">
                    Verwenden Sie die Pfeiltasten links und rechts, um zwischen den Wochen zu navigieren.
                    Drücken Sie Enter oder Leertaste, um eine Woche auszuwählen.
                </div>
            </CardContent>
        </Card>
    );
};
