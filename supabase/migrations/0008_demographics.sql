-- Demographics snapshots (age / gender / geo) for GA4 and Meta. Written by the
-- refresh-demographics cron as a snapshot dated to the run day, read back as the
-- latest snapshot. Only the service role reads/writes it (report reader uses the
-- admin client), so RLS is enabled with no public policy.
create table if not exists public.demographics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null,        -- 'ga4' | 'meta_ads'
  kind text not null,            -- 'age' | 'gender' | 'geo'
  bucket text not null,          -- '25-34' | 'female' | 'Mazowieckie' | ...
  value bigint not null default 0,
  snapshot_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists demographics_client_idx
  on public.demographics (client_id, provider, kind, snapshot_date desc);

alter table public.demographics enable row level security;
