-- Add duration and calories columns to workout_logs with defaults for existing rows
ALTER TABLE public.workout_logs 
ADD COLUMN duration_minutes integer NOT NULL DEFAULT 10,
ADD COLUMN calories_burned integer NOT NULL DEFAULT 50;

-- Update the get_user_stats function to use real values
CREATE OR REPLACE FUNCTION public.get_user_stats()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_streak integer := 0;
  v_total_minutes integer := 0;
  v_total_calories integer := 0;
  v_check_date date;
  v_has_workout boolean;
BEGIN
  -- Exit early if no user
  IF v_user_id IS NULL THEN
    RETURN json_build_object('streak', 0, 'minutes', 0, 'calories', 0);
  END IF;

  -- Sum actual duration and calories from completed exercises
  SELECT 
    COALESCE(SUM(duration_minutes), 0),
    COALESCE(SUM(calories_burned), 0)
  INTO v_total_minutes, v_total_calories
  FROM workout_logs
  WHERE user_id = v_user_id
    AND completed = true;

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
$function$;