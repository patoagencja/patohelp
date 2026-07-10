-- Notification settings per client + a sent-log for daily deduplication.
-- Managed via agency-guarded actions and the notify-alerts cron (admin client),
-- so RLS is enabled with no public policy.
create table if not exists public.notification_settings (
  client_id uuid primary key references public.clients (id) on delete cascade,
  email_enabled boolean not null default false,
  emails text[] not null default '{}',
  whatsapp_enabled boolean not null default false,
  whatsapp_numbers text[] not null default '{}',
  hour_start int not null default 8,   -- inclusive, Europe/Warsaw
  hour_end int not null default 20,    -- exclusive
  min_severity text not null default 'high', -- 'high' | 'medium'
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
