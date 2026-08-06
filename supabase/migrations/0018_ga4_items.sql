-- Per-product (SKU) daily sales from GA4 item-scoped metrics: itemsPurchased +
-- itemRevenue by itemId/itemName. Feeds the "Top produkty" table on the
-- Sprzedaz tab. Synced by refresh-ga4 alongside the daily totals; the cron
-- probes for this table and skips items until the migration has run.
create table if not exists public.ga4_items_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  item_id text not null default '',
  item_name text not null,
  quantity numeric not null default 0,
  revenue_minor_units bigint not null default 0,
  unique (client_id, date, item_id, item_name)
);
create index if not exists ga4_items_daily_client_date_idx
  on public.ga4_items_daily (client_id, date desc);
alter table public.ga4_items_daily enable row level security;
-- Read/written server-side via the service-role client; no public policies.
