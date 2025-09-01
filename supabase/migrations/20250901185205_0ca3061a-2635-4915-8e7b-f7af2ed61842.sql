-- First, remove duplicate entries, keeping only the most recent one for each (user_id, plan_id, workout_day)
DELETE FROM public.workout_logs 
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, plan_id, workout_day) id
  FROM public.workout_logs 
  ORDER BY user_id, plan_id, workout_day, created_at DESC
);

-- Now add the unique constraint
ALTER TABLE public.workout_logs 
ADD CONSTRAINT unique_user_plan_day 
UNIQUE (user_id, plan_id, workout_day);

-- Add indexes for better performance
CREATE INDEX idx_workout_logs_user_day ON public.workout_logs (user_id, workout_day);
CREATE INDEX idx_workout_logs_plan_day ON public.workout_logs (plan_id, workout_day);