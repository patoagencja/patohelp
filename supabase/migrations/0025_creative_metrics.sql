-- Richer per-ad creative insight for the "Kreacje" tab: Meta's ad relevance
-- diagnostics (rankings), reach/frequency for fatigue detection, and video
-- retention counts for hook / hold / completion rates.
--
-- Every column is nullable on purpose: NULL means "Meta did not report it"
-- (e.g. video columns on a static image ad, rankings below 500 impressions),
-- which the UI must keep distinct from a real zero.
--
-- Safe to re-run. The sync (/api/cron/refresh-creatives-meta) probes for
-- these columns and keeps working without them until this migration runs.

alter table public.creatives
  add column if not exists reach bigint,
  add column if not exists frequency numeric,
  -- Raw Meta enum strings: ABOVE_AVERAGE, AVERAGE, BELOW_AVERAGE_35,
  -- BELOW_AVERAGE_20, BELOW_AVERAGE_10, UNKNOWN. Kept raw (no check
  -- constraint) so a new value from Meta never fails the whole upsert.
  add column if not exists quality_ranking text,
  add column if not exists engagement_rate_ranking text,
  add column if not exists conversion_rate_ranking text,
  -- video_play_actions: plays started (autoplay counts, so ~= impressions).
  add column if not exists video_plays bigint,
  -- actions[action_type = video_view]: Meta's "3-second video plays".
  add column if not exists video_3s_views bigint,
  -- video_thruplay_watched_actions: watched to completion or 15s+.
  add column if not exists video_thruplays bigint,
  add column if not exists video_p25 bigint,
  add column if not exists video_p50 bigint,
  add column if not exists video_p75 bigint,
  add column if not exists video_p100 bigint,
  add column if not exists video_avg_watch_seconds numeric;
