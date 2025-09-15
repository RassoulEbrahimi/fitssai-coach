import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { toZonedTime } from "date-fns-tz";

interface TodayWorkout {
  date: string;
  weekday: string;
  formattedDate: string;
  isRestDay: boolean;
  exercises: Array<{
    id: string;
    name: string;
    sets: number;
    reps: number;
    completed: boolean;
  }>;
  dayCompleted: boolean;
  weeklyProgress: {
    completed: number;
    total: number;
  };
}

interface TodayWorkoutCardProps {
  selectedDate: Date;
  onProgressUpdate?: (weeklyProgress: { completed: number; total: number }) => void;
}

const TodayWorkoutCard: React.FC<TodayWorkoutCardProps> = ({ 
  selectedDate, 
  onProgressUpdate 
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [workout, setWorkout] = useState<TodayWorkout | null>(null);
  const [loading, setLoading] = useState(true);
  const [optimisticUpdates, setOptimisticUpdates] = useState<Set<string>>(new Set());

  // Format the selected date for Europe/Berlin timezone
  const formatSelectedDate = (date: Date): string => {
    const berlinTime = toZonedTime(date, 'Europe/Berlin');
    return format(berlinTime, 'yyyy-MM-dd');
  };

  // Load today's workout from server
  const loadTodayWorkout = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const targetDate = formatSelectedDate(selectedDate);
      
      const { data, error } = await supabase.functions.invoke('get-today-workout', {
        body: { targetDate }
      });

      if (error) throw error;

      if (data?.success) {
        setWorkout(data.workout);
        
        // Update parent component with weekly progress
        if (onProgressUpdate && data.workout?.weeklyProgress) {
          onProgressUpdate(data.workout.weeklyProgress);
        }
      } else {
        console.error('Failed to load workout:', data?.error);
        toast.error(t('todayWorkout.loadError'));
      }
    } catch (error) {
      console.error('Error loading today workout:', error);
      toast.error(t('todayWorkout.loadError'));
    } finally {
      setLoading(false);
    }
  };

  // Toggle exercise completion with optimistic UI
  const toggleExercise = async (exerciseIndex: number) => {
    if (!workout || !user) return;

    const exerciseId = `${workout.date}-${exerciseIndex}`;
    const currentExercise = workout.exercises[exerciseIndex];
    const newCompleted = !currentExercise.completed;

    // Optimistic update
    setOptimisticUpdates(prev => new Set(prev).add(exerciseId));
    
    setWorkout(prev => {
      if (!prev) return prev;
      const newExercises = [...prev.exercises];
      newExercises[exerciseIndex] = { ...newExercises[exerciseIndex], completed: newCompleted };
      
      // Calculate if day is completed (all exercises checked)
      const dayCompleted = newExercises.every(ex => ex.completed);
      
      return {
        ...prev,
        exercises: newExercises,
        dayCompleted
      };
    });

    try {
      const { data, error } = await supabase.functions.invoke('toggle-exercise', {
        body: {
          planId: workout.exercises[0]?.id.split('-')[0], // Extract plan ID
          workoutDay: workout.date,
          exerciseIndex,
          completed: newCompleted
        }
      });

      if (error) throw error;

      if (data?.success) {
        // Update with server response
        setWorkout(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            weeklyProgress: data.weeklyProgress || prev.weeklyProgress
          };
        });

        // Update parent component
        if (onProgressUpdate && data.weeklyProgress) {
          onProgressUpdate(data.weeklyProgress);
        }

        toast.success(data.message || (newCompleted ? t('todayWorkout.exerciseCompleted') : t('todayWorkout.exerciseUncompleted')));
      } else {
        throw new Error(data?.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error toggling exercise:', error);
      
      // Rollback optimistic update
      setWorkout(prev => {
        if (!prev) return prev;
        const rolledBackExercises = [...prev.exercises];
        rolledBackExercises[exerciseIndex] = { ...rolledBackExercises[exerciseIndex], completed: !newCompleted };
        
        return {
          ...prev,
          exercises: rolledBackExercises,
          dayCompleted: rolledBackExercises.every(ex => ex.completed)
        };
      });

      toast.error(t('todayWorkout.toggleError'));
    } finally {
      setOptimisticUpdates(prev => {
        const updated = new Set(prev);
        updated.delete(exerciseId);
        return updated;
      });
    }
  };

  // Load workout when date changes
  useEffect(() => {
    loadTodayWorkout();
  }, [selectedDate, user]);

  if (loading) {
    return (
      <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-bold text-primary">
            <Skeleton className="h-6 w-40" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!workout) {
    return (
      <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-bold text-primary">
            {t('todayWorkout.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t('todayWorkout.noData')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-bold text-primary">
            {t('todayWorkout.title')} — {workout.weekday} {workout.formattedDate}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {workout.isRestDay ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground">
                {t('todayWorkout.restDay')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {workout.exercises.map((exercise, index) => {
                const exerciseId = `${workout.date}-${index}`;
                const isUpdating = optimisticUpdates.has(exerciseId);
                
                return (
                  <motion.div
                    key={index}
                    className="flex items-center gap-3 p-3 bg-background/50 rounded-lg"
                    whileHover={{ scale: 1.01 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Checkbox
                      id={`exercise-${index}`}
                      checked={exercise.completed}
                      disabled={isUpdating}
                      onCheckedChange={() => toggleExercise(index)}
                      aria-label={t('todayWorkout.toggleExercise', { name: exercise.name })}
                      className="h-5 w-5"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-foreground truncate">
                        {exercise.name}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {exercise.sets} × {exercise.reps}
                      </p>
                    </div>
                    {isUpdating && (
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    )}
                  </motion.div>
                );
              })}
              
              {workout.exercises.length === 0 && (
                <p className="text-center text-muted-foreground py-4">
                  {t('todayWorkout.noExercises')}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default TodayWorkoutCard;