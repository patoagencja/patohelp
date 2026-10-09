import { cache } from "react";

import { createLimiter, type FetchLane, type Limiter } from "@/lib/supabase/limiter";

// PostgREST silently caps a single select at ~1000 rows. Any query that can
// exceed that (ads_daily over long ranges for large accounts) must paginate,
// or the tail of the result vanishes without an error.
//
// Pages used to be read strictly one after another: a 60-day ads_daily read
// of an OLX-size account (hundreds of campaigns -> ~24 000 rows) was 24
// sequential round trips before the page could render. Now the first page
// also asks PostgREST for the exact total (Prefer: count=exact), and the
// remaining pages are fetched concurrently (a few at a time), then stitched
// back together in offset order - the result is the same array, in the same
// order, as the sequential drain produced.

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
  /** Filled by supabase-js when the request carried Prefer: count=... */
  count?: number | null;
}

const PAGE = 1000;
/** Follow-up pages one fetchAll keeps in flight. */
const PER_CALL_CONCURRENCY = 4;
/**
 * Page requests all fetchAll calls of ONE server request may have in flight.
 * The overview starts a dozen paged reads at once; PostgREST's connection
 * pool is small, so more in flight only queues there (and slows other
 * users) instead of finishing sooner.
 */
const PER_REQUEST_CONCURRENCY = 12;
/**
 * Slots background reads may hold at once. The header bell and the overview
 * start the alert scan (three weeks of every campaign) in the same request
 * as the dashboard read; sharing one FIFO it could take all 12 slots first
 * and the page waited behind a widget that streams in later anyway.
 */
const BACKGROUND_CONCURRENCY = 6;

export type { FetchLane };

export interface FetchOptions {
  /**
   * "background": reads nobody waits on to paint the page (they stream in
   * later). They use at most BACKGROUND_CONCURRENCY of the request's slots,
   * and a freed slot goes to a waiting foreground read first.
   */
  lane?: FetchLane;
}

// Per server request (React `cache` scope). Outside a render (route handlers,
// crons) `cache` doesn't memoize, so each fetchAll gets its own limiter and
// only PER_CALL_CONCURRENCY applies - never shared across users.
const requestLimiter = cache(
  (): Limiter => createLimiter(PER_REQUEST_CONCURRENCY, BACKGROUND_CONCURRENCY)
);

function getLimiter(): Limiter {
  try {
    return requestLimiter();
  } catch {
    return createLimiter(PER_REQUEST_CONCURRENCY, BACKGROUND_CONCURRENCY);
  }
}

/**
 * Ask PostgREST for the exact row count alongside the first page. Duck-typed:
 * supabase-js builders expose setHeader(); anything else (a test double, a
 * pre-built promise) simply pages without the hint.
 */
function requestExactCount(query: unknown): void {
  const q = query as {
    setHeader?: (name: string, value: string) => unknown;
    headers?: { get?: (name: string) => string | null };
  };
  if (typeof q?.setHeader !== "function") return;
  let existing: string | null = null;
  try {
    existing = q.headers?.get?.("Prefer") ?? null;
  } catch {
    existing = null;
  }
  if (existing && /count=/.test(existing)) return;
  q.setHeader("Prefer", existing ? `${existing},count=exact` : "count=exact");
}

/**
 * Drains a range-paginated query. `build` must apply a STABLE total order
 * (e.g. .order("date").order("provider").order("campaign_id")) and then
 * .range(from, to) - concurrent pages are only correct when every row has
 * exactly one position.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: FetchOptions = {}
): Promise<T[]> {
  const limiter = getLimiter();

  const readPage = async (index: number, withCount = false): Promise<PageResult<T>> => {
    const release = await limiter.acquire(options.lane);
    try {
      const query = build(index * PAGE, index * PAGE + PAGE - 1);
      if (withCount) requestExactCount(query);
      const res = await query;
      if (res.error) throw new Error(res.error.message);
      return res;
    } finally {
      release();
    }
  };

  const first = await readPage(0, true);
  const firstRows = first.data ?? [];
  if (firstRows.length < PAGE) return firstRows;

  const pages: T[][] = [firstRows];
  const total = typeof first.count === "number" ? first.count : null;

  // Run `indices` with at most PER_CALL_CONCURRENCY in flight; results land
  // at their own index, so completion order never reorders rows.
  const readMany = async (indices: number[]): Promise<T[][]> => {
    const out: T[][] = new Array(indices.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < indices.length) {
        const k = cursor++;
        out[k] = (await readPage(indices[k])).data ?? [];
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PER_CALL_CONCURRENCY, indices.length) }, worker)
    );
    return out;
  };

  if (total !== null) {
    // Known size: fetch exactly the remaining pages.
    const pageCount = Math.ceil(total / PAGE);
    const rest = Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => i + 1);
    pages.push(...(await readMany(rest)));
    // Rows that landed after the count (a sync writing meanwhile) would sit
    // past the counted pages: keep draining while the last page is full and
    // over the count, the way the sequential loop would have.
    let next = Math.max(pageCount, 1);
    let fetched = pages.reduce((n, p) => n + p.length, 0);
    while (pages[pages.length - 1].length === PAGE && fetched > total) {
      const more = (await readPage(next++)).data ?? [];
      pages.push(more);
      fetched += more.length;
    }
  } else {
    // No count (non-supabase builder): speculative windows of pages.
    let next = 1;
    for (;;) {
      const indices = Array.from({ length: PER_CALL_CONCURRENCY }, (_, i) => next + i);
      const batch = await readMany(indices);
      pages.push(...batch);
      next += PER_CALL_CONCURRENCY;
      if (batch.some((p) => p.length < PAGE)) break;
    }
  }

  // Same stopping rule as the old sequential drain: everything up to and
  // including the first short (or empty) page, nothing after it.
  const out: T[] = [];
  for (const page of pages) {
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/**
 * fetchAll over a date window split into consecutive chunks read in
 * parallel. OFFSET paging makes every page re-walk all the rows before it,
 * so one 72 000-row read costs the database ~36x its size; independent
 * chunks keep offsets small and run side by side. `build` gets each chunk's
 * inclusive [start, end] and must order by date FIRST (then a stable
 * tie-break): chunks are concatenated in date order, so the result is
 * row-for-row what a single read of the whole window returns.
 */
export async function fetchAllByDateChunks<T>(
  start: string,
  end: string,
  chunkDays: number,
  build: (
    chunkStart: string,
    chunkEnd: string
  ) => (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: FetchOptions = {}
): Promise<T[]> {
  if (start > end) return fetchAll(build(start, end), options);
  const DAY = 86_400_000;
  const toMs = (s: string) => Date.parse(`${s}T00:00:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const chunks: Array<[string, string]> = [];
  const endMs = toMs(end);
  for (let s = toMs(start); s <= endMs; s += chunkDays * DAY) {
    const e = Math.min(s + (chunkDays - 1) * DAY, endMs);
    chunks.push([iso(s), iso(e)]);
  }
  const parts = await Promise.all(chunks.map(([s, e]) => fetchAll(build(s, e), options)));
  return parts.flat();
}

/**
 * Page-by-page drain WITHOUT the exact-count hint, for sources that are
 * computed per request (set-returning SQL functions): a count would run the
 * whole aggregation a second time, and speculative parallel pages would run
 * it once per page. Almost always one page; `build` must apply a total order.
 */
export async function fetchAllSequential<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: FetchOptions = {}
): Promise<T[]> {
  const limiter = getLimiter();
  const out: T[] = [];
  for (let index = 0; ; index++) {
    const release = await limiter.acquire(options.lane);
    let rows: T[];
    try {
      const res = await build(index * PAGE, index * PAGE + PAGE - 1);
      if (res.error) throw new Error(res.error.message);
      rows = res.data ?? [];
    } finally {
      release();
    }
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
