-- Create RPC function to get user stats (streak, total minutes, total calories)
CREATE OR REPLACE FUNCTION public.get_user_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_streak integer := 0;
  v_total_minutes integer := 0;
  v_total_calories integer := 0;
  v_exercise_count integer := 0;
  v_check_date date;
  v_has_workout boolean;
BEGIN
  -- Exit early if no user
  IF v_user_id IS NULL THEN
    RETURN json_build_object('streak', 0, 'minutes', 0, 'calories', 0);
  END IF;

  -- Count total completed exercises
  SELECT COUNT(*)
  INTO v_exercise_count
  FROM workout_logs
  WHERE user_id = v_user_id
    AND completed = true;

  -- Estimate minutes (10 min per exercise) and calories (50 kcal per exercise)
  v_total_minutes := v_exercise_count * 10;
  v_total_calories := v_exercise_count * 50;

  -- Calculate streak: consecutive days ending today or yesterday
  v_check_date := CURRENT_DATE;
  
  -- First check if there's a workout today
  SELECT EXISTS(
    SELECT 1 FROM workout_logs
    WHERE user_id = v_user_id
      AND completed = true
      AND workout_day = v_check_date
  ) INTO v_has_workout;

  -- If no workout today, check yesterday as starting point
  IF NOT v_has_workout THEN
    v_check_date := CURRENT_DATE - INTERVAL '1 day';
    SELECT EXISTS(
      SELECT 1 FROM workout_logs
      WHERE user_id = v_user_id
        AND completed = true
        AND workout_day = v_check_date
    ) INTO v_has_workout;
    
    -- If no workout yesterday either, streak is 0
    IF NOT v_has_workout THEN
      RETURN json_build_object('streak', 0, 'minutes', v_total_minutes, 'calories', v_total_calories);
    END IF;
  END IF;

  -- Count consecutive days backwards from v_check_date
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM workout_logs
      WHERE user_id = v_user_id
        AND completed = true
        AND workout_day = v_check_date
    ) INTO v_has_workout;

    EXIT WHEN NOT v_has_workout;
    
    v_streak := v_streak + 1;
    v_check_date := v_check_date - INTERVAL '1 day';
  END LOOP;

  RETURN json_build_object('streak', v_streak, 'minutes', v_total_minutes, 'calories', v_total_calories);
END;
$$;