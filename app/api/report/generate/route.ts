import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { generatePeriodReport } from "@/lib/ai/report";
import { getWebsiteData } from "@/lib/dashboard/ga4-metrics";
import { getDashboardData, normalizeRange } from "@/lib/dashboard/metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// On-demand AI report for a client + date range. Both agency and client users
// may generate one; tenant isolation is enforced by RLS on the client lookup
// (a client user can only resolve their own client row).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client");
  const range = normalizeRange(searchParams.get("range") ?? undefined);

  if (!clientSlug) {
    return NextResponse.json({ ok: false, error: "Missing client" }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Nie zalogowano" }, { status: 401 });
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", clientSlug)
    .single();
  if (!client) {
    return NextResponse.json({ ok: false, error: "Brak dostępu" }, { status: 403 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Brak konfiguracji ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }

  // Cost guard: this call had NO cache at all - any re-click (agency or the
  // client themselves, since this endpoint is open to both) fired a fresh
  // Sonnet call. One real generation per client+range per day; ?force=1
  // bypasses when a genuinely fresh rewrite is wanted.
  const admin = createAdminClient();
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const cacheKey = `period-report:${range}:${today}`;
  const force = searchParams.get("force") === "1";

  if (!force) {
    const { data: cached } = await admin
      .from("report_cache")
      .select("payload")
      .eq("client_id", client.id)
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (cached?.payload) {
      const summary = (cached.payload as { summary?: string }).summary;
      if (summary) return NextResponse.json({ ok: true, summary, cached: true });
    }
  }

  try {
    const [data, website] = await Promise.all([
      getDashboardData(client.id, range),
      getWebsiteData(client.id),
    ]);
    const summary = await generatePeriodReport(client.name as string, data, website);
    try {
      await admin.from("report_cache").upsert(
        {
          client_id: client.id,
          cache_key: cacheKey,
          payload: { summary },
          generated_at: new Date().toISOString(),
        },
        { onConflict: "client_id,cache_key" }
      );
    } catch {
      // Cache write failing must never block the user from getting their report.
    }
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[report/generate] failed", err);
    return NextResponse.json(
      { ok: false, error: "Nie udało się wygenerować raportu" },
      { status: 500 }
    );
  }
}
