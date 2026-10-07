-- Ad-level daily delivery WITH purchases (Meta), for creative A/B tests
-- ("Testy kreacji"). Shops that test many ads per ad set and spend tens of
-- thousands of złoty a day in season need to see within hours which ad
-- wins, which burns money and which is wearing out. The `creatives` table
-- only holds one rolling 30-day snapshot per ad, without purchases, so it
-- cannot answer "since when" or "in the last 3 days".
--
-- 1. ads_ad_daily: one row per ad per Warsaw day. Synced by
--    /api/cron/refresh-ads-meta-ads every ~30 min, ONLY for e-commerce
--    clients - engagement clients with huge media accounts must not pay for
--    ad-level daily pulls. Money in PLN minor units (grosze), like
--    ads_daily: accounts billed in another currency are converted at the
--    NBP mid rate of the day, and their own currency, rate and original
--    amounts kept in raw_data (null for PLN accounts). `clicks` = link
--    clicks (inline_link_clicks), `clicks_all` = clicks (all).
--    fillfactor 85: the fresh days' rows are rewritten every run; free room
--    on each page lets Postgres update them in place (HOT - updated_at is
--    deliberately in no index) instead of bloating table and indexes.
-- 2. creatives: ad set, campaign name, delivery status and creation time per
--    ad, so the test view can group ads and skip the ones already switched off.
-- 3. ads_ad_daily_days(): per ad account and day, the newest sync stamp for
--    one client, so the cron finds missing / stale days in one round trip
--    instead of reading every ad row - per account, so one failed account
--    can't make a day look done. ads_ad_daily_account_ads(): the ads each
--    account delivered since a day, to tell which known ads an account's
--    (complete) ad listing no longer has - archived or deleted. Service role
--    only.
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
  raw_data jsonb,
  updated_at timestamptz not null default now(),
  primary key (client_id, provider, ad_id, date)
) with (fillfactor = 85);

-- A table created by an earlier draft of this file gets the same shape.
alter table public.ads_ad_daily add column if not exists raw_data jsonb;
alter table public.ads_ad_daily set (fillfactor = 85);

-- Reads page through a date window ordered by (date, ad_id); with ad_id in
-- the index every page comes back in order instead of being re-sorted
-- (same reason as 0036). Still serves plain (client_id, date) lookups.
create index if not exists ads_ad_daily_client_date_idx
  on public.ads_ad_daily (client_id, date, ad_id);

-- Nothing reads by ad set first; the index only cost every write.
drop index if exists public.ads_ad_daily_client_adset_date_idx;

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
-- Dropped first: an earlier draft returned (day_date, newest), and
-- "create or replace" cannot change a function's result columns.
drop function if exists public.ads_ad_daily_days(uuid, date);
create or replace function public.ads_ad_daily_days(p_client_id uuid, p_since date)
returns table (account_id text, day_date date, newest timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(d.account_id, '') as account_id, d.date as day_date, max(d.updated_at) as newest
  from public.ads_ad_daily d
  where d.client_id = p_client_id
    and d.provider = 'meta_ads'
    and d.date >= p_since
  group by coalesce(d.account_id, ''), d.date
$$;

revoke all on function public.ads_ad_daily_days(uuid, date) from public, anon, authenticated;
grant execute on function public.ads_ad_daily_days(uuid, date) to service_role;

create or replace function public.ads_ad_daily_account_ads(p_client_id uuid, p_since date)
returns table (account_id text, ad_id text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct coalesce(d.account_id, '') as account_id, d.ad_id
  from public.ads_ad_daily d
  where d.client_id = p_client_id
    and d.provider = 'meta_ads'
    and d.date >= p_since
$$;

revoke all on function public.ads_ad_daily_account_ads(uuid, date) from public, anon, authenticated;
grant execute on function public.ads_ad_daily_account_ads(uuid, date) to service_role;

-- PostgREST picks up the new table, columns and function without a restart.
notify pgrst, 'reload schema';
