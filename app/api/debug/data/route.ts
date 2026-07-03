import { NextResponse } from "next/server";

import { getDashboardData } from "@/lib/dashboard/metrics";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Diagnostic: how deep is the ads data, and does the data layer differentiate
// date ranges? Agency-only. Visit /api/debug/data?client=dre while logged in.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client") ?? "dre";

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    return NextResponse.json({ error: "Brak dostępu" }, { status: access.status });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("ads_daily")
    .select("date, provider, spend_minor_units")
    .eq("client_id", access.clientId)
    .order("date", { ascending: true });

  const dates = new Set((rows ?? []).map((r) => r.date as string));
  const sorted = Array.from(dates).sort();

  const [d7, d30, d90] = await Promise.all([
    getDashboardData(access.clientId, "7d"),
    getDashboardData(access.clientId, "30d"),
    getDashboardData(access.clientId, "90d"),
  ]);

  return NextResponse.json({
    clientSlug,
    totalRows: rows?.length ?? 0,
    distinctDates: dates.size,
    minDate: sorted[0] ?? null,
    maxDate: sorted[sorted.length - 1] ?? null,
    spendByRange: {
      "7d": d7.kpis.spendMinorUnits.value / 100,
      "30d": d30.kpis.spendMinorUnits.value / 100,
      "90d": d90.kpis.spendMinorUnits.value / 100,
    },
    clicksByRange: {
      "7d": d7.kpis.clicks.value,
      "30d": d30.kpis.clicks.value,
      "90d": d90.kpis.clicks.value,
    },
    trendPoints: {
      "7d": d7.trend.length,
      "30d": d30.trend.length,
      "90d": d90.trend.length,
    },
  });
}
