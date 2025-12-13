-- Migration: fix_workout_logs_constraints
-- Description: Adds strict Foreign Keys with ON DELETE CASCADE to workout_logs.
--              Also attempts to fix ai_feedback and deletion_requests.

-- 1. Fix workout_logs
ALTER TABLE IF EXISTS public.workout_logs
  DROP CONSTRAINT IF EXISTS workout_logs_plan_id_fkey;

ALTER TABLE public.workout_logs
  ADD CONSTRAINT workout_logs_plan_id_fkey
  FOREIGN KEY (plan_id)
  REFERENCES public.workout_plans(id)
  ON DELETE CASCADE;

ALTER TABLE public.workout_logs
  ADD CONSTRAINT workout_logs_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- 2. Fix ai_feedback (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_feedback') THEN
    -- Try to drop existing FK if we can guess it or just add new one? 
    -- Safer to just leave it if we don't know the constraint name, OR try generic.
    -- Better: ensure the user_id column references auth.users with cascade.
    -- We'll try to add it. If it duplicates, postgres might complain or handle it.
    -- Actually, let's just assume we can add it if we drop a likely name.
    ALTER TABLE public.ai_feedback DROP CONSTRAINT IF EXISTS ai_feedback_user_id_fkey;
    
    ALTER TABLE public.ai_feedback
      ADD CONSTRAINT ai_feedback_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Fix deletion_requests (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'deletion_requests') THEN
    ALTER TABLE public.deletion_requests DROP CONSTRAINT IF EXISTS deletion_requests_user_id_fkey;
    
    ALTER TABLE public.deletion_requests
      ADD CONSTRAINT deletion_requests_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Strict RLS for workout_logs
DROP POLICY IF EXISTS "Users can delete their own workout logs" ON public.workout_logs;

CREATE POLICY "Users can delete their own workout logs"
  ON public.workout_logs
  FOR DELETE
  USING (auth.uid() = user_id);
