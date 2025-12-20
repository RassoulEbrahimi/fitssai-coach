import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface WeekNavigationProps {
    wk: string;
    monthYear: string;
    activeDayIndex: number;
    getDateFor: (weekKey: string, dayIndex: number) => Date | null;
    isDayCompleted: (weekKey: string, dayIndex: number) => boolean;
    isTodayInWeekDay: (weekKey: string, dayIndex: number) => boolean;
    onPrevWeek: () => void;
    onNextWeek: () => void;
    onDayClick: (dayIndex: number) => void;
}

export const WeekNavigation: React.FC<WeekNavigationProps> = ({
    wk,
    monthYear,
    activeDayIndex,
    getDateFor,
    isDayCompleted,
    isTodayInWeekDay,
    onPrevWeek,
    onNextWeek,
    onDayClick,
}) => {
    const { t } = useTranslation();

    return (
        <Card className="border-primary/20">
            <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onPrevWeek}
                        aria-label={t('workout.calendar.prev')}
                        className="min-h-[44px] min-w-[44px] h-11 w-11 p-0 rounded-xl hover:bg-muted/80 active:bg-muted touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>

                    <h3 className="mt-0 text-lg font-semibold text-foreground">
                        {monthYear}
                    </h3>

                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onNextWeek}
                        aria-label={t('workout.calendar.next')}
                        className="min-h-[44px] min-w-[44px] h-11 w-11 p-0 rounded-xl hover:bg-muted/80 active:bg-muted touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                <div className="grid grid-cols-7 gap-3">
                    {Array.from({ length: 7 }, (_, i) => {
                        const date = getDateFor(wk, i);
                        const dayName = date ? formatDateForDisplay(date, 'E') : '';
                        const dayNumber = date ? formatDateForDisplay(date, 'd') : '';
                        const isActive = activeDayIndex === i;
                        const isCompleted = isDayCompleted(wk, i);
                        const isToday = isTodayInWeekDay(wk, i);

                        return (
                            <button
                                key={i}
                                onClick={() => onDayClick(i)}
                                className={cn(
                                    "flex min-h-[44px] min-w-[44px] h-12 w-full flex-col items-center justify-center rounded-xl text-xs transition-all duration-200 touch-manipulation active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                                    isToday ? "ring-2 ring-primary ring-offset-2" : "",
                                    isCompleted ? "bg-primary/10 text-primary" : "bg-muted/50",
                                    isActive ? "outline outline-2 outline-primary/60" : ""
                                )}
                                aria-pressed={isActive}
                                aria-label={`${dayName} ${dayNumber}${isCompleted ? ' - abgeschlossen' : ''}${isToday ? ' - heute' : ''}`}
                                type="button"
                            >
                                <span className="leading-3">{dayName}</span>
                                <span className="text-sm font-medium">{dayNumber}</span>
                            </button>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
};
