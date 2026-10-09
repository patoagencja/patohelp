import { NextResponse } from "next/server";

import { AD_DAILY_SYNC_PROVIDER } from "@/lib/ab/sync";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET as refreshMeta } from "@/app/api/cron/refresh-ads-meta/route";
import { GET as refreshGoogle } from "@/app/api/cron/refresh-ads-google/route";
import { GET as refreshTiktok } from "@/app/api/cron/refresh-ads-tiktok/route";
import { GET as refreshGa4 } from "@/app/api/cron/refresh-ga4/route";
import { GET as refreshDemographics } from "@/app/api/cron/refresh-demographics/route";
import { GET as refreshCreatives } from "@/app/api/cron/refresh-creatives-meta/route";
import { GET as refreshAdsets } from "@/app/api/cron/refresh-adsets/route";
import { GET as refreshAdsMetaAds } from "@/app/api/cron/refresh-ads-meta-ads/route";

// On-demand data refresh triggered from the dashboard (agency users only).
// Runs each provider's refresh IN-PROCESS by calling the cron route handlers
// directly - NOT via HTTP fetch. An internal fetch to the app's own URL could
// land on a different environment that doesn't see freshly-connected clients
// (integrations_processed: 0); calling the handlers in-process always uses this
// deployment's env/DB.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Answer by this point, whatever is still going: past maxDuration Vercel
// kills the function and the button gets a bare error even when most
// sources were refreshed.
const RESPOND_BY_MS = 280_000;
// A Meta job starts only with at least this much of RESPOND_BY_MS left; a
// job that doesn't start waits for the cron (every 30 minutes).
const MIN_LEFT_TO_START_MS = 45_000;

type JobStatus = "ok" | "failed" | "running" | "deferred";

interface JobSpec {
  name: string;
  /** Polish name of the data source, as the toast lists it. */
  label: string;
  run: (r: Request) => Promise<Response>;
  /** Job-specific query parameters. */
  extra?: string;
  /** sync_runs.provider in which the job records this client's outcome. */
  provider?: string;
  /** A whole-job failure that still answers 200 with ok: true. */
  failedWhen?: (body: Record<string, unknown>) => boolean;
  /** Needs more room than MIN_LEFT_TO_START_MS to be worth starting. */
  minLeftMs?: number;
}

interface JobOutcome {
  status: JobStatus;
  label: string;
  http?: number;
  error?: string;
  /** The handler's own answer (agency-only route; logs of the button). */
  result?: unknown;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// The Meta-heavy jobs read the same ad accounts, and Meta's limits are per
// ad account: started all at once they tripped each other's limits (the cron
// staggers them for the same reason). One after another instead, the most
// visible data first.
const META_CHAIN: JobSpec[] = [
  { name: "refresh-ads-meta", label: "Meta Ads", run: refreshMeta, provider: "meta_ads" },
  {
    name: "refresh-creatives-meta",
    label: "kreacje Meta",
    run: refreshCreatives,
    failedWhen: (b) =>
      num(b.accounts_processed) === 0 && num(b.accounts_failed) + num(b.accounts_throttled) > 0,
  },
  // Creative tests: the handler itself skips clients that aren't shops
  // (answers `skipped`), so it is cheap for them. Fresh mode: today,
  // yesterday and ad statuses only - "Odśwież" must answer quickly, the
  // backfill stays with the 30-minute cron.
  {
    name: "refresh-ads-meta-ads",
    label: "testy kreacji Meta",
    run: refreshAdsMetaAds,
    extra: "&mode=fresh",
    provider: AD_DAILY_SYNC_PROVIDER,
  },
  {
    name: "refresh-demographics",
    label: "demografia",
    run: refreshDemographics,
    failedWhen: (b) => num(b.clients_failed) > 0,
  },
  // Last, and only with room to spare: it may work for minutes on a big
  // account, and the cron's own ad set job runs every tick anyway.
  {
    name: "refresh-adsets",
    label: "zestawy reklam",
    run: refreshAdsets,
    failedWhen: (b) => Array.isArray(b.errors) && b.errors.length > 0 && num(b.rows_upserted) === 0,
    minLeftMs: 120_000,
  },
];

// Other APIs with limits of their own: alongside the Meta chain.
const PARALLEL: JobSpec[] = [
  { name: "refresh-ads-google", label: "Google Ads", run: refreshGoogle, provider: "google_ads" },
  { name: "refresh-ads-tiktok", label: "TikTok Ads", run: refreshTiktok, provider: "tiktok_ads" },
  { name: "refresh-ga4", label: "Google Analytics 4", run: refreshGa4, provider: "ga4" },
];

/** The order sources are listed in for the user. */
const DISPLAY_ORDER: JobSpec[] = [META_CHAIN[0], ...PARALLEL, ...META_CHAIN.slice(1)];

const TIMED_OUT = Symbol("timed out");

/** Run one handler, giving up waiting (not the handler) after `waitMs`. */
async function runJob(job: JobSpec, req: Request, waitMs: number): Promise<JobOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, waitMs));
  });
  try {
    const work = (async () => {
      const res = await job.run(req);
      const body: unknown = await res.json().catch(() => null);
      return { res, body };
    })();
    const settled = await Promise.race([work, timeout]);
    // Still going: its own deadlines end it; this answer can't wait.
    if (settled === TIMED_OUT) return { status: "running", label: job.label };
    const body =
      settled.body && typeof settled.body === "object" && !Array.isArray(settled.body)
        ? (settled.body as Record<string, unknown>)
        : {};
    const failed = !settled.res.ok || body.ok === false || (job.failedWhen?.(body) ?? false);
    return {
      status: failed ? "failed" : "ok",
      label: job.label,
      http: settled.res.status,
      ...(failed && typeof body.error === "string" ? { error: body.error } : {}),
      result: settled.body,
    };
  } catch (err) {
    return {
      status: "failed",
      label: job.label,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The ad and GA4 handlers answer ok: true even when this client's sync
 * failed - the real outcome is the sync_runs row they wrote
 * (resolveSyncOutcome). The newest row of each provider since the refresh
 * began decides; with no row (provider not connected) the answer stands.
 */
async function applySyncRuns(
  clientId: string,
  sinceIso: string,
  outcomes: Record<string, JobOutcome>
): Promise<void> {
  const jobs = DISPLAY_ORDER.filter((j) => j.provider && outcomes[j.name]?.status === "ok");
  if (!jobs.length) return;
  try {
    const { data, error } = await createAdminClient()
      .from("sync_runs")
      .select("provider, status, error_message, started_at")
      .eq("client_id", clientId)
      .in(
        "provider",
        jobs.map((j) => j.provider as string)
      )
      .gte("started_at", sinceIso)
      .order("started_at", { ascending: false });
    if (error) return;
    const newest = new Map<string, { status: string; error_message: string | null }>();
    for (const r of data ?? []) {
      const provider = String(r.provider);
      if (!newest.has(provider)) {
        newest.set(provider, {
          status: String(r.status),
          error_message: (r.error_message as string | null) ?? null,
        });
      }
    }
    for (const job of jobs) {
      const row = newest.get(job.provider as string);
      if (row?.status !== "failed") continue;
      outcomes[job.name] = {
        ...outcomes[job.name],
        status: "failed",
        ...(row.error_message ? { error: row.error_message } : {}),
      };
    }
  } catch {
    // Unreadable: the handlers' own answers stand.
  }
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client");
  if (!clientSlug) {
    return NextResponse.json({ ok: false, error: "Missing client" }, { status: 400 });
  }

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "Brak dostępu" }, { status: access.status });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Brak konfiguracji (CRON_SECRET)" },
      { status: 500 }
    );
  }

  const startedAt = Date.now();
  const left = () => RESPOND_BY_MS - (Date.now() - startedAt);
  // A little before the start: the database clock may trail this one.
  const sinceIso = new Date(startedAt - 2_000).toISOString();

  // Build an in-process request carrying the cron auth + client scope (plus
  // any job-specific parameters), then call each handler directly.
  const mkReq = (job: JobSpec) =>
    new Request(
      `https://internal/api/cron/${job.name}?client=${encodeURIComponent(access.clientId)}${job.extra ?? ""}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );

  const outcomes: Record<string, JobOutcome> = {};

  const runMetaChain = async () => {
    let blocked = false;
    for (const job of META_CHAIN) {
      if (blocked || left() < (job.minLeftMs ?? MIN_LEFT_TO_START_MS)) {
        outcomes[job.name] = { status: "deferred", label: job.label };
        continue;
      }
      const outcome = await runJob(job, mkReq(job), left());
      outcomes[job.name] = outcome;
      // The next job would read the same accounts at the same time as the
      // one still going - exactly what the chain is for.
      if (outcome.status === "running") blocked = true;
    }
  };
  const runOthers = () =>
    Promise.all(
      PARALLEL.map(async (job) => {
        outcomes[job.name] = await runJob(job, mkReq(job), left());
      })
    );

  await Promise.all([runMetaChain(), runOthers()]);
  await applySyncRuns(access.clientId, sinceIso, outcomes);

  const labelsWith = (status: JobStatus) =>
    DISPLAY_ORDER.filter((j) => outcomes[j.name]?.status === status).map((j) => j.label);
  const failed = labelsWith("failed");
  const deferred = labelsWith("deferred");
  const running = labelsWith("running");
  for (const job of DISPLAY_ORDER) {
    const o = outcomes[job.name];
    if (o?.status === "failed") {
      console.error(`[sync/run] ${job.name} failed`, o.error ?? `HTTP ${o.http ?? "?"}`);
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    still_running: running.length > 0,
    failed,
    deferred,
    jobs: outcomes,
  });
}
