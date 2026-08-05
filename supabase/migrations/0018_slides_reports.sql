-- Monthly Google Slides report automation (OLX: 14 per-segment decks).
--
-- report_templates: one row per recurring deck. `template_presentation_id` is
-- a Google Slides file pre-tokenized with {{placeholders}}; every month we
-- copy it via Drive API, replaceAllText the tokens with that month's Meta +
-- Google numbers filtered by `campaign_filter`, and record the copy in
-- report_runs.

-- Slides/Drive OAuth lives in integrations like the other providers.
alter table public.integrations
  drop constraint if exists integrations_provider_check;
alter table public.integrations
  add constraint integrations_provider_check
  check (provider in ('meta_ads', 'google_ads', 'ga4', 'tiktok_ads', 'google_slides'));

-- oauth_states was never widened past the original three providers, which
-- also silently broke the TikTok connect flow - fix both here.
alter table public.oauth_states
  drop constraint if exists oauth_states_provider_check;
alter table public.oauth_states
  add constraint oauth_states_provider_check
  check (provider in ('meta_ads', 'google_ads', 'ga4', 'tiktok_ads', 'google_slides'));

create table if not exists public.report_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,                       -- e.g. "Goods CEP"
  template_presentation_id text not null,   -- tokenized Slides file id
  -- Which campaigns feed this deck: case-insensitive substrings matched
  -- against campaign_name; a campaign counts when it contains EVERY entry in
  -- `all_of` and (if non-empty) at least one entry in `any_of`.
  campaign_filter jsonb not null default '{"all_of": [], "any_of": []}'::jsonb,
  drive_folder_id text,                     -- destination folder for copies (optional)
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.report_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.report_templates(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null,                      -- YYYY-MM the numbers cover
  presentation_id text,                     -- the generated copy
  presentation_url text,
  status text not null default 'ok' check (status in ('ok', 'error')),
  error text,
  created_at timestamptz not null default now(),
  unique (template_id, month)
);

alter table public.report_templates enable row level security;
alter table public.report_runs enable row level security;

-- Agency-only feature: clients never see these decks in-app.
create policy "report_templates agency read" on public.report_templates
  for select using (public.is_agency_user());
create policy "report_templates agency write" on public.report_templates
  for all using (public.is_agency_user());
create policy "report_runs agency read" on public.report_runs
  for select using (public.is_agency_user());
create policy "report_runs agency write" on public.report_runs
  for all using (public.is_agency_user());
