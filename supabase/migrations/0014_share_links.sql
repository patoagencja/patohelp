-- Public, revocable share links for client reports. The token in the URL is
-- the capability - anyone with the link can view that client's report deck
-- (read-only) until the link is revoked. Accessed via the admin client only.
create table if not exists public.share_links (
  token text primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);

create index if not exists share_links_client_idx on public.share_links (client_id);

alter table public.share_links enable row level security;
