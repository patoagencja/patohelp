-- Daily AI/advertising industry news feed ("Newsy" tab). Rows are written by
-- the refresh-news cron (admin client) and read server-side; RLS with no
-- public policy.
create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  published_on date not null,
  category text not null, -- meta | google | tiktok | ai | other
  title text not null,
  summary text not null,
  source_name text,
  source_url text,
  created_at timestamptz not null default now()
);

create index if not exists news_items_published_idx
  on public.news_items (published_on desc, category);

alter table public.news_items enable row level security;
