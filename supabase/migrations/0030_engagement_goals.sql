-- Monthly goals for engagement (non-shop) clients: sessions, ad clicks,
-- impressions or on-site actions per month, so the overview can say "where
-- will this month land" the way revenue_goals (0021) does for shops.
--
-- Why a metric column instead of four goal columns: a client usually cares
-- about one or two of these, and an absent row cleanly means "no goal" - no
-- nullable-column juggling, and a new metric later is a check-constraint edit.

create table if not exists public.engagement_goals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  month date not null, -- first day of the month, e.g. '2026-10-01'
  metric text not null
    check (metric in ('sessions', 'clicks', 'impressions', 'conversions')),
  -- Plain counts (sessions, clicks...), never money - no minor units here.
  target bigint not null check (target > 0),
  created_at timestamptz not null default now(),
  -- Shown in settings as "zapisano ..." so the agency sees the save landed.
  updated_at timestamptz not null default now(),
  unique (client_id, month, metric)
);

-- Guard the "first day of the month" convention in the DB too: a goal saved
-- on '2026-10-15' would silently never match the month lookup.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'engagement_goals_month_first_day'
      and conrelid = 'public.engagement_goals'::regclass
  ) then
    alter table public.engagement_goals
      add constraint engagement_goals_month_first_day
      check (extract(day from month) = 1);
  end if;
end $$;

create index if not exists idx_engagement_goals_client_month
  on public.engagement_goals (client_id, month);

-- RLS: the client reads its own, only agency users write (same as 0021).
alter table public.engagement_goals enable row level security;

drop policy if exists engagement_goals_select on public.engagement_goals;
create policy engagement_goals_select on public.engagement_goals
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

drop policy if exists engagement_goals_write on public.engagement_goals;
create policy engagement_goals_write on public.engagement_goals
  for all to authenticated
  using (public.is_agency_user())
  with check (public.is_agency_user());
