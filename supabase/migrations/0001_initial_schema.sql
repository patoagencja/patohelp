-- Pato Client Dashboard — initial schema.
-- Multi-tenant from day 1: every domain table carries client_id.
-- Money is stored as bigint minor units (grosze); timestamps are UTC.

create extension if not exists "pgcrypto";

-- Clients (tenants). MVP has a single client (DRE) but the model is multi-tenant.
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

-- App users. id mirrors auth.users(id). Agency users (admin/member) have a
-- null client_id and can see every client; client users are scoped to one.
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  client_id uuid references public.clients (id) on delete set null,
  role text not null check (role in ('admin', 'member', 'client')),
  created_at timestamptz not null default now()
);

-- Per-client integration credentials. credentials_encrypted holds AES-256-GCM
-- ciphertext (see lib/integrations/encryption.ts); never store raw tokens.
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null check (provider in ('meta_ads', 'google_ads', 'ga4')),
  credentials_encrypted text,
  account_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider)
);

-- Normalized daily ad metrics from Meta + Google Ads.
create table if not exists public.ads_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null check (provider in ('meta_ads', 'google_ads')),
  campaign_id text not null,
  campaign_name text,
  date date not null,
  spend_minor_units bigint not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  ctr numeric,
  cpc_minor_units bigint,
  reach bigint,
  frequency numeric,
  conversions integer,
  raw_data jsonb,
  created_at timestamptz not null default now(),
  unique (client_id, provider, campaign_id, date)
);

create index if not exists ads_daily_client_date_idx
  on public.ads_daily (client_id, date);

-- Normalized daily GA4 metrics. One row per dimension breakdown per day.
create table if not exists public.ga4_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  sessions bigint not null default 0,
  users_new bigint not null default 0,
  users_returning bigint not null default 0,
  engagement_rate numeric,
  source_medium text,
  device_category text,
  page_path text,
  page_views bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ga4_daily_client_date_idx
  on public.ga4_daily (client_id, date);

-- Daily AI narrative summaries (Polish), one visible per client per period.
create table if not exists public.ai_summaries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  generated_at timestamptz not null default now(),
  summary_text text not null,
  period_start date not null,
  period_end date not null
);

create index if not exists ai_summaries_client_generated_idx
  on public.ai_summaries (client_id, generated_at desc);

-- Observability for cron pulls.
create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  error_message text
);

create index if not exists sync_runs_client_started_idx
  on public.sync_runs (client_id, started_at desc);

-- Keep integrations.updated_at fresh on write.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists integrations_set_updated_at on public.integrations;
create trigger integrations_set_updated_at
  before update on public.integrations
  for each row
  execute function public.set_updated_at();
