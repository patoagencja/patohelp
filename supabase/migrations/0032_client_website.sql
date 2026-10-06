-- "Pobierz branding ze strony klienta": the client's public website, so the
-- agency can pull the logo and brand colour from it instead of hunting for
-- them by hand (settings page + the bulk button on /clients).
--
-- Optional: null means "we don't know the website yet". Written by agency
-- users only through Server Actions (service-role client, after the agency
-- guard), so no new RLS policy is needed - the existing clients SELECT
-- policies cover reading it, like logo_url / brand_color from 0031.

alter table public.clients add column if not exists website_url text;

-- The server fetches this URL, so keep it to a plain http(s) address with a
-- host and no whitespace, bounded in size. SSRF protection (private ranges,
-- ports, redirects) lives in lib/branding/fetch.ts - a regex can't check
-- where a hostname resolves to.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_website_url_http'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_website_url_http
      check (
        website_url is null
        or (website_url ~* '^https?://[^\s/?#]+[^\s]*$' and char_length(website_url) <= 300)
      );
  end if;
end $$;
