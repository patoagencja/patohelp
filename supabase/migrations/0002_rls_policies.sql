-- Row Level Security. Every table is filtered by client_id:
--   * agency users (admin/member) see all clients
--   * client users see only their own client
-- Writes to domain tables happen from the cron via the service-role key, which
-- bypasses RLS entirely — so we only grant SELECT to authenticated users here.

-- SECURITY DEFINER helpers so policies can read public.users without recursing
-- into their own RLS. search_path is pinned to avoid hijacking.

create or replace function public.is_agency_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'member')
  );
$$;

create or replace function public.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select client_id
  from public.users
  where id = auth.uid();
$$;

-- Enable RLS everywhere.
alter table public.clients       enable row level security;
alter table public.users         enable row level security;
alter table public.integrations  enable row level security;
alter table public.ads_daily     enable row level security;
alter table public.ga4_daily     enable row level security;
alter table public.ai_summaries  enable row level security;
alter table public.sync_runs     enable row level security;

-- clients: agency sees all; a client user sees only their own client row.
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated
  using (public.is_agency_user() or id = public.current_client_id());

-- users: you can always read your own row; agency users read all.
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (id = auth.uid() or public.is_agency_user());

-- integrations: agency only (contains encrypted credentials — clients never
-- need to read these).
drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations
  for select to authenticated
  using (public.is_agency_user());

-- ads_daily: scoped by client_id.
drop policy if exists ads_daily_select on public.ads_daily;
create policy ads_daily_select on public.ads_daily
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

-- ga4_daily: scoped by client_id.
drop policy if exists ga4_daily_select on public.ga4_daily;
create policy ga4_daily_select on public.ga4_daily
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

-- ai_summaries: scoped by client_id.
drop policy if exists ai_summaries_select on public.ai_summaries;
create policy ai_summaries_select on public.ai_summaries
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

-- sync_runs: agency only (operational data).
drop policy if exists sync_runs_select on public.sync_runs;
create policy sync_runs_select on public.sync_runs
  for select to authenticated
  using (public.is_agency_user());
