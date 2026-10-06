-- Meta "clicks" become LINK clicks across the panel.
--
-- Until now the Meta syncs stored the insights field `clicks` - clicks (all):
-- reactions, comments, profile visits, "see more" AND link clicks - in
-- `clicks`, with the "(all)" CTR/CPC. From this migration on:
--
--   clicks      = inline_link_clicks (Ads Manager "Kliknięcia linku"),
--                 CTR / CPC columns = the link-click variants;
--   clicks_all  = clicks (all), kept for the "Wszystkie kliknięcia" goal.
--
-- Google Ads clicks are ad clicks (already link-like): Google rows get
-- clicks_all = clicks. NULL clicks_all = a row synced before this migration
-- (its `clicks` still holds clicks (all)); readers fall back to `clicks`.
--
-- After it runs, the Meta campaign cron re-pulls the last 365 days (days with
-- clicks_all IS NULL count as missing, newest first, 150 days per run), the
-- ad set sync re-pulls its window, and creatives convert on their next run.
--
-- Idempotent: safe to run more than once. Every sync and page probes for
-- clicks_all and keeps the old behaviour until this has run.

alter table public.ads_daily add column if not exists clicks_all bigint;
-- `if exists`: ads_adset_daily comes with 0033 (ALL_RECENT_3). Run that
-- first, or re-run this file after it, to give ad sets the column too.
alter table if exists public.ads_adset_daily add column if not exists clicks_all bigint;
alter table public.creatives add column if not exists clicks_all bigint;

comment on column public.ads_daily.clicks is
  'Meta: link clicks (inline_link_clicks) once clicks_all is set; Google: ad clicks.';
comment on column public.ads_daily.clicks_all is
  'Meta: clicks (all). Google: = clicks. NULL = synced before 0034.';

-- The re-pull looks for Meta days that still hold pre-0034 rows; this partial
-- index keeps that lookup cheap and empties itself as history converts.
create index if not exists ads_daily_meta_clicks_all_null_idx
  on public.ads_daily (client_id, date)
  where provider = 'meta_ads' and clicks_all is null;

-- campaign_flights.target_metric is free text in the repo's migrations
-- (0009). Should a CHECK on it exist anyway (added by hand), replace it with
-- one that also allows the new 'clicks_all' goal.
do $$
declare
  c record;
  had_check boolean := false;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'campaign_flights'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%target_metric%'
  loop
    execute format('alter table public.campaign_flights drop constraint %I', c.conname);
    had_check := true;
  end loop;
  if had_check then
    alter table public.campaign_flights
      add constraint campaign_flights_target_metric_check
      check (target_metric in ('clicks', 'clicks_all', 'impressions', 'spend', 'conversions'));
  end if;
end
$$;
