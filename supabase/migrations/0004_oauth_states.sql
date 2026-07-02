-- Short-lived OAuth state tokens (CSRF protection for the connect/callback
-- flow). Written and read only by the service role — never exposed to clients.

create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null check (provider in ('meta_ads', 'google_ads', 'ga4')),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists oauth_states_state_idx on public.oauth_states (state);
create index if not exists oauth_states_expires_idx on public.oauth_states (expires_at);

-- RLS on with no policies => only the service role (which bypasses RLS) can touch it.
alter table public.oauth_states enable row level security;

-- Cron-callable cleanup of expired state rows.
create or replace function public.cleanup_expired_oauth_states()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.oauth_states where expires_at < now();
$$;
