import React, { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { 
  ChevronLeft, 
  ChevronRight, 
  Check,
  CheckCircle2,
  Info
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
  activeDayIndex?: number;
  
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
  setActiveDayIndex?: (dayIndex: number) => void;
}

const WorkoutView: React.FC<WorkoutViewProps> = React.memo(({
  workoutPlan,
  workoutLogs,
  completingWorkout,
  activeWeek,
  currentWeekProgress,
  activeDayIndex = 0,
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
  setActiveDayIndex
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const dayRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  // Get current week number for stepper
  const currentWeekNum = activeWeek ? parseInt(activeWeek.replace('week', '')) : 1;
  const weekNumbers = [1, 2, 3, 4];

  // Handle week navigation
  const handlePrevWeek = () => {
    if (currentWeekNum > 1) {
      setActiveWeek(`week${currentWeekNum - 1}`);
    }
  };

  const handleNextWeek = () => {
    if (currentWeekNum < 4) {
      setActiveWeek(`week${currentWeekNum + 1}`);
    }
  };

  // Handle day click in calendar
  const handleDayClick = (dayIndex: number) => {
    setActiveDayIndex?.(dayIndex);
    setExpandedDay(dayIndex);
    
    // Smooth scroll to day in list
    setTimeout(() => {
      const dayElement = dayRefs.current[dayIndex];
      if (dayElement && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dayElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  // Handle exercise info click
  const handleExerciseInfo = () => {
    toast({
      title: t('workout.infoSoon'),
      description: "",
    });
  };

  if (!workoutPlan) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <Card className="border-primary/20">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              {t('dashboard.workoutPlan.comingSoon')}
            </p>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  const weekData = workoutPlan.content[activeWeek || 'week1'] || [];
  const weekProgress = getWeekProgress(activeWeek || 'week1');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="space-y-6"
    >
      {/* Weekly Calendar */}
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrevWeek}
              disabled={currentWeekNum === 1}
              aria-label={t('workout.calendar.prev')}
              className="h-9 w-9 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <h2 className="text-lg font-semibold text-primary">
              {t('workout.week', { num: currentWeekNum })}
            </h2>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNextWeek}
              disabled={currentWeekNum === 4}
              aria-label={t('workout.calendar.next')}
              className="h-9 w-9 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }, (_, i) => {
              const date = getDateFor(activeWeek || 'week1', i);
              const dayName = date ? formatDateForDisplay(date, 'E') : '';
              const dayNumber = date ? formatDateForDisplay(date, 'd') : '';
              const isActive = activeDayIndex === i;
              const isCompleted = isDayCompleted(activeWeek || 'week1', i);
              const isToday = isTodayInWeekDay(activeWeek || 'week1', i);
              
              return (
                <Button
                  key={i}
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  onClick={() => handleDayClick(i)}
                  className={`h-12 flex flex-col p-1 text-xs ${
                    isToday ? 'ring-2 ring-primary ring-offset-2' : ''
                  } ${isCompleted ? 'bg-green-100 dark:bg-green-900/20' : ''}`}
                  style={{ minHeight: '44px' }}
                >
                  <span className="font-medium">{dayName}</span>
                  <span className="text-xs opacity-75">{dayNumber}</span>
                  {isCompleted && (
                    <CheckCircle2 className="h-3 w-3 text-green-600 mt-1" />
                  )}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Today Card */}
      <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-bold text-primary">
            {t('workout.today')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const todayWorkout = getTodayWorkout();
            
            if (!todayWorkout || todayWorkout.__restDay) {
              const isCompleted = todayWorkout ? isDayCompleted(todayWorkout.weekKey, todayWorkout.dayIndex) : false;
              
              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-muted-foreground">{t('workout.restDay')}</h3>
                      <p className="text-sm text-muted-foreground">
                        Kein Training für heute geplant.
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="rest-day"
                        checked={isCompleted}
                        onCheckedChange={() => todayWorkout && toggleDayComplete(todayWorkout.weekKey, todayWorkout.dayIndex)}
                      />
                      <label htmlFor="rest-day" className="text-sm font-medium">
                        {t('workout.restDone')}
                      </label>
                    </div>
                  </div>
                </div>
              );
            }

            const isCompleted = isDayCompleted(todayWorkout.weekKey, todayWorkout.dayIndex);
            const exercises = todayWorkout.dayData.exercises || [];

            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-primary">
                      {t('workout.exercisesCount', { count: exercises.length })}
                    </h3>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="today-workout"
                      checked={isCompleted}
                      onCheckedChange={() => toggleDayComplete(todayWorkout.weekKey, todayWorkout.dayIndex)}
                    />
                    <label htmlFor="today-workout" className="text-sm font-medium">
                      Als erledigt markieren
                    </label>
                  </div>
                </div>
                
                <div className="space-y-2">
                  {exercises.slice(0, 3).map((exercise: any, index: number) => (
                    <div key={index} className="flex justify-between items-center text-sm bg-background/50 rounded-lg p-2">
                      <span className="font-medium">{exercise.name}</span>
                      <span className="text-muted-foreground">
                        {exercise.sets}×{exercise.reps}
                      </span>
                    </div>
                  ))}
                  {exercises.length > 3 && (
                    <div className="text-sm text-muted-foreground text-center">
                      +{exercises.length - 3} weitere Übungen
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Plan Stepper */}
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            {weekNumbers.map((weekNum, index) => {
              const weekKey = `week${weekNum}`;
              const isActive = currentWeekNum === weekNum;
              const isPast = currentWeekNum > weekNum;
              const isFuture = currentWeekNum < weekNum;
              
              return (
                <div key={weekNum} className="flex items-center">
                  <Button
                    variant={isActive ? "default" : isPast ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setActiveWeek(weekKey)}
                    className={`h-10 w-16 ${
                      isPast ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300' :
                      isFuture ? 'opacity-60' : ''
                    }`}
                    disabled={isFuture}
                  >
                    {isPast && <CheckCircle2 className="h-3 w-3 mr-1" />}
                    W{weekNum}
                  </Button>
                  
                  {index < weekNumbers.length - 1 && (
                    <div className={`h-0.5 w-8 mx-2 ${
                      isPast ? 'bg-green-300' : 'bg-border'
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Week Section */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              {t('workout.week', { num: currentWeekNum })}
            </CardTitle>
            <span className="text-sm text-muted-foreground">
              {t('workout.thisWeekProgress', { done: weekProgress.completed, total: weekProgress.total })}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {weekData.map((day: any, dayIndex: number) => {
            const date = getDateFor(activeWeek || 'week1', dayIndex);
            const dayName = date ? formatDateForDisplay(date, 'EEEE') : `Tag ${dayIndex + 1}`;
            const isCompleted = isDayCompleted(activeWeek || 'week1', dayIndex);
            const isExpanded = expandedDay === dayIndex;
            const exercises = day?.exercises || [];
            const isRestDay = !exercises.length;
            
            return (
              <motion.div
                key={dayIndex}
                ref={(el) => (dayRefs.current[dayIndex] = el)}
                className={`border rounded-lg ${
                  activeDayIndex === dayIndex ? 'border-primary/50 bg-primary/5' : 'border-border'
                }`}
                initial={false}
              >
                <Collapsible open={isExpanded} onOpenChange={(open) => {
                  setExpandedDay(open ? dayIndex : null);
                  if (open) setActiveDayIndex?.(dayIndex);
                }}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full p-4 h-auto justify-between text-left"
                      style={{ minHeight: '44px' }}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{dayName}</span>
                          <span className="text-sm text-muted-foreground">
                            {isRestDay ? t('workout.restDay') : t('workout.exercisesCount', { count: exercises.length })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={isCompleted}
                            onCheckedChange={(checked) => {
                              toggleDayComplete(activeWeek || 'week1', dayIndex);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          {isCompleted && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        </div>
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent>
                    <motion.div
                      initial={!window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { height: 0, opacity: 0 } : {}}
                      animate={!window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { height: 'auto', opacity: 1 } : {}}
                      transition={{ duration: 0.3 }}
                      className="px-4 pb-4"
                    >
                      {exercises.length > 0 ? (
                        <div className="space-y-2">
                          {exercises.map((exercise: any, exerciseIndex: number) => (
                            <div key={exerciseIndex} className="flex items-center justify-between bg-background/50 rounded-lg p-3">
                              <div>
                                <span className="font-medium text-sm">{exercise.name}</span>
                                <div className="text-xs text-muted-foreground">
                                  {exercise.sets} Sätze × {exercise.reps} Wiederholungen
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleExerciseInfo}
                                aria-label={t('workout.infoSoon')}
                                className="h-8 w-8 p-0"
                              >
                                <Info className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-4">
                          <p className="text-sm text-muted-foreground">
                            {t('workout.restDay')} - Erholung ist wichtig für deine Fortschritte.
                          </p>
                        </div>
                      )}
                    </motion.div>
                  </CollapsibleContent>
                </Collapsible>
              </motion.div>
            );
          })}
        </CardContent>
      </Card>
    </motion.div>
  );
});

WorkoutView.displayName = 'WorkoutView';

export default WorkoutView;