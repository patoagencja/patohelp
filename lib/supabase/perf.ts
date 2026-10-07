import { cache } from "react";
import { headers } from "next/headers";

// Dev-only query instrumentation, off unless PERF_LOG=1. Every Supabase
// client created by lib/supabase/server.ts and lib/supabase/admin.ts routes
// its HTTP calls through perfFetch(), which counts round trips, rows and
// time per server request and prints one summary line when the request's
// queries go quiet:
//
//   [perf] /olx?range=90d  41 queries  38 512 rows  wall 1 840 ms  (summed 6 210 ms)
//          ads_daily 30q/36 400r · ga4_daily 6q/240r · ... · dashboard MISS · alerts hit
//
// "wall" = first query start to last query end; "summed" = all query times
// added up (how much parallelism saved).
//
// PERF_LOG=2 also prints every query as it finishes.

const LEVEL = Number(process.env.PERF_LOG ?? 0) || 0;
export const PERF_ENABLED = LEVEL > 0;

interface TableStats {
  queries: number;
  rows: number;
  ms: number;
}

interface RequestStats {
  label: string | null;
  queries: number;
  rows: number;
  ms: number;
  firstStart: number;
  lastEnd: number;
  inflight: number;
  tables: Map<string, TableStats>;
  notes: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

function newStats(): RequestStats {
  return {
    label: null,
    queries: 0,
    rows: 0,
    ms: 0,
    firstStart: 0,
    lastEnd: 0,
    inflight: 0,
    tables: new Map(),
    notes: [],
    timer: null,
  };
}

// One stats object per server request (React cache scope). Outside a render
// (route handlers) every client gets its own - still useful, just narrower.
const requestStats = cache(newStats);

function currentStats(): RequestStats {
  try {
    return requestStats();
  } catch {
    return newStats();
  }
}

function labelFor(stats: RequestStats): string {
  if (stats.label) return stats.label;
  try {
    // Set by middleware.ts when PERF_LOG is on. headers() throws outside a
    // request and inside unstable_cache callbacks - then we try again later.
    stats.label = headers().get("x-perf-path");
  } catch {
    // keep trying on later queries
  }
  return stats.label ?? "(request)";
}

const fmtInt = (n: number) => Math.round(n).toLocaleString("pl-PL");

function flush(stats: RequestStats) {
  stats.timer = null;
  if (stats.queries === 0) return;
  const tables = Array.from(stats.tables.entries())
    .sort((a, b) => b[1].rows - a[1].rows || b[1].queries - a[1].queries)
    .map(([t, s]) => `${t} ${s.queries}q/${fmtInt(s.rows)}r`)
    .join(" · ");
  const notes = stats.notes.length ? ` · ${stats.notes.join(" · ")}` : "";
  console.log(
    `[perf] ${labelFor(stats)}  ${stats.queries} queries  ${fmtInt(stats.rows)} rows  ` +
      `wall ${fmtInt(stats.lastEnd - stats.firstStart)} ms  (summed ${fmtInt(stats.ms)} ms)\n` +
      `       ${tables}${notes}`
  );
  // Later activity in the same request (streamed sections) starts a new line.
  stats.queries = 0;
  stats.rows = 0;
  stats.ms = 0;
  stats.tables = new Map();
  stats.notes = [];
}

function schedule(stats: RequestStats) {
  if (stats.timer) clearTimeout(stats.timer);
  if (stats.inflight > 0) return;
  stats.timer = setTimeout(() => flush(stats), 400);
}

/** Free-form note on the current request's summary line (cache hits etc.). */
export function perfNote(note: string): void {
  if (!PERF_ENABLED) return;
  const stats = currentStats();
  stats.notes.push(note);
  schedule(stats);
}

function describe(url: string): string {
  try {
    const u = new URL(url);
    const rest = u.pathname.match(/\/rest\/v1\/(?:rpc\/)?([^/?]+)/);
    if (rest) return u.pathname.includes("/rpc/") ? `rpc:${rest[1]}` : rest[1];
    const auth = u.pathname.match(/\/auth\/v1\/([^/?]+)/);
    if (auth) return `auth:${auth[1]}`;
    return u.pathname;
  } catch {
    return "?";
  }
}

/** Rows in a PostgREST response, from Content-Range ("0-999/24000"). */
function rowsOf(res: Response): number {
  const range = res.headers.get("content-range");
  if (!range) return 0;
  const m = range.match(/^(\d+)-(\d+)/);
  return m ? Number(m[2]) - Number(m[1]) + 1 : 0;
}

/**
 * A fetch for createClient()/createAdminClient() - undefined (the default
 * fetch) unless PERF_LOG is set, so production pays nothing.
 */
export function perfFetch(kind: "rls" | "admin"): typeof fetch | undefined {
  if (!PERF_ENABLED) return undefined;
  const stats = currentStats();
  return async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const t0 = performance.now();
    if (stats.queries === 0 && stats.inflight === 0) stats.firstStart = t0;
    stats.inflight += 1;
    if (!stats.label) labelFor(stats);
    if (stats.timer) {
      clearTimeout(stats.timer);
      stats.timer = null;
    }
    try {
      const res = await fetch(input, init);
      const ms = performance.now() - t0;
      const table = describe(url);
      const rows = rowsOf(res);
      stats.queries += 1;
      stats.rows += rows;
      stats.ms += ms;
      stats.lastEnd = performance.now();
      const t = stats.tables.get(table) ?? { queries: 0, rows: 0, ms: 0 };
      t.queries += 1;
      t.rows += rows;
      t.ms += ms;
      stats.tables.set(table, t);
      if (LEVEL >= 2) {
        console.log(
          `[perf]   ${kind.padEnd(5)} ${table.padEnd(22)} ${String(rows).padStart(5)} rows ` +
            `${fmtInt(ms).padStart(6)} ms  ${res.headers.get("content-range") ?? ""}`
        );
      }
      return res;
    } finally {
      stats.inflight -= 1;
      schedule(stats);
    }
  };
}
