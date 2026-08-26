// src/components/workout/DayAccordion.tsx
import React, { useRef, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, ChevronRight, Plus, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { isElementVisible } from "@/lib/workout/viewHelpers";
import { formatDateForDisplay } from "@/lib/dateUtils";

// Imports for children
import ExerciseListSkeleton from "@/components/skeletons/ExerciseListSkeleton";
// Lazy import for ExerciseList to avoid circular deps if any, 
// but since we are refactoring, we can likely import directly or pass as prop if needed.
// However, the original file used React.lazy. Let's keep consistency or allow passing the component.
// For now, let's assume we can receive the list component or just use a standard one.
// Since ExerciseList is complex (handles both inline edit and read only), let's import it.
import ExerciseList from "@/views/ExerciseList";
import type { Exercise } from "@/hooks/useExerciseEditor";

interface DayData {
    exercises: any[]; // Using any[] to match specific Exercise types if strictly defined elsewhere
    isAIGenerated?: boolean;
}

interface DayAccordionProps {
    wk: string;
    currentWeekNum: number;
    weekProgress: { completed: number; total: number };
    weekData: Record<number, DayData>;
    expandedDay: number;

    // Helpers
    getDateFor: (weekKey: string, dayIndex: number) => Date | null;
    isDayCompleted: (weekKey: string, dayIndex: number) => boolean;
    isDayInFuture: (weekKey: string, dayIndex: number) => boolean;
    isTodayInWeekDay: (weekKey: string, dayIndex: number) => boolean;

    // Actions
    onDayExpand: (dayIndex: number) => void;
    onOpenAddExercise: (weekKey: string, dayIndex: number) => void;
    onAutoFill: (weekKey: string, dayIndex: number) => void;

    // Exercise Handlers (passed down to ExerciseList)
    onUpdateExercise: (dayIndex: number, exerciseIndex: number, updatedExercise: Exercise) => Promise<void>;
    onDeleteExercise: (dayIndex: number, exerciseIndex: number) => void;
    isUpdating: boolean;
}

export const DayAccordion: React.FC<DayAccordionProps> = ({
    wk,
    currentWeekNum,
    weekProgress,
    weekData,
    expandedDay,
    getDateFor,
    isDayCompleted,
    isDayInFuture,
    isTodayInWeekDay,
    onDayExpand,
    onOpenAddExercise,
    onAutoFill,
    onUpdateExercise,
    onDeleteExercise,
    isUpdating,
}) => {
    const { t } = useTranslation();
    const dayRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

    const days = useMemo(() => Array.from({ length: 7 }, (_, i) => i), []);

    return (
        <Card className="border-border" id="weekCard">
            <CardHeader className="px-4 py-2">
                <div className="flex items-baseline justify-between gap-2">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                        {t('workout.week', { num: currentWeekNum })}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground tabular-nums shrink-0">
                        {weekProgress.completed} / {weekProgress.total} Tage abgeschlossen
                    </p>
                </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
                {days.map((dayIndex) => {
                    const day = weekData[dayIndex] || null;
                    const date = getDateFor(wk, dayIndex);
                    const dayName = date ? formatDateForDisplay(date, 'EEEE') : `Tag ${dayIndex + 1}`;
                    const isCompleted = isDayCompleted(wk, dayIndex);
                    const isFutureDay = isDayInFuture(wk, dayIndex);
                    const isExpanded = expandedDay === dayIndex;
                    const isToday = isTodayInWeekDay(wk, dayIndex);
                    const exercises: Exercise[] = day?.exercises || [];
                    const isRestDay = !exercises.length;

                    return (
                        <motion.div
                            key={dayIndex}
                            ref={el => dayRefs.current[dayIndex] = el}
                            className="relative border rounded-lg shadow-sm mb-2 last:mb-0"
                            initial={false}
                        >
                            <Collapsible
                                open={isExpanded}
                                onOpenChange={(open) => {
                                    if (open) {
                                        onDayExpand(dayIndex);
                                        // Scroll logic handled by parent via ref usually, but we can do it here if we pass the ref handling
                                        // or just minimal local scroll. The parent WorkoutView handled it, let's keep it robust.
                                        // We'll execute the scroll here since we have the ref.
                                        setTimeout(() => {
                                            const dayElement = dayRefs.current[dayIndex];
                                            if (dayElement && !isElementVisible(dayElement)) {
                                                dayElement.scrollIntoView({
                                                    behavior: 'smooth',
                                                    block: 'nearest'
                                                });
                                            }
                                        }, 0);
                                    }
                                }}
                            >
                                <CollapsibleTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className="w-full px-3 py-2 h-14 justify-between text-left hover:bg-muted/50 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                                        aria-expanded={isExpanded}
                                        aria-label={`${dayName}${isToday ? ' - Heute' : ''}${isRestDay ? ' - Ruhetag' : ` - ${exercises.length} Übungen`}${isCompleted ? ' - abgeschlossen' : ''}`}
                                    >
                                        <div className="flex items-center justify-between w-full">
                                            <div className="flex items-center gap-2">
                                                <div className="font-medium">{dayName}</div>
                                                {isToday && <Badge variant="secondary" className="text-xs px-2 py-0.5 h-5">
                                                    Heute
                                                </Badge>}
                                            </div>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-sm text-muted-foreground">
                                                    {isRestDay ? 'Ruhetag — kein Training geplant' : `${exercises.length} Übungen`}
                                                </span>
                                                {!isRestDay && isCompleted && <div className="w-4 h-4 rounded-full bg-green-600 flex-shrink-0" style={{ alignSelf: 'center' }} aria-label="Tag abgeschlossen"></div>}
                                                {isRestDay && <div className="w-4 h-4 rounded-full bg-muted-foreground/30 flex-shrink-0" style={{ alignSelf: 'center' }} aria-label="Ruhetag"></div>}
                                                {isExpanded
                                                    ? <ChevronUp className="h-4 w-4 text-muted-foreground" style={{ alignSelf: 'center' }} />
                                                    : <ChevronRight className="h-4 w-4 text-muted-foreground" style={{ alignSelf: 'center' }} />
                                                }
                                            </div>
                                        </div>
                                    </Button>
                                </CollapsibleTrigger>

                                <CollapsibleContent>
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: "auto" }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.15, ease: "easeOut" }}
                                                className="border-t bg-muted/20"
                                            >
                                                {!isRestDay && (
                                                    <div className="px-3 py-1.5 border-b border-border/50">
                                                        <div className="grid grid-cols-[1fr_48px_64px] gap-2 text-xs text-muted-foreground font-medium items-baseline">
                                                            <span>Übung</span>
                                                            <span className="text-center tabular-nums">Sätze</span>
                                                            <span className="text-right tabular-nums">Reps</span>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="relative p-2.5 pt-1.5 px-[8px] py-[7px]">
                                                    {isRestDay ? (
                                                        <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                                                            <div className="text-sm text-muted-foreground">
                                                                {t('workout.rest.note')}
                                                            </div>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => onOpenAddExercise(wk, dayIndex)}
                                                                className="h-8 w-8 shrink-0"
                                                                aria-label="Übung hinzufügen"
                                                            >
                                                                <Plus className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <React.Suspense fallback={<ExerciseListSkeleton />}>
                                                            <ExerciseList
                                                                exercises={exercises}
                                                                onUpdateExercise={(exerciseIndex: number, updatedExercise: Exercise) =>
                                                                    onUpdateExercise(dayIndex, exerciseIndex, updatedExercise)
                                                                }
                                                                onDeleteExercise={(exerciseIndex: number) =>
                                                                    onDeleteExercise(dayIndex, exerciseIndex)
                                                                }
                                                                isUpdating={isUpdating}
                                                            />
                                                        </React.Suspense>
                                                    )}

                                                    {!isRestDay && (
                                                        /*
                                                          In-flow actions. These replace a floating SpeedDial that
                                                          overlaid the day's content and whose 28px buttons were well
                                                          under the 44px target floor.
                                                        */
                                                        <div className="mt-3 flex flex-wrap gap-2">
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                className="min-h-[44px] flex-1 gap-2"
                                                                onClick={() => onOpenAddExercise(wk, dayIndex)}
                                                            >
                                                                <Plus className="h-4 w-4" aria-hidden="true" />
                                                                Übung hinzufügen
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                className="min-h-[44px] flex-1 gap-2"
                                                                onClick={() => onAutoFill(wk, dayIndex)}
                                                            >
                                                                <Sparkles className="h-4 w-4" aria-hidden="true" />
                                                                Automatisch ausfüllen
                                                            </Button>
                                                        </div>
                                                    )}

                                                    {!isRestDay && !isFutureDay && <div className="mt-2 pt-1.5 border-t border-border/50" />}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </CollapsibleContent>
                            </Collapsible>
                        </motion.div>
                    );
                })}
            </CardContent>
        </Card>
    );
};
