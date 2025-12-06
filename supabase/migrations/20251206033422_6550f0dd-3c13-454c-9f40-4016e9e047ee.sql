-- Fix RLS policies for profiles table
-- Drop existing SELECT policies that may be misconfigured
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

-- Create proper PERMISSIVE SELECT policy (users can only see their own profile)
CREATE POLICY "Users can only view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Allow admins to view all profiles (using security definer function)
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_current_user_admin());

-- Fix RLS policies for deletion_requests table
-- Drop existing SELECT policy that may be misconfigured
DROP POLICY IF EXISTS "Users can view their own deletion requests" ON public.deletion_requests;

-- Create proper PERMISSIVE SELECT policy (users can only see their own deletion requests)
CREATE POLICY "Users can only view their own deletion requests"
ON public.deletion_requests
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);