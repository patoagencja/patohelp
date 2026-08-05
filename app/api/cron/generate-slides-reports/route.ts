import { NextResponse } from "next/server";

import { POST as runSlidesReports } from "@/app/api/report/slides/route";
import { createAdminClient } from "@/lib/supabase/admin";

// Monthly: generate every client's Google Slides report decks for the month
// that just ended. Runs on the 1st; calls the generator IN-PROCESS per client
// (same pattern as /api/sync/run - an internal HTTP fetch can land on the
// wrong environment).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const admin = createAdminClient();
  // Only clients that actually have active templates.
  const { data: templateClients } = await admin
    .from("report_templates")
    .select("client_id, clients!inner(slug)")
    .eq("active", true);

  const slugs = [
    ...new Set(
      (templateClients ?? []).map(
        (t) => (t.clients as unknown as { slug: string }).slug
      )
    ),
  ];

  const results: Record<string, unknown> = {};
  for (const slug of slugs) {
    try {
      const req = new Request(
        `https://internal/api/report/slides?client=${encodeURIComponent(slug)}`,
        { method: "POST", headers: { Authorization: `Bearer ${secret}` } }
      );
      const res = await runSlidesReports(req);
      results[slug] = await res.json().catch(() => ({ ok: res.ok }));
    } catch (e) {
      results[slug] = { ok: false, error: (e as Error).message };
    }
  }

  return NextResponse.json({ ok: true, clients: results });
}
