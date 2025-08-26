-- Create workout_logs table for tracking workout completion
CREATE TABLE public.workout_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  plan_day TEXT NOT NULL,
  workout_plan_id UUID NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.workout_logs ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own workout logs" 
ON public.workout_logs 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own workout logs" 
ON public.workout_logs 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workout logs" 
ON public.workout_logs 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workout logs" 
ON public.workout_logs 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create index for better performance
CREATE INDEX idx_workout_logs_user_id ON public.workout_logs(user_id);
CREATE INDEX idx_workout_logs_plan_day ON public.workout_logs(plan_day);
CREATE INDEX idx_workout_logs_workout_plan_id ON public.workout_logs(workout_plan_id);