import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface WorkoutContext {
  streak: number;
  lastWorkoutType: 'HighIntensity' | 'Moderate' | 'Light' | null;
  recentFocus: string[];
  recoveryDays: number;
}

export function useWorkoutContext() {
  const { user } = useAuth();

  const { data: context } = useQuery({
    queryKey: ['workout-context', user?.id],
    queryFn: async (): Promise<WorkoutContext> => {
      if (!user) {
        return { streak: 0, lastWorkoutType: null, recentFocus: [], recoveryDays: 0 };
      }

      // Fetch user's workout plan and completion data
      const { data: planData } = await supabase
        .from('workout_plans')
        .select('content, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!planData?.content) {
        return { streak: 0, lastWorkoutType: null, recentFocus: [], recoveryDays: 0 };
      }

      const content = planData.content as any;
      
      // Calculate streak (simplified: count recent completed days)
      let streak = 0;
      const today = new Date();
      const recentDays = 7;
      
      // Get all weeks
      const weeks = Object.keys(content).filter(key => key.startsWith('Week'));
      
      // Analyze recent exercises for intensity patterns
      const recentFocus: string[] = [];
      let lastWorkoutType: 'HighIntensity' | 'Moderate' | 'Light' | null = null;
      let recoveryDays = 0;
      let foundLastWorkout = false;

      // Check last few days for workout patterns
      for (const week of weeks.reverse()) {
        const weekData = content[week];
        if (!Array.isArray(weekData)) continue;

        for (let dayIdx = weekData.length - 1; dayIdx >= 0; dayIdx--) {
          const day = weekData[dayIdx];
          if (!day?.exercises?.length) {
            recoveryDays++;
            continue;
          }

          // Found last workout
          if (!foundLastWorkout) {
            foundLastWorkout = true;
            
            // Determine intensity based on exercise names and duration
            const exercises = day.exercises || [];
            const totalDuration = exercises.reduce((sum: number, ex: any) => sum + (ex.duration || 0), 0);
            const hasHighIntensity = exercises.some((ex: any) => 
              ex.name?.toLowerCase().includes('burpee') ||
              ex.name?.toLowerCase().includes('sprint') ||
              ex.name?.toLowerCase().includes('hiit')
            );

            if (hasHighIntensity || totalDuration > 60) {
              lastWorkoutType = 'HighIntensity';
            } else if (totalDuration > 30) {
              lastWorkoutType = 'Moderate';
            } else {
              lastWorkoutType = 'Light';
            }

            // Collect focus areas
            exercises.forEach((ex: any) => {
              if (ex.name) {
                const name = ex.name.toLowerCase();
                if (name.includes('push') || name.includes('chest')) recentFocus.push('Push');
                if (name.includes('pull') || name.includes('back')) recentFocus.push('Pull');
                if (name.includes('leg') || name.includes('squat')) recentFocus.push('Legs');
                if (name.includes('core') || name.includes('plank')) recentFocus.push('Core');
              }
            });
          }

          // Check for streak
          if (day.exercises?.length > 0) {
            streak++;
          } else {
            break;
          }
        }
      }

      return {
        streak: Math.min(streak, recentDays),
        lastWorkoutType,
        recentFocus: [...new Set(recentFocus)].slice(0, 3),
        recoveryDays: foundLastWorkout ? recoveryDays : 0,
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return context || { streak: 0, lastWorkoutType: null, recentFocus: [], recoveryDays: 0 };
}
