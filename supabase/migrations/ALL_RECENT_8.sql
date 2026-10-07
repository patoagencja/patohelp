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
