-- Drop the unused is_admin column from profiles table
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_admin;