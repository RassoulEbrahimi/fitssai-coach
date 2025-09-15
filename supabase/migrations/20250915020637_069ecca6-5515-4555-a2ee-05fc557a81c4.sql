-- Add exercise_index column to workout_logs table for per-exercise tracking
ALTER TABLE public.workout_logs 
ADD COLUMN exercise_index INTEGER;

-- Create index for better performance on exercise-specific queries
CREATE INDEX idx_workout_logs_exercise ON public.workout_logs (user_id, plan_id, workout_day, exercise_index);

-- Update RLS policies to work with exercise-level tracking (existing policies already cover this)