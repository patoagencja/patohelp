-- "Twój tydzień w skrócie": an opt-in weekly e-mail (Monday morning, Warsaw)
-- summarising the previous Mon-Sun week for the client's contacts.
--
-- Separate recipients on purpose: alert e-mails usually go to agency staff,
-- while the weekly digest is meant for the client's marketing managers.
-- Empty weekly_digest_emails = fall back to the alert `emails` list.
--
-- Dedupe reuses notifications_sent with alert_key 'weekly-digest-<ISO week>',
-- so no new table is needed.
alter table public.notification_settings
  add column if not exists weekly_digest_enabled boolean not null default false,
  add column if not exists weekly_digest_emails text[] not null default '{}';
