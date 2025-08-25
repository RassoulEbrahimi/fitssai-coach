-- Create workout_plans table
CREATE TABLE public.workout_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create nutrition_plans table
CREATE TABLE public.nutrition_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.workout_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_plans ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for workout_plans
CREATE POLICY "Users can view their own workout plans" 
ON public.workout_plans 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own workout plans" 
ON public.workout_plans 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workout plans" 
ON public.workout_plans 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workout plans" 
ON public.workout_plans 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create RLS policies for nutrition_plans
CREATE POLICY "Users can view their own nutrition plans" 
ON public.nutrition_plans 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own nutrition plans" 
ON public.nutrition_plans 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own nutrition plans" 
ON public.nutrition_plans 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own nutrition plans" 
ON public.nutrition_plans 
FOR DELETE 
USING (auth.uid() = user_id);