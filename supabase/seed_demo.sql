-- =============================================================================
-- DEMO TENANT SEED  (sales / prospect showcase)
-- -----------------------------------------------------------------------------
-- Creates a self-contained "demo" client with realistic, entirely SYNTHETIC
-- data so you can show a prospect the whole dashboard without exposing any real
-- client's numbers. RLS keeps it isolated: a demo login (role 'client',
-- client_id = demo) sees ONLY this data.
--
-- Safe to re-run: it wipes and re-seeds only the demo client's rows.
-- Run in Supabase → SQL editor. Then follow "DEMO LOGIN" at the bottom.
-- =============================================================================

-- 1) The demo client -----------------------------------------------------------
insert into public.clients (slug, name)
values ('demo', 'Demo — Twoja Firma')
on conflict (slug) do update set name = excluded.name;

-- Clean previous demo data (scoped to the demo client only) -------------------
delete from public.ads_daily      where client_id = (select id from public.clients where slug = 'demo');
delete from public.ga4_daily       where client_id = (select id from public.clients where slug = 'demo');
delete from public.creatives       where client_id = (select id from public.clients where slug = 'demo');
delete from public.client_budgets  where client_id = (select id from public.clients where slug = 'demo');
delete from public.ai_summaries    where client_id = (select id from public.clients where slug = 'demo');

-- 2) Ads: 120 days × 8 campaigns (Meta + Google) ------------------------------
-- Deterministic pseudo-random per (campaign, day) via md5 hash, with a gentle
-- upward trend (recent > older, so deltas read positive) and weekly seasonality.
with c as (
  select id from public.clients where slug = 'demo'
),
camp (provider, campaign_id, campaign_name, base_spend, base_ctr, base_cpc) as (
  values
    ('meta_ads',  'demo-m1', 'DEMO | BRAND | Świadomość | Reach',   22000, 0.009, 90),
    ('meta_ads',  'demo-m2', 'DEMO | TRAFFIC | Ruch na stronę',      18000, 0.021, 70),
    ('meta_ads',  'demo-m3', 'DEMO | ENGAGEMENT | Instagram',        12000, 0.028, 55),
    ('meta_ads',  'demo-m4', 'DEMO | RETARGETING | Odwiedzający',     9000, 0.024, 60),
    ('google_ads','demo-g1', 'DEMO | SEARCH | Marka',                 8000, 0.085, 110),
    ('google_ads','demo-g2', 'DEMO | SEARCH | Generyczne',           16000, 0.045, 190),
    ('google_ads','demo-g3', 'DEMO | PMAX | Ruch',                   14000, 0.018, 130),
    ('google_ads','demo-g4', 'DEMO | YT | Wideo',                    11000, 0.011, 45)
),
days as (
  select generate_series((current_date - interval '119 day')::date, current_date, interval '1 day')::date as d
),
base as (
  select
    c.id as client_id, camp.*, days.d,
    extract(dow from days.d)::int as dow,
    (days.d - (current_date - interval '119 day')::date) as offs,
    (abs(('x' || substr(md5(camp.campaign_id || days.d::text), 1, 8))::bit(32)::int) % 1000) as h
  from c cross join camp cross join days
),
calc as (
  select *,
    (1 + offs::numeric / 119 * 0.35) as trend,
    (case when dow in (0,6) then 0.78 else 1.0 end) as season,
    (0.90 + (h % 200) / 1000.0) as noise,
    (0.90 + ((h / 3) % 200) / 1000.0) as noise2
  from base
),
calc2 as (
  select *,
    greatest(1, round(base_spend * trend * season * noise))::bigint as spend_mu,
    least(0.06, greatest(0.004, base_ctr * noise2)) as ctr_v,
    greatest(1, round(base_cpc * noise))::bigint as cpc_mu
  from calc
),
calc3 as (
  select *,
    greatest(1, round((spend_mu::numeric / 100) / (cpc_mu::numeric / 100)))::bigint as clicks_v
  from calc2
),
calc4 as (
  select *,
    greatest(clicks_v, round(clicks_v / ctr_v))::bigint as impressions_v
  from calc3
)
insert into public.ads_daily
  (client_id, provider, campaign_id, campaign_name, date,
   spend_minor_units, impressions, clicks, ctr, cpc_minor_units,
   reach, frequency, conversions)
select
  client_id, provider, campaign_id, campaign_name, d,
  spend_mu, impressions_v, clicks_v,
  round(ctr_v * 100, 2) as ctr,
  cpc_mu,
  case when provider = 'meta_ads' then round(impressions_v * 0.72)::bigint else null end as reach,
  case when provider = 'meta_ads'
       then round(impressions_v::numeric / greatest(1, round(impressions_v * 0.72)), 2)
       else null end as frequency,
  round(clicks_v * 0.03)::int as conversions
from calc4;

-- 3) GA4 daily totals: 120 days (source/device/page all NULL = totals row) -----
with c as (select id from public.clients where slug = 'demo'),
days as (
  select generate_series((current_date - interval '119 day')::date, current_date, interval '1 day')::date as d
),
calc as (
  select c.id as client_id, days.d,
    extract(dow from days.d)::int as dow,
    (days.d - (current_date - interval '119 day')::date) as offs,
    (abs(('x' || substr(md5('ga4' || days.d::text), 1, 8))::bit(32)::int) % 1000) as h
  from c cross join days
),
calc2 as (
  select *,
    round(1200 * (1 + offs::numeric / 119 * 0.30)
      * (case when dow in (0,6) then 0.8 else 1.0 end)
      * (0.9 + (h % 200) / 1000.0))::bigint as sessions
  from calc
)
insert into public.ga4_daily
  (client_id, date, sessions, users_new, users_returning, engagement_rate, page_views)
select
  client_id, d, sessions,
  round(sessions * 0.62)::bigint as users_new,
  round(sessions * 0.38)::bigint as users_returning,
  round(0.55 + (h % 120) / 1000.0, 3) as engagement_rate,
  round(sessions * 2.4)::bigint as page_views
from calc2;

-- 4) GA4 breakdowns for the last 30 days (source / device / top pages) ---------
with c as (select id from public.clients where slug = 'demo'),
days as (
  select generate_series((current_date - interval '29 day')::date, current_date, interval '1 day')::date as d
),
src (source_medium, share) as (
  values ('google / organic', 0.30), ('google / cpc', 0.22), ('(direct) / (none)', 0.16),
         ('facebook / cpc', 0.14), ('instagram / social', 0.10), ('newsletter / email', 0.08)
),
dev (device_category, share) as (
  values ('mobile', 0.66), ('desktop', 0.29), ('tablet', 0.05)
),
pg (page_path, share) as (
  values ('/', 0.34), ('/produkty', 0.24), ('/kontakt', 0.16), ('/o-nas', 0.14), ('/blog/poradnik', 0.12)
),
tot as (
  select c.id as client_id, days.d,
    round(1200 * (0.9 + (abs(('x'||substr(md5('b'||days.d::text),1,8))::bit(32)::int) % 200)/1000.0))::bigint as sessions
  from c cross join days
)
insert into public.ga4_daily
  (client_id, date, sessions, page_views, source_medium, device_category, page_path)
select tot.client_id, tot.d, round(tot.sessions * src.share)::bigint,
       round(tot.sessions * src.share * 2.4)::bigint, src.source_medium, null, null
from tot cross join src
union all
select tot.client_id, tot.d, round(tot.sessions * dev.share)::bigint,
       round(tot.sessions * dev.share * 2.4)::bigint, null, dev.device_category, null
from tot cross join dev
union all
select tot.client_id, tot.d, round(tot.sessions * pg.share)::bigint,
       round(tot.sessions * pg.share * 2.4)::bigint, null, null, pg.page_path
from tot cross join pg;

-- 5) Creatives (top ads) with sharp placeholder images ------------------------
with c as (select id from public.clients where slug = 'demo'),
cr (ad_id, campaign_id, name, spend, impr, clicks, ctr, cpc, seed) as (
  values
    ('demo-ad1','demo-m2','DEMO | Wideo | Poradnik montażu 30s',        184050, 210000, 5460, 2.60, 34, 11),
    ('demo-ad2','demo-m3','DEMO | Karuzela | Nowa kolekcja',            152300, 168000, 4200, 2.50, 36, 22),
    ('demo-ad3','demo-m1','DEMO | Grafika | Świadomość marki',          141200, 320000, 2880, 0.90, 49, 33),
    ('demo-ad4','demo-m4','DEMO | Retargeting | Porzucony koszyk',      118900, 96000,  3072, 3.20, 39, 44),
    ('demo-ad5','demo-m2','DEMO | Reels | Opinie klientów',             104500, 142000, 3266, 2.30, 32, 55),
    ('demo-ad6','demo-m3','DEMO | Statyk | Promocja -20%',               96700, 118000, 2596, 2.20, 37, 66),
    ('demo-ad7','demo-m1','DEMO | Wideo | Behind the scenes',            81200, 154000, 1848, 1.20, 44, 77),
    ('demo-ad8','demo-m4','DEMO | Grafika | Bestsellery',                72400, 88000,  2112, 2.40, 34, 88)
)
insert into public.creatives
  (client_id, provider, ad_id, campaign_id, thumbnail_url,
   spend_minor_units, impressions, clicks, ctr, cpc_minor_units, period_start, period_end)
select c.id, 'meta_ads', cr.ad_id, cr.campaign_id,
  'https://picsum.photos/seed/' || cr.seed || '/600/600',
  cr.spend, cr.impr, cr.clicks, cr.ctr, cr.cpc,
  (current_date - interval '29 day')::date, current_date
from c cross join cr
on conflict (client_id, provider, ad_id) do update set
  thumbnail_url = excluded.thumbnail_url,
  spend_minor_units = excluded.spend_minor_units,
  impressions = excluded.impressions,
  clicks = excluded.clicks,
  ctr = excluded.ctr,
  cpc_minor_units = excluded.cpc_minor_units,
  period_start = excluded.period_start,
  period_end = excluded.period_end;

-- 6) Monthly budget (current month) -------------------------------------------
insert into public.client_budgets (client_id, month, platform, budget_minor_units)
select id, date_trunc('month', current_date)::date, 'total', 5000000
from public.clients where slug = 'demo'
on conflict (client_id, month, platform) do update
  set budget_minor_units = excluded.budget_minor_units;

-- 7) A recent AI summary (Polish) ---------------------------------------------
insert into public.ai_summaries (client_id, summary_text, period_start, period_end)
select id,
  'W tym tygodniu ruch z kampanii rośnie - liczba kliknięć wzrosła względem poprzedniego okresu, a CTR utrzymuje się powyżej średniej. Najlepiej pracuje kampania wideo „Poradnik montażu" oraz retargeting porzuconych koszyków. Sesje w GA4 rosną głównie z ruchu płatnego i organicznego z Google. Rekomendacja: zwiększyć budżet na najlepsze kreacje wideo i utrzymać retargeting.',
  (current_date - interval '6 day')::date, current_date
from public.clients where slug = 'demo';

-- =============================================================================
-- DEMO LOGIN  (magic-link account that sees ONLY the demo client)
-- -----------------------------------------------------------------------------
-- 1. Choose a demo email, e.g. demo@patoagencja.com
-- 2. Create the auth user ONCE - either:
--      a) Supabase → Authentication → Users → "Add user" (send invite), OR
--      b) open the app /login, enter the email, click the magic link once.
-- 3. Then run the statement below (edit the email) to scope that user to demo:
--
--   insert into public.users (id, email, client_id, role)
--   select u.id, u.email,
--          (select id from public.clients where slug = 'demo'), 'client'
--   from auth.users u
--   where u.email = 'demo@patoagencja.com'
--   on conflict (id) do update
--     set client_id = excluded.client_id, role = excluded.role;
--
-- That user now logs in via magic link and sees only  /demo  — no other client.
-- To present: send them the magic link (or log in on your screen) and open /demo.
-- =============================================================================
