-- =============================================================================
-- KOMPLET migracji (0037).
-- Wklej w Supabase -> SQL Editor w całości i uruchom. Idempotentne - ponowne
-- uruchomienie niczego nie psuje. Nie zmienia żadnych danych.
--
--   0037  klienci sezonowi (np. sprzedaż od października do Wigilii):
--         kolumna clients.season z oknem sezonu. Włącza widok "Sezon" i
--         dłuższą historię reklam (~15 miesięcy), żeby porównać sezon z
--         całym poprzednim. Ustawiasz w Ustawienia -> Sezon.
-- =============================================================================

-- Seasonal clients (e.g. Christmas products sold October - Christmas Eve):
-- the season window per client, as {"start":"MM-DD","end":"MM-DD"} (an end
-- before the start runs into the next year, e.g. to 6 January). Null = not
-- seasonal. It switches on the "Sezon" view and makes the ad sync keep ~15
-- months of history, so the whole previous season is there to compare with.
--
-- Written by agency users only through Server Actions (service-role client,
-- after the agency guard); read under the existing clients SELECT policies,
-- like logo_url / website_url.

alter table public.clients add column if not exists season jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_season_shape'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_season_shape
      check (
        season is null
        or (
          jsonb_typeof(season) = 'object'
          and season ->> 'start' ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          and season ->> 'end' ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        )
      );
  end if;
end $$;

notify pgrst, 'reload schema';
