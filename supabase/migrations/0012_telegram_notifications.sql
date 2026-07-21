-- Telegram as an alert channel (free, instant, no business verification).
-- chat_ids are Telegram chat identifiers (personal chat or a group, e.g. -1001234567890).
alter table public.notification_settings
  add column if not exists telegram_enabled boolean not null default false,
  add column if not exists telegram_chat_ids text[] not null default '{}';
