-- "Panel w barwach klienta": the client's own logo and an optional accent
-- colour, so the dashboard, the PDF and the board link look like THEIR report.
--
-- Both are optional: null means "keep the default look" (the hard-coded SVG
-- wordmark for known slugs, or the client's name). Set by agency users only,
-- through the settings page Server Action (service-role client), so no new
-- RLS policy is needed - the existing clients SELECT policies already let a
-- client user read their own row, and these are just two more columns of it.

alter table public.clients add column if not exists logo_url text;
alter table public.clients add column if not exists brand_color text;

-- The logo is rendered as <img src> in the panel, on the public board link and
-- in e-mails: https only (no http mixed content, no data:/javascript: URLs),
-- and bounded so a pasted blob can't bloat every page that selects clients.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_logo_url_https'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_logo_url_https
      check (logo_url is null or (logo_url ~ '^https://[^\s]+$' and char_length(logo_url) <= 500));
  end if;
end $$;

-- The colour ends up inside a style attribute (a CSS variable); a strict
-- #rrggbb shape is the only thing that can't smuggle in other CSS.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_brand_color_hex'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_brand_color_hex
      check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;
