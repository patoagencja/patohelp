-- "Strażnik sklepu" part 1: is the client's website up?
--
-- Every 5 minutes, INSIDE Supabase (pg_cron + pg_net, no Vercel function):
--   1. collect the answers to the previous tick's requests (pg_net is async:
--      a request is sent after its transaction commits and its answer lands
--      in net._http_response, so a tick reads what the previous one asked),
--   2. run the state machine per client: DOWN after 3 failed checks in a
--      row (~15 min), UP again after 2 good ones - public.site_guard_apply,
--      the SQL twin of stepSiteState in lib/alerts/site-guard.ts,
--   3. on a state CHANGE only, wake the app once (POST
--      /api/cron/site-guard), which e-mails the client's recipients - so a
--      normal day costs zero Vercel invocations,
--   4. send this tick's requests: GET every clients.website_url (0032) with
--      a 10 s timeout, plus one control request to a known-good URL.
--
-- A check is "ok" on 2xx/3xx (pg_net does not follow redirects, a redirect
-- is an answer). Failed: 5xx, 404 and other 4xx, timeout, DNS/TLS/connection
-- error. No verdict (ok = null, counts neither way): 401/403/429 - a firewall
-- blocking robots, not a dead site -, an answer pg_net lost, and a transport
-- error in a tick whose control request failed too (then the problem is on
-- our side, and every client would get a false "your site is down").
--
-- ONE-TIME SETUP (Supabase -> SQL Editor), after running this file. The
-- secret is never written here (the repository is public):
--
--   select vault.create_secret('<the CRON_SECRET value from Vercel>', 'cron_secret');
--   select vault.create_secret('https://patohelp-two.vercel.app', 'app_url');
--
-- To change one later:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'cron_secret'), '<new value>');
--
-- Without them everything else still runs (checks, state, the Alerty card,
-- the line in Ustawienia); only the e-mail is skipped, and an event still
-- pending (less than 24 h old) goes out once they are added.
--
-- Is it running?
--   select * from cron.job where jobname = 'site-guard';
--   select status, return_message, start_time from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'site-guard')
--     order by start_time desc limit 5;
--   select * from public.site_status;
--   select * from public.site_checks order by checked_at desc limit 20;
-- Stop it: select cron.unschedule('site-guard');
--
-- Idempotent: safe to run more than once (the job is re-scheduled by name,
-- tables and policies are created only when missing).

-- Extensions. Supabase's docs install pg_net into "extensions" and pg_cron
-- into pg_catalog; their objects live in the "net" / "cron" schemas either
-- way. The fallback covers a build whose control file pins the schema.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      create extension pg_net with schema extensions;
    exception when others then
      create extension pg_net;
    end;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension pg_cron with schema pg_catalog;
    exception when others then
      create extension pg_cron;
    end;
  end if;
end $$;

-- One row per tick: the control request ("canary") all of the tick's
-- transport errors are judged against. Internal: RLS on, no policy.
create table if not exists public.site_guard_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  canary_request_id bigint,
  -- true = our network worked; false / null = it did not, or no answer.
  canary_ok boolean,
  resolved_at timestamptz
);

alter table public.site_guard_runs enable row level security;

-- One row per request. Kept 35 days: Ustawienia shows a 30-day uptime.
create table if not exists public.site_checks (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  run_id bigint references public.site_guard_runs (id) on delete set null,
  url text not null,
  checked_at timestamptz not null default now(),
  request_id bigint,            -- pg_net request id = net._http_response.id
  http_status integer,
  -- true = up, false = failed, null = no verdict (or not collected yet).
  ok boolean,
  -- Approximate: pg_net's answer time minus the request time, so it also
  -- holds pg_net's own queue wait.
  latency_ms integer,
  error text,
  resolved_at timestamptz       -- null = answer not collected yet
);

create index if not exists site_checks_client_time_idx
  on public.site_checks (client_id, checked_at desc);
create index if not exists site_checks_unresolved_idx
  on public.site_checks (checked_at) where resolved_at is null;

alter table public.site_checks enable row level security;

-- Same rule as ads_daily: agency sees all, a client user only their own.
drop policy if exists site_checks_select on public.site_checks;
create policy site_checks_select on public.site_checks
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

-- Current state per client (one row per client with a website). The app
-- reads it for the Alerty card and Ustawienia, and clears notify_event once
-- the change is announced.
create table if not exists public.site_status (
  client_id uuid primary key references public.clients (id) on delete cascade,
  url text not null,
  state text not null default 'up' check (state in ('up', 'down')),
  since timestamptz not null default now(),  -- when the current state began
  fail_streak integer not null default 0,    -- failed checks in a row
  ok_streak integer not null default 0,      -- good checks in a row
  streak_since timestamptz,                  -- first check of the current streak
  down_since timestamptz,                    -- first failed check of the current / last outage
  last_checked_at timestamptz,               -- newest collected check (any verdict)
  last_ok boolean,
  last_http_status integer,
  last_error text,
  last_ok_at timestamptz,
  last_fail_at timestamptz,                  -- newest failed check: what the e-mail says
  last_fail_status integer,
  last_fail_error text,
  -- A state change the app has not announced yet ('down' / 'up'); a newer
  -- change replaces an older one. Retried with backoff, dropped after 24 h.
  notify_event text check (notify_event in ('down', 'up')),
  notify_event_at timestamptz,
  notify_attempts integer not null default 0,
  notify_last_attempt_at timestamptz,
  notified_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.site_status enable row level security;

drop policy if exists site_status_select on public.site_status;
create policy site_status_select on public.site_status
  for select to authenticated
  using (public.is_agency_user() or client_id = public.current_client_id());

-- Clients whose website we check. The settings action already refuses IPs,
-- internal names and odd ports (lib/branding/website.ts); this repeats the
-- cheap part, since the request leaves from inside the database: a host
-- ending in a letter TLD (no IPv4/IPv6 literal, no "localhost"), no
-- credentials, port 80/443 only.
create or replace function public.site_guard_targets()
returns table (client_id uuid, url text)
language sql
stable
set search_path = public
as $$
  select c.id, btrim(c.website_url)
  from public.clients c
  where btrim(c.website_url) ~* '^https?://[^/?#:@\s]+\.[a-z][a-z0-9-]{0,62}\.?(:(80|443))?([/?#]|$)'
$$;

-- One collected check -> the client's state. Checks are applied oldest
-- first. Mirrors stepSiteState (lib/alerts/site-guard.ts): keep in step.
create or replace function public.site_guard_apply(
  p_client_id uuid,
  p_url text,
  p_checked_at timestamptz,
  p_ok boolean,
  p_http_status integer,
  p_error text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  s public.site_status%rowtype;
begin
  select * into s from public.site_status where client_id = p_client_id for update;
  -- No row, or the address changed after this request went out.
  if not found or s.url is distinct from p_url then
    return;
  end if;

  s.last_checked_at := p_checked_at;
  s.last_ok := p_ok;
  s.last_http_status := p_http_status;
  s.last_error := p_error;

  if p_ok then
    if s.ok_streak = 0 then s.streak_since := p_checked_at; end if;
    s.ok_streak := s.ok_streak + 1;
    s.fail_streak := 0;
    s.last_ok_at := p_checked_at;
    if s.state = 'down' and s.ok_streak >= 2 then
      -- The outage ended at the first good check of the streak.
      s.state := 'up';
      s.since := s.streak_since;
      s.notify_event := 'up';
      s.notify_event_at := now();
      s.notify_attempts := 0;
      s.notify_last_attempt_at := null;
    end if;
  elsif not p_ok then
    if s.fail_streak = 0 then s.streak_since := p_checked_at; end if;
    s.fail_streak := s.fail_streak + 1;
    s.ok_streak := 0;
    s.last_fail_at := p_checked_at;
    s.last_fail_status := p_http_status;
    s.last_fail_error := p_error;
    if s.state = 'up' and s.fail_streak >= 3 then
      -- The outage started at the first failed check of the streak.
      s.state := 'down';
      s.since := s.streak_since;
      s.down_since := s.streak_since;
      s.notify_event := 'down';
      s.notify_event_at := now();
      s.notify_attempts := 0;
      s.notify_last_attempt_at := null;
    end if;
  end if;
  -- p_ok null: no verdict - it neither breaks nor extends a streak.

  update public.site_status set
    last_checked_at = s.last_checked_at,
    last_ok = s.last_ok,
    last_http_status = s.last_http_status,
    last_error = s.last_error,
    last_ok_at = s.last_ok_at,
    last_fail_at = s.last_fail_at,
    last_fail_status = s.last_fail_status,
    last_fail_error = s.last_fail_error,
    state = s.state,
    since = s.since,
    fail_streak = s.fail_streak,
    ok_streak = s.ok_streak,
    streak_since = s.streak_since,
    down_since = s.down_since,
    notify_event = s.notify_event,
    notify_event_at = s.notify_event_at,
    notify_attempts = s.notify_attempts,
    notify_last_attempt_at = s.notify_last_attempt_at,
    updated_at = now()
  where client_id = p_client_id;
end;
$$;

-- The 5-minute tick (pg_cron job "site-guard").
create or replace function public.site_guard_tick()
returns void
language plpgsql
set search_path = public
as $$
declare
  -- An answer not in net._http_response by then is lost (timeout is 10 s).
  lost_after constant interval := interval '3 minutes';
  timeout_ms constant integer := 10000;
  -- Honest robot name, like other uptime monitors; 401/403/429 from a
  -- firewall that blocks it are "no verdict", never "down".
  user_agent constant text := 'Mozilla/5.0 (compatible; PatoSiteGuard/1.0; +https://patoagencja.com)';
  canary_url constant text := 'https://www.google.com/generate_204';
  c record;
  v_run_id bigint;
  v_secret text;
  v_app_url text;
begin
  -- A manual run during the scheduled one would apply the same answers
  -- twice; the second caller just leaves.
  if not pg_try_advisory_xact_lock(hashtext('public.site_guard_tick')) then
    return;
  end if;

  -- 1a. The control request of earlier ticks: did our own network work?
  update public.site_guard_runs g
  set canary_ok = (
        select coalesce(r.status_code between 200 and 399, false)
        from net._http_response r
        where r.id = g.canary_request_id
      ),
      resolved_at = now()
  where g.resolved_at is null
    and (
      g.started_at < now() - lost_after
      or exists (select 1 from net._http_response r where r.id = g.canary_request_id)
    );

  -- 1b. Answers to the sites' requests -> verdicts, then 2. the state
  -- machine, oldest first. A transport error waits for its tick's control
  -- verdict (or until the answer would count as lost anyway).
  for c in
    with verdicts as (
      select
        k.id,
        r.status_code,
        case
          when r.id is not null
            then greatest(0, round(extract(epoch from (r.created - k.checked_at)) * 1000))::integer
        end as latency_ms,
        case
          when r.id is null then 'no response (pg_net)'
          when r.status_code is not null and r.status_code not between 200 and 399
            then 'HTTP ' || r.status_code
          when r.status_code is null then left(coalesce(nullif(btrim(r.error_msg), ''), 'unknown error'), 300)
        end as error,
        case
          when r.id is null then null
          when r.status_code between 200 and 399 then true
          when r.status_code in (401, 403, 429) then null
          when r.status_code is not null then false
          when g.canary_ok then false
          else null
        end as ok
      from public.site_checks k
      left join net._http_response r on r.id = k.request_id
      left join public.site_guard_runs g on g.id = k.run_id
      where k.resolved_at is null
        and (
          k.checked_at < now() - lost_after
          or (r.id is not null and (r.status_code is not null or g.resolved_at is not null))
        )
    ),
    resolved as (
      update public.site_checks k
      set http_status = v.status_code,
          latency_ms = v.latency_ms,
          error = v.error,
          ok = v.ok,
          resolved_at = now()
      from verdicts v
      where k.id = v.id
      returning k.client_id, k.url, k.checked_at, k.ok, k.http_status, k.error
    )
    select * from resolved order by client_id, checked_at
  loop
    perform public.site_guard_apply(c.client_id, c.url, c.checked_at, c.ok, c.http_status, c.error);
  end loop;

  -- 3a. Follow clients.website_url: a removed address stops the guard, a
  -- changed one starts over (the old address's outage is not this one's).
  delete from public.site_status s
  where not exists (select 1 from public.site_guard_targets() t where t.client_id = s.client_id);

  insert into public.site_status as s (client_id, url)
  select t.client_id, t.url from public.site_guard_targets() t
  on conflict (client_id) do update
  set url = excluded.url,
      state = 'up',
      since = now(),
      fail_streak = 0,
      ok_streak = 0,
      streak_since = null,
      down_since = null,
      last_checked_at = null,
      last_ok = null,
      last_http_status = null,
      last_error = null,
      last_ok_at = null,
      last_fail_at = null,
      last_fail_status = null,
      last_fail_error = null,
      notify_event = null,
      notify_event_at = null,
      notify_attempts = 0,
      notify_last_attempt_at = null,
      updated_at = now()
  where s.url is distinct from excluded.url;

  -- 3b. Wake the app for unannounced changes: one POST for all clients
  -- (the route reads site_status itself). Retried while the event stays
  -- pending: 10, 20, 40, 80 min, then every 2 h; given up after 24 h.
  update public.site_status
  set notify_event = null, notify_event_at = null, notify_attempts = 0, notify_last_attempt_at = null
  where notify_event is not null and notify_event_at < now() - interval '24 hours';

  if exists (
    select 1 from public.site_status
    where notify_event is not null
      and (
        notify_last_attempt_at is null
        or notify_last_attempt_at <= now() + interval '30 seconds'
             - least(interval '5 minutes' * power(2, least(notify_attempts, 10)), interval '2 hours')
      )
  ) then
    -- Vault missing or unreadable = not configured: skip quietly.
    begin
      select
        max(decrypted_secret) filter (where name = 'cron_secret'),
        max(decrypted_secret) filter (where name = 'app_url')
      into v_secret, v_app_url
      from vault.decrypted_secrets
      where name in ('cron_secret', 'app_url');
    exception when others then
      v_secret := null;
      v_app_url := null;
    end;

    if nullif(btrim(v_secret), '') is not null and btrim(v_app_url) ~* '^https://[^/\s]+' then
      perform net.http_post(
        url := rtrim(btrim(v_app_url), '/') || '/api/cron/site-guard',
        body := jsonb_build_object('source', 'site_guard_tick'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || btrim(v_secret)
        ),
        -- The route sends e-mails; a cold start alone can take seconds.
        timeout_milliseconds := 30000
      );
      update public.site_status
      set notify_attempts = notify_attempts + 1, notify_last_attempt_at = now()
      where notify_event is not null
        and (
          notify_last_attempt_at is null
          or notify_last_attempt_at <= now() + interval '30 seconds'
               - least(interval '5 minutes' * power(2, least(notify_attempts, 10)), interval '2 hours')
        );
    end if;
  end if;

  -- 4. This tick's requests (sent when this transaction commits).
  if exists (select 1 from public.site_guard_targets()) then
    insert into public.site_guard_runs (canary_request_id)
    values (net.http_get(url := canary_url, timeout_milliseconds := timeout_ms))
    returning id into v_run_id;

    insert into public.site_checks (client_id, run_id, url, checked_at, request_id)
    select
      t.client_id,
      v_run_id,
      t.url,
      clock_timestamp(),
      net.http_get(
        url := t.url,
        headers := jsonb_build_object(
          'User-Agent', user_agent,
          'Accept', 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
        ),
        timeout_milliseconds := timeout_ms
      )
    from public.site_guard_targets() t;
  end if;

  -- 5. Retention, once an hour (the tick at minute 0-4).
  if extract(minute from now()) < 5 then
    delete from public.site_checks where checked_at < now() - interval '35 days';
    delete from public.site_guard_runs where started_at < now() - interval '35 days';
    -- pg_cron logs every run (288 a day): keep three days of ours.
    begin
      delete from cron.job_run_details d
      using cron.job j
      where j.jobid = d.jobid
        and j.jobname = 'site-guard'
        and d.end_time < now() - interval '3 days';
    exception when others then
      null;
    end;
  end if;
end;
$$;

-- Never callable through the API (PostgREST exposes public functions): only
-- the job (and the owner, by hand) runs these.
revoke all on function public.site_guard_targets() from public, anon, authenticated;
revoke all on function public.site_guard_apply(uuid, text, timestamptz, boolean, integer, text)
  from public, anon, authenticated;
revoke all on function public.site_guard_tick() from public, anon, authenticated;

-- Every 5 minutes. Same name = the existing job is updated, not duplicated.
select cron.schedule('site-guard', '*/5 * * * *', 'select public.site_guard_tick()');
