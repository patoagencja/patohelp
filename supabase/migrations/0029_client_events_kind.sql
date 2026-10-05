-- "Co dla Ciebie zrobiliśmy": client_events doubles as the agency work log.
--
-- Existing rows (chart annotations entered by hand) keep working untouched:
-- category stays null (the UI derives one from event_type) and they stay
-- visible. created_by already exists since 0005.
--
-- Idempotent: safe to re-run.

alter table public.client_events
  add column if not exists category text;

-- Internal notes ("klient prosił o wstrzymanie, czekamy na akcept") must be
-- loggable without the client reading them.
alter table public.client_events
  add column if not exists visible_to_client boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_events_category_check'
      and conrelid = 'public.client_events'::regclass
  ) then
    alter table public.client_events
      add constraint client_events_category_check check (
        category is null
        or category in ('kampania', 'kreacja', 'optymalizacja', 'raport', 'strona', 'inne')
      );
  end if;
end
$$;

-- Hidden entries are enforced in the database, not just filtered in the UI:
-- a client user querying Supabase directly must not see them either.
drop policy if exists client_events_select on public.client_events;
create policy client_events_select on public.client_events
  for select to authenticated
  using (
    public.is_agency_user()
    or (client_id = public.current_client_id() and visible_to_client)
  );

-- Write policy (agency only) from 0005 is unchanged.
