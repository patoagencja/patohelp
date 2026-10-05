-- E-commerce economics per client: gross margin (to turn revenue into profit)
-- and monthly revenue goals (to pace the month against a target).
--
-- Why: ROAS alone says nothing about whether ads make money - a 4x ROAS is a
-- loss at a 20% margin and a great result at 60%. With the margin known, the
-- dashboard shows profit after ads, POAS and the break-even ROAS.

create table if not exists public.ecom_settings (
  client_id uuid primary key references public.clients (id) on delete cascade,
  -- Gross margin on net (ex-VAT) revenue, in percent, e.g. 55 = 55%.
  gross_margin_pct numeric
    check (gross_margin_pct is null or (gross_margin_pct > 0 and gross_margin_pct <= 100)),
  -- Polish shops usually report gross (VAT-inclusive) revenue to GA4, while
  -- ad spend is net. Profit maths strips 23% VAT from revenue when true.
  revenue_includes_vat boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.revenue_goals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  month date not null, -- first day of the month, e.g. '2026-11-01'
  goal_minor_units bigint not null check (goal_minor_units > 0),
  created_at timestamptz not null default now(),
  unique (client_id, month)
);

create index if not exists idx_revenue_goals_client_month
  on public.revenue_goals (client_id, month);

-- RLS: the client reads its own, only agency users write (same as budgets).
alter table public.ecom_settings enable row level security;
alter table public.revenue_goals enable row level security;

drop policy if exists ecom_settings_select on public.ecom_settings;
create policy ecom_settings_select on public.ecom_settings
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

drop policy if exists ecom_settings_write on public.ecom_settings;
create policy ecom_settings_write on public.ecom_settings
  for all to authenticated
  using (public.is_agency_user())
  with check (public.is_agency_user());

drop policy if exists revenue_goals_select on public.revenue_goals;
create policy revenue_goals_select on public.revenue_goals
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

drop policy if exists revenue_goals_write on public.revenue_goals;
create policy revenue_goals_write on public.revenue_goals
  for all to authenticated
  using (public.is_agency_user())
  with check (public.is_agency_user());
