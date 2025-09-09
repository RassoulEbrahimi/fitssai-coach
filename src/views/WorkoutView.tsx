import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Dumbbell, 
  Target,
  Check,
  CheckCircle,
  Lock
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { formatDateForDisplay } from "@/lib/dateUtils";

interface WorkoutViewProps {
  workoutPlan: any;
  workoutLogs: any[];
  completingWorkout: number | null;
  activeWeek: string | null;
  currentWeekProgress: { completed: number; total: number };
  activeDays: Set<string>;
  
  // Helper functions
  getTodayWorkout: () => any;
  findNextWorkoutInCurrentWeek: () => any;
  findNextWorkoutAcrossWeeks: () => any;
  isDayCompleted: (weekKey: string, dayIndex: number) => boolean;
  isDayInFuture: (weekKey: string, dayIndex: number) => boolean;
  isTodayInWeekDay: (weekKey: string, dayIndex: number) => boolean;
  getDateFor: (weekKey: string, dayIndex: number) => Date | null;
  getWeekTitle: (weekKey: string) => string;
  getWeekProgress: (weekKey: string) => { completed: number; total: number };
  getWeeklyProgress: () => { completed: number; total: number };
  
  // Actions
  toggleDayComplete: (weekKey: string, dayIndex: number) => void;
  setActiveWeek: (weekKey: string | null) => void;
  setActiveDays: (days: Set<string>) => void;
  toggleDay: (dayKey: string) => void;
}

const WorkoutView: React.FC<WorkoutViewProps> = React.memo(({
  workoutPlan,
  workoutLogs,
  completingWorkout,
  activeWeek,
  currentWeekProgress,
  activeDays,
  getTodayWorkout,
  findNextWorkoutInCurrentWeek,
  findNextWorkoutAcrossWeeks,
  isDayCompleted,
  isDayInFuture,
  isTodayInWeekDay,
  getDateFor,
  getWeekTitle,
  getWeekProgress,
  getWeeklyProgress,
  toggleDayComplete,
  setActiveWeek,
  setActiveDays,
  toggleDay
}) => {
  const { t } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      whileHover={{ scale: 1.01, boxShadow: "0 10px 25px -3px rgba(0, 0, 0, 0.1)" }}
    >
      <Card className="gradient-card border-primary/20 hover-scale">
        <CardHeader>
          <CardTitle className="flex items-center gap-2" role="heading" aria-level={2}>
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
                                Nächstes Training: {(() => {
                                  const dtNext = getDateFor(nextWorkout.weekKey, nextWorkout.dayIndex);
                                  return dtNext ? formatDateForDisplay(dtNext, 'EEEE') : '';
                                })()}
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
                            <span>{(() => {
                              const dtToday = getDateFor(todayWorkout.weekKey, todayWorkout.dayIndex);
                              return dtToday ? formatDateForDisplay(dtToday, 'EEEE') : '';
                            })()}</span>
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
                        {(Array.isArray(days) ? days : []).map((day: any, dayIndex: number) => {
                          const isCurrentDay = isTodayInWeekDay(weekKey, dayIndex);
                          const isCompleted = isDayCompleted(weekKey, dayIndex);
                          const dayKey = `${weekKey}-${dayIndex}`;
                          
                          return (
                            <AccordionItem 
                              key={dayIndex} 
                              value={dayKey}
                              className={`border rounded-lg ${
                                isCurrentDay ? 'border-primary/50 bg-primary/5' : 'border-border'
                              } ${isCompleted ? 'opacity-60' : ''}`}
                            >
                              <AccordionTrigger 
                                className="px-4 py-3 hover:no-underline"
                                onClick={() => toggleDay(dayKey)}
                              >
                                <div className="flex items-center justify-between w-full mr-4">
                                  <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2">
                                      <h4 className={`font-medium ${isCurrentDay ? 'text-primary' : ''}`}>
                                        {(() => {
                                          const date = getDateFor(weekKey, dayIndex);
                                          return date ? formatDateForDisplay(date, 'EEEE') : `Tag ${dayIndex + 1}`;
                                        })()}
                                      </h4>
                                      {isCurrentDay && (
                                        <Badge variant="default" className="text-xs gradient-primary">
                                          Heute
                                        </Badge>
                                      )}
                                    </div>
                                    {day.exercises && day.exercises.length > 0 ? (
                                      <Badge variant="outline" className="text-xs">
                                        {day.exercises.length} Übungen
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary" className="text-xs">
                                        Ruhetag
                                      </Badge>
                                    )}
                                  </div>
                                  
                                  {day.exercises && day.exercises.length > 0 && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <motion.div
                                            whileHover={{ scale: isDayInFuture(weekKey, dayIndex) ? 1 : 1.1 }}
                                            whileTap={{ scale: isDayInFuture(weekKey, dayIndex) ? 1 : 0.9 }}
                                          >
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleDayComplete(weekKey, dayIndex);
                                              }}
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
                                  )}
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
  );
});

WorkoutView.displayName = 'WorkoutView';

export default WorkoutView;