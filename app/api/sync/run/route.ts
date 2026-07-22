import { NextResponse } from "next/server";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";

// On-demand data refresh triggered from the dashboard (agency users only).
// Re-uses the cron endpoints server-side with the CRON_SECRET so we don't
// duplicate the sync logic.
export const dynamic = "force-dynamic";
// Waits on the Meta/Google/GA4 cron endpoints, whose per-day backfills can take
// a few minutes for large accounts.
export const maxDuration = 300;

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

  const base = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    return NextResponse.json(
      { ok: false, error: "Brak konfiguracji (NEXT_PUBLIC_APP_URL / CRON_SECRET)" },
      { status: 500 }
    );
  }

  const headers = { Authorization: `Bearer ${secret}` };
  const jobs = [
    "refresh-ads-meta",
    "refresh-ads-google",
    "refresh-ads-tiktok",
    "refresh-ga4",
    "refresh-demographics",
    "refresh-creatives-meta",
  ];

  // Scope the sync to just this client so large accounts don't compete with
  // other clients in one function invocation (avoids timeouts).
  //
  // Wait at most ~45s per job: each cron endpoint is its own invocation and
  // keeps running to completion even after we stop waiting, so a year-long
  // backfill doesn't kill THIS request (which used to surface as a false
  // "refresh failed" toast after 300s).
  const WAIT_MS = 45_000;
  const clientParam = `?client=${access.clientId}`;
  const results = await Promise.allSettled(
    jobs.map(async (job) => {
      const req = fetch(`${base}/api/cron/${job}${clientParam}`, {
        headers,
        cache: "no-store",
      }).then((r) => r.json().catch(() => ({ ok: r.ok })));
      const timeout = new Promise<{ ok: true; status: string }>((resolve) =>
        setTimeout(() => resolve({ ok: true, status: "running_in_background" }), WAIT_MS)
      );
      return Promise.race([req, timeout]);
    })
  );

  const jobResults = Object.fromEntries(
    jobs.map((job, i) => [
      job,
      results[i].status === "fulfilled"
        ? (results[i] as PromiseFulfilledResult<unknown>).value
        : { error: "failed" },
    ])
  );
  const stillRunning = Object.values(jobResults).some(
    (r) => (r as { status?: string }).status === "running_in_background"
  );

  return NextResponse.json({ ok: true, still_running: stillRunning, jobs: jobResults });
}
