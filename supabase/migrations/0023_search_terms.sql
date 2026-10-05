-- "Czego szukają Twoi klienci": what people typed into Google before the
-- client's Google Ads showed up (search_term_view), aggregated over the last
-- 30 days. One snapshot per client per Warsaw day (period_end); the
-- refresh-ads-google cron replaces it at most once a day and skips silently
-- until this migration has run.
--
-- A row with search_term = '' is a "checked today, nothing found" marker so
-- the cron doesn't re-query every 30 min for accounts without Search
-- campaigns. Readers ignore it.
create table if not exists public.google_search_terms (
  id bigserial primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  customer_id text not null,
  search_term text not null,
  campaign_name text not null default '',
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_minor_units bigint not null default 0,
  conversions numeric not null default 0,
  period_end date not null,
  synced_at timestamptz not null default now(),
  unique (client_id, customer_id, search_term, campaign_name, period_end)
);

create index if not exists google_search_terms_client_period_idx
  on public.google_search_terms (client_id, period_end desc);

alter table public.google_search_terms enable row level security;

-- Read scoped by client_id like every other domain table. Writes come only
-- from the cron's service-role client (bypasses RLS), so no write policy.
drop policy if exists google_search_terms_select on public.google_search_terms;
create policy google_search_terms_select on public.google_search_terms
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());
