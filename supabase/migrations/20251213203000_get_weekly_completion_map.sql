-- Function: get_weekly_completion_map
-- Description: Returns a JSON map of completed exercises for a specific user, plan, and week range.
-- Keys are format: "{weekKey}_{dayIndex}_{exerciseIndex}"
-- Returns: jsonb (e.g., {"Week 1_0_0": true, "Week 1_0_1": true})

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
    AND completed = true; -- Only include completed items to keep payload minimal? 
                          -- Actually, if we want explicit False, we should query all. 
                          -- But the prompt asked for "lightweight". 
                          -- If we only return TRUEs, the frontend treats missing keys as false.
                          -- Let's check existing logic. 
                          -- The current map has true/false for all logs found.
                          -- If a log entry is missing, it's effectively "not done".
                          -- So returning only TRUE entries is the most efficient.

  RETURN result;
END;
$$;
