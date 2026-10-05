-- =============================================================================
-- KOMPLET migracji z października 2026 (0018, 0020-0024).
-- Wklej w Supabase -> SQL Editor w całości i uruchom. Wszystko jest
-- idempotentne (IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE),
-- więc ponowne uruchomienie niczego nie psuje.
--
--   0018  sprzedaż per produkt (GA4 items)
--   0020  zaproszenia użytkowników klienta
--   0021  marża i cele sprzedaży (e-commerce)
--   0022  cotygodniowy e-mail „Twój tydzień w skrócie”
--   0023  frazy z Google Ads („Czego szukają Twoi klienci”)
--   0024  mapa aktywności na stronie (dzień tygodnia × godzina)
-- =============================================================================

-- ---------------------------------------------------------------- 0018_ga4_items.sql
-- Per-product (SKU) daily sales from GA4 item-scoped metrics: itemsPurchased +
-- itemRevenue by itemId/itemName. Feeds the "Top produkty" table on the
-- Sprzedaz tab. Synced by refresh-ga4 alongside the daily totals; the cron
-- probes for this table and skips items until the migration has run.
create table if not exists public.ga4_items_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  item_id text not null default '',
  item_name text not null,
  quantity numeric not null default 0,
  revenue_minor_units bigint not null default 0,
  unique (client_id, date, item_id, item_name)
);
create index if not exists ga4_items_daily_client_date_idx
  on public.ga4_items_daily (client_id, date desc);
alter table public.ga4_items_daily enable row level security;
-- Read/written server-side via the service-role client; no public policies.

-- ---------------------------------------------------------------- 0020_client_invitations.sql
-- Tenant-safe user provisioning.
--
-- handle_new_user() was MVP logic: every non-admin signup was hard-wired to
-- DRE. Inviting a SUNEW (or any other) client user would have dropped them
-- straight into DRE's dashboard - a tenant isolation break. Access is now
-- driven by an explicit invitation per email, and unknown emails get NO client
-- (fail closed) instead of someone else's data.

create table if not exists public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  client_id uuid not null references public.clients (id) on delete cascade,
  role text not null default 'client' check (role in ('client', 'member', 'admin')),
  created_at timestamptz not null default now(),
  -- One mapping per email; re-inviting updates the target client.
  unique (email)
);

create index if not exists client_invitations_email_idx
  on public.client_invitations (lower(email));

alter table public.client_invitations enable row level security;
-- Managed server-side with the service-role client; no public policies.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_emails text[] := array['daniel@patoagencja.com'];
  invited public.client_invitations%rowtype;
begin
  if new.email = any (admin_emails) then
    insert into public.users (id, email, role, client_id)
    values (new.id, new.email, 'admin', null)
    on conflict (id) do nothing;
    return new;
  end if;

  select * into invited
  from public.client_invitations
  where lower(email) = lower(new.email)
  limit 1;

  if found then
    insert into public.users (id, email, role, client_id)
    values (new.id, new.email, invited.role, invited.client_id)
    on conflict (id) do nothing;
  else
    -- No invitation: create the profile with NO client so RLS resolves nothing.
    -- Better a user who sees an empty dashboard than one who sees another
    -- client's numbers.
    insert into public.users (id, email, role, client_id)
    values (new.id, new.email, 'client', null)
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------- 0021_ecom_settings.sql
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

-- ---------------------------------------------------------------- 0022_weekly_digest.sql
-- "Twój tydzień w skrócie": an opt-in weekly e-mail (Monday morning, Warsaw)
-- summarising the previous Mon-Sun week for the client's contacts.
--
-- Separate recipients on purpose: alert e-mails usually go to agency staff,
-- while the weekly digest is meant for the client's marketing managers.
-- Empty weekly_digest_emails = fall back to the alert `emails` list.
--
-- Dedupe reuses notifications_sent with alert_key 'weekly-digest-<ISO week>',
-- so no new table is needed.
alter table public.notification_settings
  add column if not exists weekly_digest_enabled boolean not null default false,
  add column if not exists weekly_digest_emails text[] not null default '{}';

-- ---------------------------------------------------------------- 0023_search_terms.sql
-- "Czego szukają Twoi klienci": what people typed into Google before the
-- client's Google Ads showed up (search_term_view), aggregated over the last
-- 30 days. One snapshot per client per Warsaw day (period_end); the
-- refresh-ads-google cron replaces it at most once a day and skips silently
-- until this migration has run.
--
-- A row with search_term = '' is a "checked today, nothing found" marker so
-- the cron doesn't re-query every 30 min for accounts without Search
-- campaigns. Readers ignore it.
create table if not exists public.google_search_terms (
  id bigserial primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  customer_id text not null,
  search_term text not null,
  campaign_name text not null default '',
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_minor_units bigint not null default 0,
  conversions numeric not null default 0,
  period_end date not null,
  synced_at timestamptz not null default now(),
  unique (client_id, customer_id, search_term, campaign_name, period_end)
);

create index if not exists google_search_terms_client_period_idx
  on public.google_search_terms (client_id, period_end desc);

alter table public.google_search_terms enable row level security;

-- Read scoped by client_id like every other domain table. Writes come only
-- from the cron's service-role client (bypasses RLS), so no write policy.
drop policy if exists google_search_terms_select on public.google_search_terms;
create policy google_search_terms_select on public.google_search_terms
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

-- ---------------------------------------------------------------- 0024_ga4_hourly.sql
-- "Kiedy Twoi klienci są aktywni": website sessions by day of week x hour of
-- day from GA4 (dayOfWeek + hour, property timezone), aggregated over the
-- last 28 days (28daysAgo..yesterday = exactly 4 of each weekday, so days
-- compare fairly). One snapshot per client per Warsaw day; refresh-ga4 writes
-- it at most once a day (all 168 cells, zero-filled, so an existing snapshot
-- doubles as the "already synced today" marker) and skips silently until this
-- migration has run.
--
-- day_of_week follows GA4: 0 = Sunday .. 6 = Saturday. The UI reorders to
-- Monday-first.
create table if not exists public.ga4_activity_heatmap (
  client_id uuid not null references public.clients (id) on delete cascade,
  snapshot_date date not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  hour smallint not null check (hour between 0 and 23),
  sessions bigint not null default 0,
  engaged_sessions bigint not null default 0,
  synced_at timestamptz not null default now(),
  primary key (client_id, snapshot_date, day_of_week, hour)
);

create index if not exists ga4_activity_heatmap_client_snapshot_idx
  on public.ga4_activity_heatmap (client_id, snapshot_date desc);

alter table public.ga4_activity_heatmap enable row level security;

-- Read scoped by client_id like every other domain table. Writes come only
-- from the cron's service-role client (bypasses RLS), so no write policy.
drop policy if exists ga4_activity_heatmap_select on public.ga4_activity_heatmap;
create policy ga4_activity_heatmap_select on public.ga4_activity_heatmap
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());
