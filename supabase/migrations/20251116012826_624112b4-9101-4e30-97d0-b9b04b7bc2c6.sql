-- Create deletion_requests table for safe account deletion with grace period
CREATE TABLE IF NOT EXISTS public.deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  deletion_date timestamptz NOT NULL,
  confirmation_token text NOT NULL UNIQUE,
  confirmed boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  cancelled boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  CONSTRAINT valid_deletion_date CHECK (deletion_date > requested_at)
);

-- Enable RLS
ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own deletion requests
CREATE POLICY "Users can view their own deletion requests"
ON public.deletion_requests
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own deletion requests
CREATE POLICY "Users can create deletion requests"
ON public.deletion_requests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own deletion requests (for cancellation)
CREATE POLICY "Users can update their own deletion requests"
ON public.deletion_requests
FOR UPDATE
USING (auth.uid() = user_id);

-- Create index for efficient querying of pending deletions
CREATE INDEX idx_deletion_pending ON public.deletion_requests(deletion_date)
WHERE confirmed = true AND cancelled = false;