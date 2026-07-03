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
    .select("date, provider, campaign_name, spend_minor_units")
    .eq("client_id", access.clientId)
    .order("date", { ascending: true });

  const dates = new Set((rows ?? []).map((r) => r.date as string));
  const sorted = Array.from(dates).sort();

  // Per-provider total + top campaigns by spend (whole dataset).
  let metaTotal = 0;
  let googleTotal = 0;
  const byCampaign = new Map<string, { name: string; provider: string; spend: number }>();
  for (const r of rows ?? []) {
    const spend = Number(r.spend_minor_units);
    if (r.provider === "meta_ads") metaTotal += spend;
    else googleTotal += spend;
    const key = `${r.provider}:${r.campaign_name}`;
    const c = byCampaign.get(key) ?? {
      name: (r.campaign_name as string) ?? "(bez nazwy)",
      provider: r.provider as string,
      spend: 0,
    };
    c.spend += spend;
    byCampaign.set(key, c);
  }
  const topCampaigns = Array.from(byCampaign.values())
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 15)
    .map((c) => ({
      name: c.name,
      provider: c.provider,
      spendPln: c.spend / 100,
    }));

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
    totalSpendByProvider: {
      meta: metaTotal / 100,
      google: googleTotal / 100,
    },
    topCampaigns,
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
