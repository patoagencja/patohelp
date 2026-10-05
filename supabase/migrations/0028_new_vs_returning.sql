-- "Nowi czy stali klienci" (e-commerce clients only): GA4 revenue, orders,
-- users and sessions split by newVsReturning ("new" / "returning" /
-- "(not set)"), aggregated over the last 30 full days (30daysAgo..yesterday).
-- One snapshot per client per Warsaw day; refresh-ga4 writes it at most once a
-- day (both "new" and "returning" rows always, zero-filled, so an existing
-- snapshot doubles as the "already synced today" marker) and skips silently
-- until this migration has run.
--
-- Money in grosze like everywhere else. Snapshots are kept (3 tiny rows a
-- day) so the split can later be shown as a trend.
create table if not exists public.ga4_new_vs_returning (
  client_id uuid not null references public.clients (id) on delete cascade,
  snapshot_date date not null,
  segment text not null check (segment in ('new', 'returning', '(not set)')),
  revenue_minor_units bigint not null default 0,
  transactions bigint not null default 0,
  users bigint not null default 0,
  sessions bigint not null default 0,
  synced_at timestamptz not null default now(),
  primary key (client_id, snapshot_date, segment)
);

create index if not exists ga4_new_vs_returning_client_snapshot_idx
  on public.ga4_new_vs_returning (client_id, snapshot_date desc);

alter table public.ga4_new_vs_returning enable row level security;

-- Read scoped by client_id like every other domain table. Writes come only
-- from the cron's service-role client (bypasses RLS), so no write policy.
drop policy if exists ga4_new_vs_returning_select on public.ga4_new_vs_returning;
create policy ga4_new_vs_returning_select on public.ga4_new_vs_returning
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());
