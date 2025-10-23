-- Create ai_logs table for tracking AI request metrics
create table public.ai_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  model text not null,
  latency_ms integer not null,
  success boolean not null default false,
  status_code integer,
  error_message text,
  created_at timestamp with time zone not null default now()
);

-- Enable RLS
alter table public.ai_logs enable row level security;

-- RLS Policies
create policy "Users can view their own AI logs"
  on public.ai_logs
  for select
  using (auth.uid() = user_id);

create policy "Service role can insert AI logs"
  on public.ai_logs
  for insert
  with check (true);

-- Create index for faster queries
create index idx_ai_logs_user_id on public.ai_logs(user_id);
create index idx_ai_logs_created_at on public.ai_logs(created_at desc);