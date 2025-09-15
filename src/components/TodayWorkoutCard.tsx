import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dumbbell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface Exercise {
  id: string;
  name: string;
  sets: string;
  reps: string;
  weight?: string;
  rest?: string;
  completed: boolean;
}

interface TodayWorkoutData {
  weekday: string;
  fullDate: string;
  exercises: Exercise[];
  isRestDay: boolean;
  isToday: boolean;
  planId?: string;
  message?: string;
}

interface TodayWorkoutCardProps {
  selectedDate: Date;
  onProgressUpdate?: (progress: { completed: number; total: number }) => void;
}

const TodayWorkoutCard: React.FC<TodayWorkoutCardProps> = ({ 
  selectedDate, 
  onProgressUpdate 
}) => {
  const { t } = useTranslation();
  const [workoutData, setWorkoutData] = useState<TodayWorkoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  // Format date as YYYY-MM-DD
  const formatDateForAPI = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  // Fetch today's workout data
  const fetchTodayWorkout = async () => {
    try {
      setLoading(true);
      const targetDate = formatDateForAPI(selectedDate);
      
      const { data, error } = await supabase.functions.invoke('get-today-workout', {
        body: { date: targetDate }
      });

      if (error) {
        console.error('Error fetching today workout:', error);
        toast.error(t('workout.error.loadFailed') || 'Fehler beim Laden des Trainings');
        return;
      }

      if (data.success) {
        setWorkoutData(data);
      } else {
        console.error('Server error:', data.error);
        toast.error(data.error || 'Fehler beim Laden des Trainings');
      }
    } catch (error) {
      console.error('Network error:', error);
      toast.error('Netzwerkfehler beim Laden des Trainings');
    } finally {
      setLoading(false);
    }
  };

  // Toggle exercise completion
  const toggleExercise = async (exerciseId: string, exerciseIndex: number, completed: boolean) => {
    if (!workoutData?.planId) return;

    setToggling(exerciseId);
    
    try {
      const { data, error } = await supabase.functions.invoke('toggle-exercise', {
        body: {
          planId: workoutData.planId,
          workoutDay: formatDateForAPI(selectedDate),
          exerciseIndex,
          completed
        }
      });

      if (error) {
        console.error('Error toggling exercise:', error);
        toast.error(t('workout.error.updateFailed') || 'Fehler beim Aktualisieren');
        return;
      }

      if (data.success) {
        // Update local state optimistically
        setWorkoutData(prev => {
          if (!prev) return prev;
          
          const updatedExercises = prev.exercises.map(exercise => 
            exercise.id === exerciseId 
              ? { ...exercise, completed }
              : exercise
          );
          
          return { ...prev, exercises: updatedExercises };
        });

        // Update weekly progress
        if (onProgressUpdate && data.weeklyProgress) {
          onProgressUpdate(data.weeklyProgress);
        }

        toast.success(
          completed 
            ? (t('workout.exerciseCompleted') || 'Übung abgeschlossen')
            : (t('workout.exerciseUncompleted') || 'Übung zurückgesetzt')
        );
      } else {
        toast.error(data.error || 'Fehler beim Aktualisieren');
      }
    } catch (error) {
      console.error('Network error:', error);
      toast.error('Netzwerkfehler beim Aktualisieren');
    } finally {
      setToggling(null);
    }
  };

  // Fetch data when selectedDate changes
  useEffect(() => {
    fetchTodayWorkout();
  }, [selectedDate]);

  if (loading) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-primary" />
            {t('workout.today')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="h-4 bg-muted animate-pulse rounded"></div>
            <div className="h-4 bg-muted animate-pulse rounded w-3/4"></div>
            <div className="h-4 bg-muted animate-pulse rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!workoutData) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-primary" />
            {t('workout.today')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {t('workout.error.noData') || 'Keine Trainingsdaten verfügbar'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-primary" />
            {t('workout.today')}
          </CardTitle>
          {workoutData.isToday && (
            <Badge variant="secondary" className="text-xs">
              {t('dashboard.workoutCompletion.today') || 'Heute'}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {workoutData.fullDate}
        </p>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {workoutData.isRestDay ? (
          <div className="text-center py-4">
            <p className="text-muted-foreground">
              {workoutData.message || t('workout.restDayDescription')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {workoutData.exercises.map((exercise, index) => (
              <div 
                key={exercise.id}
                className="flex items-center justify-between p-3 bg-background/50 rounded-lg border border-border/50"
              >
                <div className="flex items-center gap-3 flex-1">
                  <Checkbox
                    id={exercise.id}
                    checked={exercise.completed}
                    disabled={toggling === exercise.id}
                    onCheckedChange={(checked) => {
                      toggleExercise(exercise.id, index, !!checked);
                    }}
                  />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span 
                        className={`font-medium text-sm ${
                          exercise.completed 
                            ? 'line-through text-muted-foreground' 
                            : 'text-foreground'
                        }`}
                      >
                        {exercise.name}
                      </span>
                      
                      <div className="text-right">
                        <span 
                          className={`text-sm font-mono ${
                            exercise.completed 
                              ? 'text-muted-foreground' 
                              : 'text-muted-foreground'
                          }`}
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {exercise.sets} × {exercise.reps}
                        </span>
                      </div>
                    </div>
                    
                    {exercise.weight && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {exercise.weight}
                        {exercise.rest && ` • ${exercise.rest} Pause`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {workoutData.exercises.length === 0 && (
              <div className="text-center py-2">
                <p className="text-muted-foreground text-sm">
                  {t('workout.noExercises') || 'Keine Übungen für diesen Tag'}
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TodayWorkoutCard;