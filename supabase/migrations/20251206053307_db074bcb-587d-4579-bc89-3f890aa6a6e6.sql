-- Create workout_set_logs table for tracking individual set completions
CREATE TABLE public.workout_set_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workout_log_id UUID REFERENCES public.workout_logs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  set_number INTEGER NOT NULL,
  reps_completed INTEGER NOT NULL,
  weight_used NUMERIC(6,2), -- e.g., 102.50 kg
  completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Prevent duplicate set entries for the same workout log
  UNIQUE (workout_log_id, set_number)
);

-- Enable Row Level Security
ALTER TABLE public.workout_set_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for workout_set_logs
CREATE POLICY "Users can view their own set logs"
  ON public.workout_set_logs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own set logs"
  ON public.workout_set_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own set logs"
  ON public.workout_set_logs
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own set logs"
  ON public.workout_set_logs
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add index for faster lookups by workout_log_id
CREATE INDEX idx_workout_set_logs_workout_log_id ON public.workout_set_logs(workout_log_id);

-- Add index for user queries
CREATE INDEX idx_workout_set_logs_user_id ON public.workout_set_logs(user_id);