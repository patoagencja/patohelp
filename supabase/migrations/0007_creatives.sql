-- Ad-level creative performance (Meta only for now; Google Ads creatives are
-- a TODO — their API exposes headlines, not thumbnails, and we skip them in
-- this version). Refreshed by /api/cron/refresh-creatives-meta.
create table if not exists public.creatives (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null check (provider in ('meta_ads', 'google_ads')),
  ad_id text not null,
  ad_name text,
  campaign_id text,
  thumbnail_url text,
  spend_minor_units bigint not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  ctr numeric,
  cpc_minor_units bigint,
  period_start date,
  period_end date,
  updated_at timestamptz not null default now(),
  unique (client_id, provider, ad_id)
);

create index if not exists idx_creatives_client_spend
  on public.creatives (client_id, spend_minor_units desc);

alter table public.creatives enable row level security;

drop policy if exists creatives_select on public.creatives;
create policy creatives_select on public.creatives
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());
