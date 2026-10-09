-- Per-campaign totals over a date range, summed in Postgres, for the
-- dashboard's campaign table on long ranges ("Ostatnie 90 dni", "Ostatni
-- rok", long custom ranges). The table shows one row per campaign, yet every
-- cache miss read one row per campaign per DAY and summed in JS: ~285 000
-- rows (tens of MB of JSON, 10-20 s, 100+ MB of memory) for an OLX-size
-- account's year. This returns one row per campaign with exactly what the
-- table, its health status and its sparkline use:
--   - first_date / first_name: the campaign's first day in the range and its
--     name on that day (the table names a campaign after its first row and
--     keeps first-appearance order as the tie-break of its spend sort),
--   - last_name: its latest non-empty name in the range (chart annotations),
--   - spend / clicks / impressions / conversions over the range,
--   - recent_spend / recent_impressions (the range's last 2 days) and
--     earlier_spend (the days before them): the "no impressions in the last
--     48 hours" status,
--   - freq_sum / freq_count: the average daily frequency (fatigue status),
--   - spark: spend on each of the range's last 7 days, oldest first (0 for a
--     day without a row or before p_start).
--
-- security invoker: ads_daily is read with the caller's rights, so RLS
-- applies exactly as on the table. The app falls back to reading rows while
-- this function is missing, so deploying before running it is safe.
-- No data changes; safe to run more than once.

drop function if exists public.campaign_range_totals(uuid, date, date);

create or replace function public.campaign_range_totals(
  p_client_id uuid,
  p_start date,
  p_end date
)
returns table (
  provider text,
  campaign_id text,
  first_date date,
  first_name text,
  last_name text,
  spend_minor_units bigint,
  clicks bigint,
  impressions bigint,
  conversions bigint,
  recent_spend bigint,
  recent_impressions bigint,
  earlier_spend bigint,
  freq_sum numeric,
  freq_count integer,
  spark bigint[]
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    g.provider,
    g.campaign_id,
    g.first_date,
    -- (client_id, provider, campaign_id, date) is unique: one row, found
    -- through that constraint's index instead of carrying every day's name
    -- through the aggregate.
    (
      select f.campaign_name
      from public.ads_daily f
      where f.client_id = p_client_id
        and f.provider = g.provider
        and f.campaign_id = g.campaign_id
        and f.date = g.first_date
    ) as first_name,
    (
      select l.campaign_name
      from public.ads_daily l
      where l.client_id = p_client_id
        and l.provider = g.provider
        and l.campaign_id = g.campaign_id
        and l.date >= p_start
        and l.date <= p_end
        and l.campaign_name <> ''
      order by l.date desc
      limit 1
    ) as last_name,
    g.spend_minor_units,
    g.clicks,
    g.impressions,
    g.conversions,
    g.recent_spend,
    g.recent_impressions,
    g.earlier_spend,
    g.freq_sum,
    g.freq_count,
    g.spark
  from (
    select
      d.provider,
      d.campaign_id,
      min(d.date) as first_date,
      sum(d.spend_minor_units)::bigint as spend_minor_units,
      sum(d.clicks)::bigint as clicks,
      sum(d.impressions)::bigint as impressions,
      coalesce(sum(d.conversions), 0)::bigint as conversions,
      coalesce(sum(d.spend_minor_units) filter (where d.date >= p_end - 1), 0)::bigint as recent_spend,
      coalesce(sum(d.impressions) filter (where d.date >= p_end - 1), 0)::bigint as recent_impressions,
      coalesce(sum(d.spend_minor_units) filter (where d.date < p_end - 1), 0)::bigint as earlier_spend,
      -- Exact (numeric); null when no day has a frequency.
      sum(d.frequency) as freq_sum,
      count(d.frequency)::integer as freq_count,
      array[
        coalesce(sum(d.spend_minor_units) filter (where d.date = p_end - 6), 0),
        coalesce(sum(d.spend_minor_units) filter (where d.date = p_end - 5), 0),
        coalesce(sum(d.spend_minor_units) filter (where d.date = p_end - 4), 0),
        coalesce(sum(d.spend_minor_units) filter (where d.date = p_end - 3), 0),
        coalesce(sum(d.spend_minor_units) filter (where d.date = p_end - 2), 0),
        coalesce(sum(d.spend_minor_units) filter (where d.date = p_end - 1), 0),
        coalesce(sum(d.spend_minor_units) filter (where d.date = p_end), 0)
      ]::bigint[] as spark
    from public.ads_daily d
    where d.client_id = p_client_id
      and d.date >= p_start
      and d.date <= p_end
    group by d.provider, d.campaign_id
  ) g
$$;

comment on function public.campaign_range_totals(uuid, date, date) is
  'Per-campaign totals of ads_daily in [p_start, p_end] for the dashboard campaign table (lib/dashboard/metrics.ts). security invoker: RLS of ads_daily applies.';

revoke all on function public.campaign_range_totals(uuid, date, date) from public, anon;
grant execute on function public.campaign_range_totals(uuid, date, date) to authenticated, service_role;

-- PostgREST picks up the new function without a restart.
notify pgrst, 'reload schema';
