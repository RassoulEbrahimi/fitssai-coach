-- Add DELETE policy for deletion_requests table (allows users to delete their own deletion requests)
CREATE POLICY "Users can delete their own deletion requests"
ON public.deletion_requests
FOR DELETE
USING (auth.uid() = user_id);

-- Add DELETE policy for profiles table (allows users to delete their own profile)
CREATE POLICY "Users can delete their own profile"
ON public.profiles
FOR DELETE
USING (auth.uid() = id);

-- Add DELETE policy for ai_logs table (allows users to delete their AI usage logs)
CREATE POLICY "Users can delete their own AI logs"
ON public.ai_logs
FOR DELETE
USING (auth.uid() = user_id);