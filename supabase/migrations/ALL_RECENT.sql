-- =============================================================================
-- KOMPLET migracji dla funkcji z ostatnich dni (0008-0015).
-- Bezpieczny do wklejenia w Supabase -> SQL Editor w całości: wszystko jest
-- idempotentne (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), więc można odpalać
-- wielokrotnie bez skutków ubocznych.
-- =============================================================================

-- 0008 — Demografia (wiek / płeć / geo) z GA4 i Meta
create table if not exists public.demographics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null,
  kind text not null,
  bucket text not null,
  value bigint not null default 0,
  snapshot_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists demographics_client_idx
  on public.demographics (client_id, provider, kind, snapshot_date desc);
alter table public.demographics enable row level security;

-- 0009 — Cele kampanii (pacing / "nie dowozi")
create table if not exists public.campaign_flights (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  campaign_id text not null,
  campaign_name text,
  provider text,
  target_metric text not null,
  target_value bigint not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists campaign_flights_client_idx
  on public.campaign_flights (client_id);
alter table public.campaign_flights enable row level security;

-- 0010 — Ustawienia powiadomień + log wysłanych alertów
create table if not exists public.notification_settings (
  client_id uuid primary key references public.clients (id) on delete cascade,
  email_enabled boolean not null default false,
  emails text[] not null default '{}',
  whatsapp_enabled boolean not null default false,
  whatsapp_numbers text[] not null default '{}',
  hour_start int not null default 8,
  hour_end int not null default 20,
  min_severity text not null default 'high',
  updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;

create table if not exists public.notifications_sent (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  alert_key text not null,
  sent_on date not null,
  created_at timestamptz not null default now(),
  unique (client_id, alert_key, sent_on)
);
alter table public.notifications_sent enable row level security;

-- 0011 — Progi alertów budżetowych
alter table public.notification_settings
  add column if not exists daily_spend_cap_minor_units bigint,
  add column if not exists account_daily_spend_cap_minor_units bigint,
  add column if not exists spike_multiplier numeric not null default 3;

-- 0012 — Telegram jako kanał alertów
alter table public.notification_settings
  add column if not exists telegram_enabled boolean not null default false,
  add column if not exists telegram_chat_ids text[] not null default '{}';

-- 0013 — Cache raportu SM (opisy AI)
create table if not exists public.report_cache (
  client_id uuid not null references public.clients (id) on delete cascade,
  cache_key text not null,
  payload jsonb not null,
  generated_at timestamptz not null default now(),
  primary key (client_id, cache_key)
);
alter table public.report_cache enable row level security;

-- 0014 — Publiczne linki do raportu
create table if not exists public.share_links (
  token text primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);
create index if not exists share_links_client_idx on public.share_links (client_id);
alter table public.share_links enable row level security;

-- 0015 — Feed newsów
create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  published_on date not null,
  category text not null,
  title text not null,
  summary text not null,
  source_name text,
  source_url text,
  created_at timestamptz not null default now()
);
create index if not exists news_items_published_idx
  on public.news_items (published_on desc, category);
alter table public.news_items enable row level security;

-- Opcjonalnie: czysty slug dla OLX (jeśli był wklejony jako URL)
update public.clients set slug = 'olx' where slug = 'https-www-olx-pl';
