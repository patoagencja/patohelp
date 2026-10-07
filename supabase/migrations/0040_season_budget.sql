-- The agency's ad budget for a client's season, as {"total": <grosze>}.
-- Powers "Budżet sezonu": the plan is spread over the season along last
-- season's own spending curve (Black Friday, Mikołajki peaks) and split by
-- market the same way. Null = no budget set. Written by agency users only
-- through Server Actions (service role, after the agency guard); read under
-- the existing clients SELECT policies.

alter table public.clients add column if not exists season_budget jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_season_budget_shape'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_season_budget_shape
      check (
        season_budget is null
        or (
          jsonb_typeof(season_budget) = 'object'
          and jsonb_typeof(season_budget -> 'total') = 'number'
          and (season_budget ->> 'total')::numeric > 0
        )
      );
  end if;
end $$;

notify pgrst, 'reload schema';
