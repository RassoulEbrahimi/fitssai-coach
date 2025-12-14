-- Security Fix: Add write protection to exercises table
-- Only admins can modify the shared exercise library

CREATE POLICY "Only admins can insert exercises"
ON public.exercises
FOR INSERT
WITH CHECK (public.is_current_user_admin());

CREATE POLICY "Only admins can update exercises"
ON public.exercises
FOR UPDATE
USING (public.is_current_user_admin());

CREATE POLICY "Only admins can delete exercises"
ON public.exercises
FOR DELETE
USING (public.is_current_user_admin());

-- Security Fix: Add auth.uid() validation to rpc_toggle_set_and_count
CREATE OR REPLACE FUNCTION public.rpc_toggle_set_and_count(
  p_user_id uuid,
  p_plan_id uuid,
  p_week_key text,
  p_day_index integer,
  p_exercise_index integer,
  p_set_number integer,
  p_reps_completed integer,
  p_weight_used numeric,
  p_completed boolean,
  p_workout_day date
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workout_log_id uuid;
  v_completed_sets_count integer;
BEGIN
  -- SECURITY: Validate user can only modify their own data
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot modify data for other users';
  END IF;

  -- 1. Upsert workout_log to ensure it exists and get its ID
  INSERT INTO workout_logs (
    user_id,
    plan_id,
    week_key,
    day_index,
    exercise_index,
    completed,
    workout_day,
    duration_minutes,
    calories_burned
  ) VALUES (
    p_user_id,
    p_plan_id,
    p_week_key,
    p_day_index,
    p_exercise_index,
    false,
    p_workout_day,
    0,
    0
  )
  ON CONFLICT (user_id, plan_id, week_key, day_index, exercise_index)
  DO UPDATE SET
    workout_day = EXCLUDED.workout_day
  RETURNING id INTO v_workout_log_id;

  -- 2. Handle Set Logic
  IF p_completed THEN
    INSERT INTO workout_set_logs (
      workout_log_id,
      user_id,
      set_number,
      reps_completed,
      weight_used,
      completed_at
    ) VALUES (
      v_workout_log_id,
      p_user_id,
      p_set_number,
      p_reps_completed,
      p_weight_used,
      now()
    )
    ON CONFLICT (workout_log_id, set_number)
    DO UPDATE SET
      reps_completed = EXCLUDED.reps_completed,
      weight_used = EXCLUDED.weight_used,
      completed_at = EXCLUDED.completed_at;
  ELSE
    DELETE FROM workout_set_logs
    WHERE workout_log_id = v_workout_log_id
      AND set_number = p_set_number;
  END IF;

  -- 3. Calculate stats
  SELECT COUNT(*)
  INTO v_completed_sets_count
  FROM workout_set_logs
  WHERE workout_log_id = v_workout_log_id;

  -- Return result
  RETURN json_build_object(
    'workoutLogId', v_workout_log_id,
    'completedSetsCount', v_completed_sets_count,
    'message', CASE WHEN p_completed THEN 'Satz abgeschlossen' ELSE 'Satz zurückgesetzt' END
  );
END;
$$;

-- Security Fix: Add auth.uid() validation to get_weekly_completion_map
CREATE OR REPLACE FUNCTION get_weekly_completion_map(
  p_user_id UUID,
  p_plan_id UUID,
  p_week_key TEXT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  -- SECURITY: Validate user can only view their own data
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot view data for other users';
  END IF;

  SELECT COALESCE(
    jsonb_object_agg(
      p_week_key || '_' || day_index || '_' || exercise_index,
      completed
    ),
    '{}'::jsonb
  )
  INTO result
  FROM workout_logs
  WHERE user_id = p_user_id
    AND plan_id = p_plan_id
    AND week_key = p_week_key
    AND workout_day >= p_start_date
    AND workout_day <= p_end_date
    AND completed = true;

  RETURN result;
END;
$$;