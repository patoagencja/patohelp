-- =============================================================================
-- KOMPLET migracji (0039).
-- Wklej w Supabase -> SQL Editor w całości i uruchom. Idempotentne - ponowne
-- uruchomienie niczego nie psuje. Nie zmienia żadnych istniejących danych.
--
--   0039  testy kreacji (A/B) dla sklepów i klientów sezonowych:
--         - tabela ads_ad_daily: każda reklama Meta dzień po dniu, z zakupami
--           i ich wartością. Uzupełnia ją cron refresh-ads-meta-ads co ~30
--           minut, TYLKO dla klientów sezonowych lub e-commerce (duże konta
--           wizerunkowe nie płacą za ten ciężki odczyt),
--         - w tabeli creatives kolumny: zestaw reklam, nazwa kampanii, status
--           emisji i data utworzenia reklamy (widok testów pomija reklamy już
--           wyłączone),
--         - funkcja ads_ad_daily_days (tylko dla serwera): które dni są już
--           pobrane i jak świeże - cron nie musi czytać wszystkich wierszy.
--
-- Bez tej migracji widok "Testy kreacji" pokazuje "brak danych", a cron nic
-- nie pobiera. Pierwsze przebiegi crona dociągają ostatnie 35 dni (i cały
-- bieżący sezon) - na dużym koncie zajmuje to kilka przebiegów.
-- =============================================================================

-- ------------------------------------------------------------- 0039_ad_daily.sql
-- Ad-level daily delivery WITH purchases (Meta), for creative A/B tests
-- ("Testy kreacji"). Shops that test many ads per ad set and spend tens of
-- thousands of złoty a day in season need to see within hours which ad
-- wins, which burns money and which is wearing out. The `creatives` table
-- only holds one rolling 30-day snapshot per ad, without purchases, so it
-- cannot answer "since when" or "in the last 3 days".
--
-- 1. ads_ad_daily: one row per ad per Warsaw day. Synced by
--    /api/cron/refresh-ads-meta-ads every ~30 min, ONLY for seasonal
--    (clients.season) or e-commerce clients - engagement clients with huge
--    media accounts must not pay for ad-level daily pulls. Money in PLN
--    minor units (grosze), like ads_daily. `clicks` = link clicks
--    (inline_link_clicks), `clicks_all` = clicks (all).
-- 2. creatives: ad set, campaign name, delivery status and creation time per
--    ad, so the test view can group ads and skip the ones already switched off.
-- 3. ads_ad_daily_days(): per-day newest sync stamp for one client, so the
--    cron finds missing / stale days in one round trip instead of reading
--    every ad row. Service role only.
--
-- Idempotent: safe to run more than once. The cron and the test view probe
-- for the table and simply do nothing until this has run.

-- ---------------------------------------------------------------- 1. table
create table if not exists public.ads_ad_daily (
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null default 'meta_ads',
  account_id text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text not null,
  ad_name text,
  date date not null,
  spend_minor_units bigint not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  clicks_all bigint,
  reach bigint,
  frequency numeric,
  purchases integer not null default 0,
  purchase_value_minor_units bigint not null default 0,
  video_3s_views bigint,
  updated_at timestamptz not null default now(),
  primary key (client_id, provider, ad_id, date)
);

-- Reads page through a date window ordered by (date, ad_id); with ad_id in
-- the index every page comes back in order instead of being re-sorted
-- (same reason as 0036). Still serves plain (client_id, date) lookups.
create index if not exists ads_ad_daily_client_date_idx
  on public.ads_ad_daily (client_id, date, ad_id);

create index if not exists ads_ad_daily_client_adset_date_idx
  on public.ads_ad_daily (client_id, adset_id, date);

alter table public.ads_ad_daily enable row level security;

-- Same rule as ads_daily (in its per-statement form from 0036): agency users
-- see every client, a client user only their own. Writes: service role only.
drop policy if exists ads_ad_daily_select on public.ads_ad_daily;
create policy ads_ad_daily_select on public.ads_ad_daily
  for select to authenticated
  using ((select public.is_agency_user()) or client_id = (select public.current_client_id()));

-- ---------------------------------------------------------------- 2. creatives
alter table public.creatives add column if not exists adset_id text;
alter table public.creatives add column if not exists adset_name text;
alter table public.creatives add column if not exists campaign_name text;
alter table public.creatives add column if not exists effective_status text;
alter table public.creatives add column if not exists created_time timestamptz;

-- ---------------------------------------------------------------- 3. sync state
create or replace function public.ads_ad_daily_days(p_client_id uuid, p_since date)
returns table (day_date date, newest timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select d.date as day_date, max(d.updated_at) as newest
  from public.ads_ad_daily d
  where d.client_id = p_client_id
    and d.provider = 'meta_ads'
    and d.date >= p_since
  group by d.date
$$;

revoke all on function public.ads_ad_daily_days(uuid, date) from public, anon, authenticated;
grant execute on function public.ads_ad_daily_days(uuid, date) to service_role;

-- PostgREST picks up the new table, columns and function without a restart.
notify pgrst, 'reload schema';
