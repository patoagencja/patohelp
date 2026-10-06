-- =============================================================================
-- KOMPLET migracji z października 2026 (0018, 0020-0031).
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
--   0025  metryki kreacji z Mety (jakość, wideo, zmęczenie reklamy)
--   0026  link dla zarządu (podgląd tylko do odczytu)
--   0027  widoczność w Google (udział w wyświetleniach)
--   0028  nowi i stali klienci sklepu
--   0029  „Co dla Ciebie zrobiliśmy” (kategorie i widoczność działań)
--   0030  cele miesięczne dla klientów bez sklepu
--   0031  logo i kolor klienta („Wygląd panelu”)
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

-- ---------------------------------------------------------------- 0025_creative_metrics.sql
-- Richer per-ad creative insight for the "Kreacje" tab: Meta's ad relevance
-- diagnostics (rankings), reach/frequency for fatigue detection, and video
-- retention counts for hook / hold / completion rates.
--
-- Every column is nullable on purpose: NULL means "Meta did not report it"
-- (e.g. video columns on a static image ad, rankings below 500 impressions),
-- which the UI must keep distinct from a real zero.
--
-- Safe to re-run. The sync (/api/cron/refresh-creatives-meta) probes for
-- these columns and keeps working without them until this migration runs.

alter table public.creatives
  add column if not exists reach bigint,
  add column if not exists frequency numeric,
  -- Raw Meta enum strings: ABOVE_AVERAGE, AVERAGE, BELOW_AVERAGE_35,
  -- BELOW_AVERAGE_20, BELOW_AVERAGE_10, UNKNOWN. Kept raw (no check
  -- constraint) so a new value from Meta never fails the whole upsert.
  add column if not exists quality_ranking text,
  add column if not exists engagement_rate_ranking text,
  add column if not exists conversion_rate_ranking text,
  -- video_play_actions: plays started (autoplay counts, so ~= impressions).
  add column if not exists video_plays bigint,
  -- actions[action_type = video_view]: Meta's "3-second video plays".
  add column if not exists video_3s_views bigint,
  -- video_thruplay_watched_actions: watched to completion or 15s+.
  add column if not exists video_thruplays bigint,
  add column if not exists video_p25 bigint,
  add column if not exists video_p50 bigint,
  add column if not exists video_p75 bigint,
  add column if not exists video_p100 bigint,
  add column if not exists video_avg_watch_seconds numeric;

-- ---------------------------------------------------------------- 0026_share_overview.sql
-- "Udostępnij zarządowi": share_links now also carries read-only overview
-- links (/s/<token>), not just report decks (/r/<token>). Existing rows keep
-- working as report links thanks to the 'report' default.
--
-- The table stays service-role only (RLS on, no policies): the public pages
-- look tokens up through the admin client, and the agency settings page
-- creates/revokes them through server actions guarded by
-- requireAgencyClientAccess. Never add an anon/authenticated SELECT policy -
-- the token column IS the credential.

alter table public.share_links
  add column if not exists kind text not null default 'report';

-- Guarded so the migration can be re-run safely (no IF NOT EXISTS for
-- constraints in Postgres).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'share_links_kind_check'
  ) then
    alter table public.share_links
      add constraint share_links_kind_check check (kind in ('report', 'overview'));
  end if;
end $$;

-- NULL = never expires. Checked by the public page on every request.
alter table public.share_links
  add column if not exists expires_at timestamptz;

-- Audit trail: who minted the link, when it was killed and whether it is
-- actually being opened (helps decide whether a leaked link needs revoking).
alter table public.share_links
  add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.share_links
  add column if not exists revoked_at timestamptz;
alter table public.share_links
  add column if not exists last_viewed_at timestamptz;

create index if not exists share_links_client_kind_active_idx
  on public.share_links (client_id, kind)
  where not revoked;

-- ---------------------------------------------------------------- 0027_impression_share.sql
-- "Jak bardzo jesteś widoczny w Google": Search impression share per Google
-- Ads Search campaign over the last 30 days, plus how much of the missed
-- visibility was lost to budget vs ad rank. Gives the client a fact-based way
-- to talk about budget. One snapshot per client per Warsaw day (period_end);
-- the refresh-ads-google cron replaces it at most once a day and skips
-- silently until this migration has run.
--
-- Shares are stored exactly as Google returns them: fractions 0-1, null when
-- Google has too little data. Google caps reporting, so 0.0999 means "<10%"
-- and 0.9001 means ">90%" - readers treat those as approximate.
--
-- A row with campaign_id = '' is a "checked today, no Search campaigns"
-- marker so the cron doesn't re-query every run. Readers ignore it.
create table if not exists public.google_impression_share (
  client_id uuid not null references public.clients (id) on delete cascade,
  customer_id text not null,
  campaign_id text not null,
  campaign_name text not null default '',
  impression_share numeric,
  budget_lost numeric,
  rank_lost numeric,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_minor_units bigint not null default 0,
  period_end date not null,
  synced_at timestamptz not null default now(),
  primary key (client_id, customer_id, campaign_id, period_end)
);

create index if not exists google_impression_share_client_period_idx
  on public.google_impression_share (client_id, period_end desc);

alter table public.google_impression_share enable row level security;

-- Read scoped by client_id like every other domain table. Writes come only
-- from the cron's service-role client (bypasses RLS), so no write policy.
drop policy if exists google_impression_share_select on public.google_impression_share;
create policy google_impression_share_select on public.google_impression_share
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

-- ---------------------------------------------------------------- 0028_new_vs_returning.sql
-- "Nowi czy stali klienci" (e-commerce clients only): GA4 revenue, orders,
-- users and sessions split by newVsReturning ("new" / "returning" /
-- "(not set)"), aggregated over the last 30 full days (30daysAgo..yesterday).
-- One snapshot per client per Warsaw day; refresh-ga4 writes it at most once a
-- day (both "new" and "returning" rows always, zero-filled, so an existing
-- snapshot doubles as the "already synced today" marker) and skips silently
-- until this migration has run.
--
-- Money in grosze like everywhere else. Snapshots are kept (3 tiny rows a
-- day) so the split can later be shown as a trend.
create table if not exists public.ga4_new_vs_returning (
  client_id uuid not null references public.clients (id) on delete cascade,
  snapshot_date date not null,
  segment text not null check (segment in ('new', 'returning', '(not set)')),
  revenue_minor_units bigint not null default 0,
  transactions bigint not null default 0,
  users bigint not null default 0,
  sessions bigint not null default 0,
  synced_at timestamptz not null default now(),
  primary key (client_id, snapshot_date, segment)
);

create index if not exists ga4_new_vs_returning_client_snapshot_idx
  on public.ga4_new_vs_returning (client_id, snapshot_date desc);

alter table public.ga4_new_vs_returning enable row level security;

-- Read scoped by client_id like every other domain table. Writes come only
-- from the cron's service-role client (bypasses RLS), so no write policy.
drop policy if exists ga4_new_vs_returning_select on public.ga4_new_vs_returning;
create policy ga4_new_vs_returning_select on public.ga4_new_vs_returning
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

-- ---------------------------------------------------------------- 0029_client_events_kind.sql
-- "Co dla Ciebie zrobiliśmy": client_events doubles as the agency work log.
--
-- Existing rows (chart annotations entered by hand) keep working untouched:
-- category stays null (the UI derives one from event_type) and they stay
-- visible. created_by already exists since 0005.
--
-- Idempotent: safe to re-run.

alter table public.client_events
  add column if not exists category text;

-- Internal notes ("klient prosił o wstrzymanie, czekamy na akcept") must be
-- loggable without the client reading them.
alter table public.client_events
  add column if not exists visible_to_client boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_events_category_check'
      and conrelid = 'public.client_events'::regclass
  ) then
    alter table public.client_events
      add constraint client_events_category_check check (
        category is null
        or category in ('kampania', 'kreacja', 'optymalizacja', 'raport', 'strona', 'inne')
      );
  end if;
end
$$;

-- Hidden entries are enforced in the database, not just filtered in the UI:
-- a client user querying Supabase directly must not see them either.
drop policy if exists client_events_select on public.client_events;
create policy client_events_select on public.client_events
  for select to authenticated
  using (
    public.is_agency_user()
    or (client_id = public.current_client_id() and visible_to_client)
  );

-- Write policy (agency only) from 0005 is unchanged.

-- ---------------------------------------------------------------- 0030_engagement_goals.sql
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

-- ---------------------------------------------------------------- 0031_client_branding.sql
-- "Panel w barwach klienta": the client's own logo and an optional accent
-- colour, so the dashboard, the PDF and the board link look like THEIR report.
--
-- Both are optional: null means "keep the default look" (the hard-coded SVG
-- wordmark for known slugs, or the client's name). Set by agency users only,
-- through the settings page Server Action (service-role client), so no new
-- RLS policy is needed - the existing clients SELECT policies already let a
-- client user read their own row, and these are just two more columns of it.

alter table public.clients add column if not exists logo_url text;
alter table public.clients add column if not exists brand_color text;

-- The logo is rendered as <img src> in the panel, on the public board link and
-- in e-mails: https only (no http mixed content, no data:/javascript: URLs),
-- and bounded so a pasted blob can't bloat every page that selects clients.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_logo_url_https'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_logo_url_https
      check (logo_url is null or (logo_url ~ '^https://[^\s]+$' and char_length(logo_url) <= 500));
  end if;
end $$;

-- The colour ends up inside a style attribute (a CSS variable); a strict
-- #rrggbb shape is the only thing that can't smuggle in other CSS.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_brand_color_hex'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_brand_color_hex
      check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;
