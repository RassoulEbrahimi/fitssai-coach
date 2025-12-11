-- Create RPC function to toggle set and return stats
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
    false, -- Default to false, logic elsewhere handles workout completion
    p_workout_day,
    0,
    0
  )
  ON CONFLICT (user_id, plan_id, week_key, day_index, exercise_index)
  DO UPDATE SET
    workout_day = EXCLUDED.workout_day -- Ensure date matches
  RETURNING id INTO v_workout_log_id;

  -- 2. Handle Set Logic
  IF p_completed THEN
    -- Insert or update set log
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
    -- Delete set log
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
