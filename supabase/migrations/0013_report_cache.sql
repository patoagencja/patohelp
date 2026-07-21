-- Cache for generated report payloads (e.g. monthly SM report AI sections),
-- so viewing the report tab doesn't re-run the LLM on every page load.
-- Accessed only via the admin client from server code; RLS with no policy.
create table if not exists public.report_cache (
  client_id uuid not null references public.clients (id) on delete cascade,
  cache_key text not null,
  payload jsonb not null,
  generated_at timestamptz not null default now(),
  primary key (client_id, cache_key)
);

alter table public.report_cache enable row level security;
