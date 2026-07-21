-- Budget-spike alert configuration on notification_settings.
-- Caps are stored in grosze (bigint minor units), consistent with ads_daily.
-- A single-day spend at or above a cap raises a CRITICAL alert that bypasses
-- the quiet-hours window and the min_severity filter.
alter table public.notification_settings
  add column if not exists daily_spend_cap_minor_units bigint,          -- per-campaign
  add column if not exists account_daily_spend_cap_minor_units bigint,  -- whole account
  add column if not exists spike_multiplier numeric not null default 3; -- day vs trailing avg
