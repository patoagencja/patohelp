-- Campaign flights: a target metric + value over a defined window, so we can
-- flag "nie dowozi" (underdelivering vs linear pace) mid-flight. Read/written
-- via the admin client (agency-guarded actions), so RLS is on with no policy.
create table if not exists public.campaign_flights (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  campaign_id text not null,
  campaign_name text,
  provider text,                 -- 'meta_ads' | 'google_ads'
  target_metric text not null,   -- 'clicks' | 'impressions' | 'spend' | 'conversions'
  target_value bigint not null,  -- spend in grosze; other metrics raw counts
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists campaign_flights_client_idx
  on public.campaign_flights (client_id);

alter table public.campaign_flights enable row level security;
