-- Seed the first (and MVP-only) client, DRE, and wire up automatic user
-- provisioning on magic-link sign-up.
--
-- BEFORE RUNNING: verify the admin email below is correct. Any address in
-- `admin_emails` becomes an agency `admin` (access to every client); everyone
-- else who signs up is provisioned as a `client` scoped to DRE.

insert into public.clients (slug, name)
values ('dre', 'DRE')
on conflict (slug) do nothing;

-- On new auth user, create the matching public.users row. Runs as owner
-- (SECURITY DEFINER) so it can write through RLS.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Agency admins. Swap / extend this list as needed.
  admin_emails text[] := array['daniel@patoagencja.com'];
  dre_client_id uuid;
begin
  select id into dre_client_id from public.clients where slug = 'dre';

  if new.email = any (admin_emails) then
    insert into public.users (id, email, role, client_id)
    values (new.id, new.email, 'admin', null)
    on conflict (id) do nothing;
  else
    -- MVP: non-agency sign-ups belong to DRE. Multi-tenant invitations come
    -- later; until then this keeps client access scoped correctly.
    insert into public.users (id, email, role, client_id)
    values (new.id, new.email, 'client', dre_client_id)
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
