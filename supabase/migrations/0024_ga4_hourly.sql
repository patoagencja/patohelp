-- "Kiedy Twoi klienci są aktywni": website sessions by day of week x hour of
-- day from GA4 (dayOfWeek + hour, property timezone), aggregated over the
-- last 28 days (28daysAgo..yesterday = exactly 4 of each weekday, so days
-- compare fairly). One snapshot per client per Warsaw day; refresh-ga4 writes
-- it at most once a day (all 168 cells, zero-filled, so an existing snapshot
-- doubles as the "already synced today" marker) and skips silently until this
-- migration has run.
--
-- day_of_week follows GA4: 0 = Sunday .. 6 = Saturday. The UI reorders to
-- Monday-first.
create table if not exists public.ga4_activity_heatmap (
  client_id uuid not null references public.clients (id) on delete cascade,
  snapshot_date date not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  hour smallint not null check (hour between 0 and 23),
  sessions bigint not null default 0,
  engaged_sessions bigint not null default 0,
  synced_at timestamptz not null default now(),
  primary key (client_id, snapshot_date, day_of_week, hour)
);

create index if not exists ga4_activity_heatmap_client_snapshot_idx
  on public.ga4_activity_heatmap (client_id, snapshot_date desc);

alter table public.ga4_activity_heatmap enable row level security;

-- Read scoped by client_id like every other domain table. Writes come only
-- from the cron's service-role client (bypasses RLS), so no write policy.
drop policy if exists ga4_activity_heatmap_select on public.ga4_activity_heatmap;
create policy ga4_activity_heatmap_select on public.ga4_activity_heatmap
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());
