-- ga4_daily is written as one batch mixing daily-total rows (which carry
-- revenue_minor_units / transactions) with dimension snapshot rows (source /
-- device / page) that have no revenue. PostgREST unions the keys across a bulk
-- insert and fills any a row is missing with an EXPLICIT NULL rather than the
-- column default, so the NOT NULL constraint on these columns rejected the
-- whole batch. The writers now backfill 0 on every row, but relaxing NOT NULL
-- makes the write robust to any future heterogeneous insert path.
alter table public.ga4_daily
  alter column revenue_minor_units drop not null;
alter table public.ga4_daily
  alter column transactions drop not null;
