import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * One cell of the calendar strip: a real calendar date, plus whatever plan day
 * that date happens to map to. The two are kept apart on purpose — the date is
 * what the user sees, the plan day is what the content resolves against.
 */
export interface CalendarCell {
    date: Date;
    isToday: boolean;
    isCompleted: boolean;
}

interface WeekNavigationProps {
    monthYear: string;
    /** Monday…Sunday of the displayed calendar week. */
    cells: CalendarCell[];
    activeDayIndex: number;
    onPrevWeek: () => void;
    onNextWeek: () => void;
    onDayClick: (dayIndex: number) => void;
}

export const WeekNavigation: React.FC<WeekNavigationProps> = ({
    monthYear,
    cells,
    activeDayIndex,
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
                    {cells.map((cell, i) => {
                        const dayName = formatDateForDisplay(cell.date, 'E');
                        const dayNumber = formatDateForDisplay(cell.date, 'd');
                        const isActive = activeDayIndex === i;
                        const isCompleted = cell.isCompleted;
                        const isToday = cell.isToday;

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
