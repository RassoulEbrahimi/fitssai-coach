-- Update workout_logs table structure to match requirements
ALTER TABLE public.workout_logs DROP COLUMN plan_day;
ALTER TABLE public.workout_logs ADD COLUMN plan_id uuid REFERENCES public.workout_plans(id);
ALTER TABLE public.workout_logs ADD COLUMN workout_day date NOT NULL;
ALTER TABLE public.workout_logs ADD COLUMN completed boolean NOT NULL DEFAULT false;

-- Update the existing records to have the new structure
UPDATE public.workout_logs SET completed = true WHERE completed_at IS NOT NULL;