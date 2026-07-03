-- Monthly budgets, dashboard annotations (events) and system-generated alerts.

-- Monthly budget per client per platform.
create table if not exists public.client_budgets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  month date not null, -- first day of the month, e.g. '2026-07-01'
  platform text not null check (platform in ('meta_ads', 'google_ads', 'total')),
  budget_minor_units bigint not null,
  created_at timestamptz not null default now(),
  unique (client_id, month, platform)
);

-- Dashboard annotations / events (campaign launch, budget change, sale, etc.).
create table if not exists public.client_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  event_date date not null,
  title text not null,
  description text,
  event_type text check (
    event_type in (
      'campaign_launch',
      'budget_change',
      'sale_period',
      'strategy_change',
      'other'
    )
  ),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- System-generated alerts (campaigns needing attention).
create table if not exists public.client_alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  generated_at timestamptz not null default now(),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  category text not null,
  title text not null,
  description text not null,
  campaign_id text,
  provider text,
  dismissed_at timestamptz,
  auto_expires_at timestamptz
);

create index if not exists idx_client_budgets_client_month
  on public.client_budgets (client_id, month);
create index if not exists idx_client_events_client_date
  on public.client_events (client_id, event_date);
create index if not exists idx_alerts_client_active
  on public.client_alerts (client_id) where dismissed_at is null;

-- RLS: everyone scoped to their client can read; only agency users write.
alter table public.client_budgets enable row level security;
alter table public.client_events  enable row level security;
alter table public.client_alerts  enable row level security;

drop policy if exists client_budgets_select on public.client_budgets;
create policy client_budgets_select on public.client_budgets
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

drop policy if exists client_budgets_write on public.client_budgets;
create policy client_budgets_write on public.client_budgets
  for all to authenticated
  using (public.is_agency_user())
  with check (public.is_agency_user());

drop policy if exists client_events_select on public.client_events;
create policy client_events_select on public.client_events
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

drop policy if exists client_events_write on public.client_events;
create policy client_events_write on public.client_events
  for all to authenticated
  using (public.is_agency_user())
  with check (public.is_agency_user());

drop policy if exists client_alerts_select on public.client_alerts;
create policy client_alerts_select on public.client_alerts
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

drop policy if exists client_alerts_update on public.client_alerts;
create policy client_alerts_update on public.client_alerts
  for update to authenticated
  using (public.is_agency_user())
  with check (public.is_agency_user());
