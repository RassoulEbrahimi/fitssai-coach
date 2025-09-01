-- Add unique constraint to prevent duplicate workout logs
ALTER TABLE public.workout_logs 
ADD CONSTRAINT unique_user_plan_day 
UNIQUE (user_id, plan_id, workout_day);

-- Add indexes for better performance
CREATE INDEX idx_workout_logs_user_day ON public.workout_logs (user_id, workout_day);
CREATE INDEX idx_workout_logs_plan_day ON public.workout_logs (plan_id, workout_day);