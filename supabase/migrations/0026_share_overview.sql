-- "Udostępnij zarządowi": share_links now also carries read-only overview
-- links (/s/<token>), not just report decks (/r/<token>). Existing rows keep
-- working as report links thanks to the 'report' default.
--
-- The table stays service-role only (RLS on, no policies): the public pages
-- look tokens up through the admin client, and the agency settings page
-- creates/revokes them through server actions guarded by
-- requireAgencyClientAccess. Never add an anon/authenticated SELECT policy -
-- the token column IS the credential.

alter table public.share_links
  add column if not exists kind text not null default 'report';

-- Guarded so the migration can be re-run safely (no IF NOT EXISTS for
-- constraints in Postgres).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'share_links_kind_check'
  ) then
    alter table public.share_links
      add constraint share_links_kind_check check (kind in ('report', 'overview'));
  end if;
end $$;

-- NULL = never expires. Checked by the public page on every request.
alter table public.share_links
  add column if not exists expires_at timestamptz;

-- Audit trail: who minted the link, when it was killed and whether it is
-- actually being opened (helps decide whether a leaked link needs revoking).
alter table public.share_links
  add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.share_links
  add column if not exists revoked_at timestamptz;
alter table public.share_links
  add column if not exists last_viewed_at timestamptz;

create index if not exists share_links_client_kind_active_idx
  on public.share_links (client_id, kind)
  where not revoked;
