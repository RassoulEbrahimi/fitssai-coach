-- Add full_name column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN full_name TEXT;

-- Add a comment explaining the column
COMMENT ON COLUMN public.profiles.full_name IS 'User first name or display name';