-- Remove the incorrect unique constraint that prevents multiple exercises per day
ALTER TABLE public.workout_logs DROP CONSTRAINT IF EXISTS unique_user_plan_day;

-- The correct constraint (user_id, plan_id, week_key, day_index, exercise_index) already exists
-- This allows multiple exercises per day while preventing duplicate exercise completions