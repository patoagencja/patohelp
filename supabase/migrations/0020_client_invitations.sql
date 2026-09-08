-- Tenant-safe user provisioning.
--
-- handle_new_user() was MVP logic: every non-admin signup was hard-wired to
-- DRE. Inviting a SUNEW (or any other) client user would have dropped them
-- straight into DRE's dashboard - a tenant isolation break. Access is now
-- driven by an explicit invitation per email, and unknown emails get NO client
-- (fail closed) instead of someone else's data.

create table if not exists public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  client_id uuid not null references public.clients (id) on delete cascade,
  role text not null default 'client' check (role in ('client', 'member', 'admin')),
  created_at timestamptz not null default now(),
  -- One mapping per email; re-inviting updates the target client.
  unique (email)
);

create index if not exists client_invitations_email_idx
  on public.client_invitations (lower(email));

alter table public.client_invitations enable row level security;
-- Managed server-side with the service-role client; no public policies.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_emails text[] := array['daniel@patoagencja.com'];
  invited public.client_invitations%rowtype;
begin
  if new.email = any (admin_emails) then
    insert into public.users (id, email, role, client_id)
    values (new.id, new.email, 'admin', null)
    on conflict (id) do nothing;
    return new;
  end if;

  select * into invited
  from public.client_invitations
  where lower(email) = lower(new.email)
  limit 1;

  if found then
    insert into public.users (id, email, role, client_id)
    values (new.id, new.email, invited.role, invited.client_id)
    on conflict (id) do nothing;
  else
    -- No invitation: create the profile with NO client so RLS resolves nothing.
    -- Better a user who sees an empty dashboard than one who sees another
    -- client's numbers.
    insert into public.users (id, email, role, client_id)
    values (new.id, new.email, 'client', null)
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
