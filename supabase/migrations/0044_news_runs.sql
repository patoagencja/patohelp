-- One row per day and category of the "Newsy" feed: who is researching it,
-- how many paid research calls (Claude + web search) it took, how it ended.
-- The refresh-news cron and the refresh button claim a category here BEFORE
-- the call (the primary key / a guarded update lets exactly one caller win),
-- so overlapping callers never pay for the same category twice; a category
-- gets at most two calls a day; a "running" row older than the lease belongs
-- to a killed function and is taken over (lib/news/plan.ts). Until this runs,
-- the routes work without claims or the cap, one category per call.
-- Written by the service role only: RLS on, no policy.
create table if not exists public.news_runs (
  published_on date not null,
  category text not null,
  status text not null check (status in ('running', 'done', 'failed')),
  attempts integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items integer,
  error text,
  primary key (published_on, category)
);

alter table public.news_runs enable row level security;
