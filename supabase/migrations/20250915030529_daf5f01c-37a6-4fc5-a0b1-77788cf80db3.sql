-- Add exercise_index column to workout_logs for per-exercise tracking
ALTER TABLE public.workout_logs 
ADD COLUMN IF NOT EXISTS exercise_index INTEGER;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_workout_logs_exercise_index 
ON public.workout_logs(user_id, plan_id, workout_day, exercise_index);