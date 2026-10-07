-- =============================================================================
-- ELFI - start w jednym kroku.
-- Wklej CAŁOŚĆ w Supabase -> SQL Editor i uruchom. Idempotentne: ponowne
-- uruchomienie niczego nie psuje i nie zmienia istniejących danych innych
-- klientów.
--
--   1. ALL_RECENT_7  - sezon klienta (kolumna clients.season)
--   2. ALL_RECENT_8  - sprzedaż ze sklepu (API + CSV)
--   3. ALL_RECENT_9  - reklamy Meta dzień po dniu (testy kreacji)
--   4. klient Elfi: sklep, sezon 1 października - 24 grudnia, adres /elfi
--   5. usunięcie klienta MIRACLE (/themiraclemakers) razem z jego danymi
--
-- Po uruchomieniu Elfi jest na liście klientów w panelu. Dalej: Ustawienia
-- Elfi -> podłącz Meta i Google -> zaznacz konta -> wygeneruj klucz API
-- sklepu.
-- =============================================================================


-- ======================= ALL_RECENT_7.sql =======================
-- =============================================================================
-- KOMPLET migracji (0037).
-- Wklej w Supabase -> SQL Editor w całości i uruchom. Idempotentne - ponowne
-- uruchomienie niczego nie psuje. Nie zmienia żadnych danych.
--
--   0037  klienci sezonowi (np. sprzedaż od października do Wigilii):
--         kolumna clients.season z oknem sezonu. Włącza widok "Sezon" i
--         dłuższą historię reklam (~15 miesięcy), żeby porównać sezon z
--         całym poprzednim. Ustawiasz w Ustawienia -> Sezon.
-- =============================================================================

-- Seasonal clients (e.g. Christmas products sold October - Christmas Eve):
-- the season window per client, as {"start":"MM-DD","end":"MM-DD"} (an end
-- before the start runs into the next year, e.g. to 6 January). Null = not
-- seasonal. It switches on the "Sezon" view and makes the ad sync keep ~15
-- months of history, so the whole previous season is there to compare with.
--
-- Written by agency users only through Server Actions (service-role client,
-- after the agency guard); read under the existing clients SELECT policies,
-- like logo_url / website_url.

alter table public.clients add column if not exists season jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_season_shape'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_season_shape
      check (
        season is null
        or (
          jsonb_typeof(season) = 'object'
          and season ->> 'start' ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          and season ->> 'end' ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        )
      );
  end if;
end $$;

notify pgrst, 'reload schema';

-- ======================= ALL_RECENT_8.sql =======================
-- =============================================================================
-- KOMPLET migracji (0038).
-- Wklej w Supabase -> SQL Editor w całości i uruchom. Idempotentne (IF NOT
-- EXISTS / sprawdzenie polityk i ograniczeń) - ponowne uruchomienie niczego
-- nie psuje. Nie zmienia żadnych istniejących danych.
--
--   0038  prawdziwa sprzedaż ze sklepu obok wydatków na reklamy:
--         - tabela shop_sales_daily: zamówienia i przychód brutto (PLN) per
--           dzień, rynek (kraj) i produkt. Zasila ją sklep przez API
--           (POST /api/ingest/sales, co godzinę ostatnie 14 dni) albo plik
--           CSV z historią (Ustawienia -> Sprzedaż sklepu). Z niej liczymy
--           MER = przychód sklepu / wydatki na reklamy.
--         - tabela shop_ingest_keys: klucz API sklepu (w bazie tylko skrót
--           sha256, pełny klucz widać raz - przy generowaniu).
--         RLS: sprzedaż czyta agencja i sam klient; klucze tylko serwer.
--
-- Do czasu uruchomienia tej migracji sekcja "Panel sprzedażowy sklepu" w
-- ustawieniach pokazuje tylko tę instrukcję, a API odpowiada 503.
-- =============================================================================

-- True shop sales next to ad spend. Ad platforms over-attribute (Meta and
-- Google both claim the same order), so a client can feed the orders and
-- revenue its own shop recorded, per day, market (country) and product. That
-- is what MER (shop revenue / total ad spend) is computed from.
--
-- 1. shop_sales_daily: one row per (client, date, market, product). Written
--    by POST /api/ingest/sales (the shop pushes the last 14 days every hour,
--    because pay-later payments land up to 10 days after the order) and by
--    the CSV upload in settings (history, e.g. last season). Each write
--    REPLACES the numbers for its key. market is a country code ('PL', 'DE',
--    'UK', ...) or '' when unknown; product is the shop's product name or ''
--    for "all products". Not null + '' instead of null keeps the primary key
--    usable as the upsert conflict target. Money in PLN minor units (grosze),
--    gross, like the rest of the schema.
-- 2. shop_ingest_keys: one API key per client, stored only as a sha256 hash
--    (the full key is shown once, when it is generated). RLS on with no
--    policies: only the service role (the ingest route and the agency's
--    settings actions) can read or write it.
--
-- Writes to both tables go through the service role only, so neither has
-- insert/update/delete policies. Idempotent: safe to run more than once.

-- ------------------------------------------------------- 1. shop_sales_daily
create table if not exists public.shop_sales_daily (
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  market text not null default '',      -- 'PL' | 'DE' | 'UK' | ... | ''
  product text not null default '',     -- shop product name | '' (all)
  orders integer not null default 0,
  revenue_minor_units bigint not null default 0,  -- gross, PLN grosze
  source text not null default 'api',   -- 'api' | 'csv'
  updated_at timestamptz default now(),
  primary key (client_id, date, market, product)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shop_sales_daily_source_check'
      and conrelid = 'public.shop_sales_daily'::regclass
  ) then
    alter table public.shop_sales_daily
      add constraint shop_sales_daily_source_check
      check (source in ('api', 'csv'));
  end if;
end $$;

create index if not exists shop_sales_daily_client_date_idx
  on public.shop_sales_daily (client_id, date);

alter table public.shop_sales_daily enable row level security;

-- Same rule as ads_daily after 0036: agency sees all, a client user only
-- their own. The helpers sit in sub-selects so Postgres evaluates them once
-- per query instead of once per row.
drop policy if exists shop_sales_daily_select on public.shop_sales_daily;
create policy shop_sales_daily_select on public.shop_sales_daily
  for select to authenticated
  using ((select public.is_agency_user()) or client_id = (select public.current_client_id()));

-- ------------------------------------------------------- 2. shop_ingest_keys
create table if not exists public.shop_ingest_keys (
  client_id uuid primary key references public.clients (id) on delete cascade,
  key_hash text not null unique,        -- sha256 hex of the full key
  key_prefix text not null,             -- e.g. 'kal_live_AbCd', for the UI
  created_at timestamptz default now(),
  last_used_at timestamptz,
  last_rows integer
);

-- Pay-later orders (placed, not paid yet) per day, when the shop sends them:
-- recent days keep growing for ~10 days and the page says how much is
-- still waiting for payment.
alter table public.shop_sales_daily add column if not exists pending_orders integer not null default 0;
alter table public.shop_sales_daily add column if not exists pending_revenue_minor_units bigint not null default 0;

-- Per-key hourly request budget (lib/shop/ingest.ts takeIngestSlot): a leaked
-- key must not be able to loop thousands of writes.
alter table public.shop_ingest_keys add column if not exists rate_window_start timestamptz;
alter table public.shop_ingest_keys add column if not exists rate_count integer not null default 0;

-- No policies on purpose: a key hash is still a credential lookup table.
alter table public.shop_ingest_keys enable row level security;

notify pgrst, 'reload schema';

-- ======================= ALL_RECENT_9.sql =======================
-- =============================================================================
-- KOMPLET migracji (0039).
-- Wklej w Supabase -> SQL Editor w całości i uruchom. Idempotentne - ponowne
-- uruchomienie niczego nie psuje. Nie zmienia żadnych istniejących danych.
--
--   0039  testy kreacji (A/B) dla sklepów:
--         - tabela ads_ad_daily: każda reklama Meta dzień po dniu, z zakupami
--           i ich wartością (w złotych - konta w innej walucie przeliczane po
--           kursie średnim NBP z danego dnia). Uzupełnia ją cron
--           refresh-ads-meta-ads co ~30 minut, TYLKO dla klientów e-commerce
--           (duże konta wizerunkowe nie płacą za ten ciężki odczyt),
--         - w tabeli creatives kolumny: zestaw reklam, nazwa kampanii, status
--           emisji i data utworzenia reklamy (widok testów pomija reklamy już
--           wyłączone),
--         - funkcje ads_ad_daily_days i ads_ad_daily_account_ads (tylko dla
--           serwera): które dni są już pobrane dla każdego konta i jak
--           świeże, oraz które reklamy emitowało każde konto - cron nie musi
--           czytać wszystkich wierszy.
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

-- ============================================================ 4. klient Elfi
insert into public.clients (name, slug, client_type, season)
values ('Elfi', 'elfi', 'ecommerce', '{"start":"10-01","end":"12-24"}'::jsonb)
on conflict (slug) do update
  set client_type = excluded.client_type,
      season = excluded.season;

-- ===================================================== 5. usunięcie MIRACLE
-- Kasuje klienta i wszystko, co do niego należy (integracje, dane reklam,
-- cele, alerty). Konta logowania klienta zostają, ale bez dostępu do niczego.
delete from public.clients where slug = 'themiraclemakers';

select id, name, slug, client_type, season from public.clients order by name;
