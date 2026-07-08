import { NextResponse } from "next/server";

import { generatePeriodReport } from "@/lib/ai/report";
import { getWebsiteData } from "@/lib/dashboard/ga4-metrics";
import { getDashboardData, normalizeRange } from "@/lib/dashboard/metrics";
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

  try {
    const [data, website] = await Promise.all([
      getDashboardData(client.id, range),
      getWebsiteData(client.id),
    ]);
    const summary = await generatePeriodReport(client.name as string, data, website);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[report/generate] failed", err);
    return NextResponse.json(
      { ok: false, error: "Nie udało się wygenerować raportu" },
      { status: 500 }
    );
  }
}
