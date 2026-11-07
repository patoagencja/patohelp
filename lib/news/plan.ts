/**
 * Scheduling of the daily "Newsy" feed (refresh-news cron and the manual
 * refresh button): which categories one call may research, how long the
 * research may take, and when a claimed category counts as abandoned.
 *
 * One prasówka per day, from 06:00 Warsaw: every category is researched once
 * (one Claude + web search call), at most MAX_PARALLEL side by side per call,
 * so the scheduler's 30-minute ticks finish the day in two calls. Today's
 * news_runs rows (migration 0044) make that idempotent: a category is claimed
 * before its paid call, so overlapping callers (GitHub tick, Vercel cron,
 * the button) never research it twice, and a claim left by a killed function
 * expires after CLAIM_LEASE_MS instead of blocking the day.
 *
 * Keep runtime imports out of this file: its unit tests run it directly under
 * Node's type stripping, which can't resolve the "@/" alias.
 */

/** No automatic prasówka before this hour (Europe/Warsaw). */
export const NEWS_START_HOUR_PL = 6;

/**
 * Paid research calls per category per day before the cron leaves it for
 * tomorrow. Without a cap a category that kept failing (or kept getting
 * killed) was researched again on every 30-minute tick, all day.
 */
export const MAX_ATTEMPTS_PER_DAY = 2;

/** Categories researched side by side in one call (parallel Claude calls). */
export const MAX_PARALLEL = 2;

/**
 * A "running" claim older than this belongs to a function the platform
 * killed: refresh-news and the refresh button run for at most 300 s
 * (maxDuration), so no live run is this old.
 */
export const CLAIM_LEASE_MS = 6 * 60_000;

/**
 * The research call is aborted this long after the request started. That
 * leaves the function ~50 s of its 300 s maxDuration to save the result, and
 * the scheduler's curl limit (310 s) is above both, so curl never gives up on
 * a call that is still working.
 */
export const RESEARCH_DEADLINE_MS = 250_000;

/** Less time than this left: don't start a paid call that can't finish. */
export const MIN_RESEARCH_MS = 60_000;

/** Scheduler cadence; ties between categories rotate once per tick. */
export const TICK_MS = 30 * 60_000;

export type NewsRunStatus = "running" | "done" | "failed";

/** A news_runs row of today (one per category). */
export interface NewsRunRow {
  category: string;
  status: NewsRunStatus;
  attempts: number;
  started_at: string | null;
}

export interface NewsTarget {
  category: string;
  /** 1 for the day's first research of the category. */
  attempt: number;
  /** Today's row the claim replaces (compare-and-set on it); null = none yet. */
  previous: NewsRunRow | null;
}

export type CategoryStatus = "done" | "running" | "given-up" | "open";

export interface NewsPlanCounts {
  done: string[];
  running: string[];
  given_up: string[];
}

export type NewsPlan =
  | { kind: "before-start" }
  | ({ kind: "research"; targets: NewsTarget[] } & NewsPlanCounts)
  /** Nothing to start: every category is done or given up ("complete"), or
   *  the rest is being researched by another call right now ("busy"). */
  | ({ kind: "idle"; reason: "complete" | "busy" } & NewsPlanCounts);

export interface NewsPlanInput {
  categories: readonly string[];
  /** Hour of the day in Europe/Warsaw (0-23). */
  hourPl: number;
  /** Categories with at least one news_items row for today. */
  withItems: ReadonlySet<string>;
  /** Today's news_runs rows; null when the table can't be read (migration
   *  0044 not applied): no claims and no cap, one category per call. */
  runs: readonly NewsRunRow[] | null;
  now: number;
  /** ?category= and the button: just this one, even if done or over the cap. */
  only?: string | null;
  /** ?force=1: ignore the start hour and the attempts cap. */
  force?: boolean;
  /** Ties start from this index (e.g. the tick number), so with no run rows
   *  a category that never fills can't starve the ones after it. */
  rotation?: number;
  maxParallel?: number;
}

/** A claim that is still owned by a live function. */
export function isLiveClaim(row: NewsRunRow | null | undefined, now: number): boolean {
  if (!row || row.status !== "running" || !row.started_at) return false;
  const started = Date.parse(row.started_at);
  return Number.isFinite(started) && now - started < CLAIM_LEASE_MS;
}

export function categoryStatus(
  row: NewsRunRow | null | undefined,
  hasItems: boolean,
  now: number,
  ignoreCap = false
): CategoryStatus {
  // Before "done": a forced refresh of a filled category is still in flight.
  if (isLiveClaim(row, now)) return "running";
  if (hasItems || row?.status === "done") return "done";
  if (!ignoreCap && row && row.attempts >= MAX_ATTEMPTS_PER_DAY) return "given-up";
  return "open";
}

/** What this call should do. Pure: the route reads the state and acts on it. */
export function planNewsTick(input: NewsPlanInput): NewsPlan {
  const { categories, withItems, runs, now } = input;
  const only = input.only ?? null;
  if (!only && !input.force && input.hourPl < NEWS_START_HOUR_PL) {
    return { kind: "before-start" };
  }

  const byCategory = new Map((runs ?? []).map((r) => [r.category, r]));
  const counts: NewsPlanCounts = { done: [], running: [], given_up: [] };
  const open: Array<{ target: NewsTarget; index: number }> = [];

  categories.forEach((category, index) => {
    const row = byCategory.get(category) ?? null;
    const status = categoryStatus(row, withItems.has(category), now, Boolean(input.force));
    const target = { category, attempt: (row?.attempts ?? 0) + 1, previous: row };
    if (only) {
      // Asked for by name: research it unless a live run already is.
      if (category === only && status !== "running") open.push({ target, index });
      else if (status === "running") counts.running.push(category);
      else if (status === "done") counts.done.push(category);
      else if (status === "given-up") counts.given_up.push(category);
      return;
    }
    if (status === "open") open.push({ target, index });
    else if (status === "running") counts.running.push(category);
    else if (status === "done") counts.done.push(category);
    else counts.given_up.push(category);
  });

  if (open.length === 0) {
    return { kind: "idle", reason: counts.running.length ? "busy" : "complete", ...counts };
  }

  // Never tried first, then the fewest tries; ties start at the rotation.
  const n = Math.max(1, categories.length);
  const rot = (((input.rotation ?? 0) % n) + n) % n;
  open.sort(
    (a, b) =>
      a.target.attempt - b.target.attempt ||
      ((a.index - rot + n) % n) - ((b.index - rot + n) % n)
  );
  // Without run rows there are no claims and no cap: keep to one paid call.
  const limit = runs === null ? 1 : Math.max(1, input.maxParallel ?? MAX_PARALLEL);
  return { kind: "research", targets: open.slice(0, limit).map((o) => o.target), ...counts };
}

/** Milliseconds the research call may take, `elapsedMs` into the request. */
export function researchBudgetMs(elapsedMs: number): number {
  return RESEARCH_DEADLINE_MS - Math.max(0, elapsedMs);
}

/** Categories not done yet after this call (for the response). */
export function remainingAfter(
  categories: readonly string[],
  plan: NewsPlanCounts,
  filled: readonly string[]
): string[] {
  const done = new Set([...plan.done, ...filled]);
  return categories.filter((c) => !done.has(c));
}
