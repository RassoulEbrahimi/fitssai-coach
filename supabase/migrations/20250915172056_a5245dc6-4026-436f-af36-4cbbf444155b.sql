-- Add week_key and day_index columns to workout_logs table
ALTER TABLE workout_logs 
ADD COLUMN IF NOT EXISTS week_key TEXT,
ADD COLUMN IF NOT EXISTS day_index INTEGER;

-- Create unique constraint for the new columns
-- First drop the existing constraint if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'workout_logs_user_id_plan_id_week_key_day_index_exercise_key' 
        AND table_name = 'workout_logs'
    ) THEN
        ALTER TABLE workout_logs DROP CONSTRAINT workout_logs_user_id_plan_id_week_key_day_index_exercise_key;
    END IF;
END $$;

-- Add the unique constraint for week_key, day_index approach
ALTER TABLE workout_logs 
ADD CONSTRAINT workout_logs_user_id_plan_id_week_key_day_index_exercise_idx 
UNIQUE (user_id, plan_id, week_key, day_index, exercise_index);