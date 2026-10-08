-- The signup trigger used to hand out a client seat (or the admin role) the
-- moment an auth user row was inserted - before the address was confirmed.
-- Someone who knew an invited e-mail could sign up with it straight through
-- Supabase's public API and inherit that client's data. Every new profile
-- now starts with no access; the app's /auth/callback maps an invitation
-- (or provisions an @patoagencja.com teammate) only after the e-mail link
-- was clicked, i.e. the address was proven.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, role, client_id)
  values (new.id, new.email, 'client', null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
