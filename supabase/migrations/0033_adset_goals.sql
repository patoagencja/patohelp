-- Ad set (Meta) / ad group (Google) level goals.
--
-- 1. ads_adset_daily: daily delivery per ad set / ad group, synced by the
--    refresh-ads-meta and refresh-ads-google crons for a short window (last
--    35 days, or since the earliest running/upcoming goal, capped at 120).
--    Feeds the "Zestaw reklam" picker in the goal form and the progress of
--    ad-set goals. Money in PLN minor units (grosze), like ads_daily.
-- 2. campaign_flights.adset_id / adset_name: a goal may target one ad set
--    of the campaign instead of the whole campaign (null = whole campaign).
--
-- Idempotent: safe to run more than once. Crons and pages probe for the
-- table/columns and simply skip ad-set features until this has run.

create table if not exists public.ads_adset_daily (
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null,          -- 'meta_ads' | 'google_ads'
  account_id text,
  campaign_id text,
  campaign_name text,
  adset_id text not null,          -- Meta ad set id / Google ad group id
  adset_name text,
  date date not null,
  spend_minor_units bigint not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  reach bigint,
  conversions numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (client_id, provider, adset_id, date)
);

create index if not exists ads_adset_daily_campaign_idx
  on public.ads_adset_daily (client_id, campaign_id, date);

alter table public.ads_adset_daily enable row level security;

-- Same rule as ads_daily: agency sees all, a client user only their own.
drop policy if exists ads_adset_daily_select on public.ads_adset_daily;
create policy ads_adset_daily_select on public.ads_adset_daily
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

alter table public.campaign_flights add column if not exists adset_id text;
alter table public.campaign_flights add column if not exists adset_name text;
