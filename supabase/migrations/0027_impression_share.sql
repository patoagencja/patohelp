-- "Jak bardzo jesteś widoczny w Google": Search impression share per Google
-- Ads Search campaign over the last 30 days, plus how much of the missed
-- visibility was lost to budget vs ad rank. Gives the client a fact-based way
-- to talk about budget. One snapshot per client per Warsaw day (period_end);
-- the refresh-ads-google cron replaces it at most once a day and skips
-- silently until this migration has run.
--
-- Shares are stored exactly as Google returns them: fractions 0-1, null when
-- Google has too little data. Google caps reporting, so 0.0999 means "<10%"
-- and 0.9001 means ">90%" - readers treat those as approximate.
--
-- A row with campaign_id = '' is a "checked today, no Search campaigns"
-- marker so the cron doesn't re-query every run. Readers ignore it.
create table if not exists public.google_impression_share (
  client_id uuid not null references public.clients (id) on delete cascade,
  customer_id text not null,
  campaign_id text not null,
  campaign_name text not null default '',
  impression_share numeric,
  budget_lost numeric,
  rank_lost numeric,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_minor_units bigint not null default 0,
  period_end date not null,
  synced_at timestamptz not null default now(),
  primary key (client_id, customer_id, campaign_id, period_end)
);

create index if not exists google_impression_share_client_period_idx
  on public.google_impression_share (client_id, period_end desc);

alter table public.google_impression_share enable row level security;

-- Read scoped by client_id like every other domain table. Writes come only
-- from the cron's service-role client (bypasses RLS), so no write policy.
drop policy if exists google_impression_share_select on public.google_impression_share;
create policy google_impression_share_select on public.google_impression_share
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());
