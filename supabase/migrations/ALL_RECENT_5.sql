-- =============================================================================
-- KOMPLET migracji (0035).
-- Wklej w Supabase -> SQL Editor w całości i uruchom. Wszystko jest
-- idempotentne (ograniczenia CHECK są usuwane i tworzone od nowa), więc
-- ponowne uruchomienie niczego nie psuje.
--
--   0035  TikTok Ads jako dostawca: 'tiktok_ads' dozwolone w oauth_states,
--         integrations i ads_daily (bez tego połączenie TikToka i zapis
--         danych TikToka są odrzucane przez bazę)
-- =============================================================================

-- ---------------------------------------------------------------- 0035_tiktok_provider.sql
-- Allow 'tiktok_ads' as a provider.
--
-- The TikTok integration (connect/callback routes, refresh-ads-tiktok cron)
-- writes provider = 'tiktok_ads' into oauth_states, integrations and
-- ads_daily, but the CHECK constraints from 0001/0004 only allow
-- meta_ads / google_ads (/ ga4). Without this, "Połącz TikTok" fails at the
-- oauth_states insert and every TikTok row is rejected by ads_daily.
--
-- Idempotent: every CHECK on these tables that mentions `provider` is dropped
-- (whatever its name - it may have been altered by hand) and recreated with
-- all previous values plus 'tiktok_ads'. Safe to run more than once.

do $$
declare
  c record;
begin
  for c in
    select rel.relname as tbl, con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname in ('integrations', 'oauth_states', 'ads_daily')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%provider%'
  loop
    execute format('alter table public.%I drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.integrations
  add constraint integrations_provider_check
  check (provider in ('meta_ads', 'google_ads', 'ga4', 'tiktok_ads'));

alter table public.oauth_states
  add constraint oauth_states_provider_check
  check (provider in ('meta_ads', 'google_ads', 'ga4', 'tiktok_ads'));

alter table public.ads_daily
  add constraint ads_daily_provider_check
  check (provider in ('meta_ads', 'google_ads', 'tiktok_ads'));
