import { NextResponse } from "next/server";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { GET as refreshMeta } from "@/app/api/cron/refresh-ads-meta/route";
import { GET as refreshGoogle } from "@/app/api/cron/refresh-ads-google/route";
import { GET as refreshTiktok } from "@/app/api/cron/refresh-ads-tiktok/route";
import { GET as refreshGa4 } from "@/app/api/cron/refresh-ga4/route";
import { GET as refreshDemographics } from "@/app/api/cron/refresh-demographics/route";
import { GET as refreshCreatives } from "@/app/api/cron/refresh-creatives-meta/route";

// On-demand data refresh triggered from the dashboard (agency users only).
// Runs each provider's refresh IN-PROCESS by calling the cron route handlers
// directly - NOT via HTTP fetch. An internal fetch to the app's own URL could
// land on a different environment that doesn't see freshly-connected clients
// (integrations_processed: 0); calling the handlers in-process always uses this
// deployment's env/DB.
export const dynamic = "force-dynamic";
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

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Brak konfiguracji (CRON_SECRET)" },
      { status: 500 }
    );
  }

  // Build an in-process request carrying the cron auth + client scope, then call
  // each handler directly.
  const mkReq = (job: string) =>
    new Request(
      `https://internal/api/cron/${job}?client=${encodeURIComponent(access.clientId)}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );

  const jobs: Array<[string, (r: Request) => Promise<Response>]> = [
    ["refresh-ads-meta", refreshMeta],
    ["refresh-ads-google", refreshGoogle],
    ["refresh-ads-tiktok", refreshTiktok],
    ["refresh-ga4", refreshGa4],
    ["refresh-demographics", refreshDemographics],
    ["refresh-creatives-meta", refreshCreatives],
  ];

  const results = await Promise.allSettled(
    jobs.map(async ([name, fn]) => {
      const res = await fn(mkReq(name));
      const body = await res.json().catch(() => ({ ok: res.ok }));
      return [name, body] as const;
    })
  );

  const jobResults = Object.fromEntries(
    results.map((r, i) =>
      r.status === "fulfilled" ? r.value : [jobs[i][0], { error: "failed" }]
    )
  );

  return NextResponse.json({ ok: true, jobs: jobResults });
}
