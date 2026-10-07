-- =============================================================================
-- KOMPLET migracji (0036).
-- Wklej w Supabase -> SQL Editor w całości i uruchom. Wszystko jest
-- idempotentne (IF NOT EXISTS / CREATE OR REPLACE / sprawdzenie polityk), więc
-- ponowne uruchomienie niczego nie psuje. Nie zmienia żadnych danych.
--
--   0036  wydajność panelu dla dużych klientów (np. OLX):
--         - indeksy pod stronicowane odczyty ads_daily / ga4_daily /
--           ads_adset_daily i pod "ostatnią udaną synchronizację" (sync_runs),
--         - polityki RLS liczone raz na zapytanie zamiast raz na wiersz
--           (ta sama reguła dostępu),
--         - widok ads_daily_totals (sumy dzienne per platforma; RLS jak na
--           ads_daily), z którego czytają budżet, Puls, rok do roku, cele,
--           rekordy i wydatki sklepu.
--
-- Panel działa też bez tej migracji (czyta wtedy surowe wiersze), tylko
-- wolniej. Budowa indeksów na dużej tabeli może na kilka sekund wstrzymać zapis
-- synchronizacji - najlepiej uruchomić poza minutami :05/:15/:25/:35.
-- Wymaga Postgres 15+ (security_invoker) - każdy obecny projekt Supabase.
-- =============================================================================

-- ---------------------------------------------------------------- 0036_perf.sql
-- Dashboard read performance (large clients, e.g. OLX: hundreds of campaigns,
-- a year+ of daily history). No data changes; safe to run more than once.
-- The app works without it (every reader falls back), it is just slower.
--
-- 1. Indexes matching how the dashboard pages through ads_daily / ga4_daily /
--    ads_adset_daily. Paged reads order by (date, provider, campaign_id); with
--    only (client_id, date) indexed, Postgres re-read and re-sorted every
--    matching row for EACH 1000-row page. The new index returns rows already
--    in page order. GA4 daily totals (all dimension columns NULL) get a
--    partial index so they no longer scan the source/device/page snapshot
--    rows of the same days.
-- 2. sync_runs: the "newest successful sync" lookup runs on every page view
--    and every minute per open tab (live indicator); it sorted all of a
--    client's runs (~70 000 a year) each time.
-- 3. RLS policies on the big tables call is_agency_user() /
--    current_client_id() once per statement instead of once per ROW
--    (wrapped in a scalar subquery - Supabase's documented RLS performance
--    fix). Same rule, same result: both functions only depend on auth.uid(),
--    which is constant within a statement.
-- 4. ads_daily_totals: per-day, per-platform sums, so cards that only need
--    daily totals (budget, score, YoY, goals, records, shop spend) read ~2 rows
--    a day instead of one per campaign. security_invoker: it reads ads_daily
--    with the caller's rights, so RLS applies exactly as on ads_daily
--    (requires Postgres 15+, which every current Supabase project runs).
--
-- Index builds briefly block writes to the table (a sync running at that
-- moment waits a few seconds); run it outside the :05/:15/:25/:35 sync minutes
-- if the tables are very large.

-- ---------------------------------------------------------------- 1. indexes
create index if not exists ads_daily_client_date_provider_campaign_idx
  on public.ads_daily (client_id, date, provider, campaign_id);

create index if not exists ga4_daily_client_totals_idx
  on public.ga4_daily (client_id, date, id)
  where source_medium is null and device_category is null and page_path is null;

-- ads_adset_daily arrives with 0033; skip quietly if it hasn't run yet.
do $$
begin
  if to_regclass('public.ads_adset_daily') is not null then
    execute 'create index if not exists ads_adset_daily_client_date_provider_adset_idx
               on public.ads_adset_daily (client_id, date, provider, adset_id)';
  end if;
end $$;

-- ---------------------------------------------------------------- 2. sync_runs
create index if not exists sync_runs_client_success_finished_idx
  on public.sync_runs (client_id, finished_at desc)
  where status = 'success';

create index if not exists sync_runs_client_provider_started_idx
  on public.sync_runs (client_id, provider, started_at desc);

-- ---------------------------------------------------------------- 3. RLS per statement
-- ALTER POLICY keeps the policy's name, command and roles; only the USING
-- expression changes (same logic, evaluated once per statement).
do $$
declare
  t text;
begin
  foreach t in array array['ads_daily', 'ga4_daily', 'ads_adset_daily', 'creatives'] loop
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_select'
    ) then
      execute format(
        'alter policy %I on public.%I using ((select public.is_agency_user()) or client_id = (select public.current_client_id()))',
        t || '_select',
        t
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 4. daily totals view
create or replace view public.ads_daily_totals
with (security_invoker = true) as
select
  client_id,
  date,
  provider,
  sum(spend_minor_units)::bigint as spend_minor_units,
  sum(clicks)::bigint as clicks,
  sum(impressions)::bigint as impressions,
  sum(conversions)::bigint as conversions,
  count(*)::integer as campaign_rows
from public.ads_daily
group by client_id, date, provider;

comment on view public.ads_daily_totals is
  'Per-day, per-platform ad totals (all campaigns). security_invoker: RLS of ads_daily applies. Read by lib/dashboard/ads-totals.ts.';

revoke all on public.ads_daily_totals from anon;
grant select on public.ads_daily_totals to authenticated, service_role;

-- PostgREST picks up the new view without a restart.
notify pgrst, 'reload schema';
