import { redirect } from "next/navigation";

import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { CostTrends } from "@/components/dashboard/cost-trends";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { PlatformSplit } from "@/components/dashboard/platform-split";
import {
  TopCreatives,
  type CreativeRow,
} from "@/components/dashboard/top-creatives";
import { getDashboardData, normalizeRange } from "@/lib/dashboard/metrics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getTopCreatives(clientId: string): Promise<CreativeRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("creatives")
    .select("ad_id, ad_name, thumbnail_url, spend_minor_units, ctr, cpc_minor_units")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .order("spend_minor_units", { ascending: false })
    .limit(5);

  return (data ?? []).map((c) => ({
    adId: c.ad_id as string,
    adName: (c.ad_name as string) || (c.ad_id as string),
    thumbnailUrl: c.thumbnail_url as string | null,
    spendMinorUnits: Number(c.spend_minor_units),
    ctr: c.ctr != null ? Number(c.ctr) : null,
    cpcMinorUnits: c.cpc_minor_units != null ? Number(c.cpc_minor_units) : null,
  }));
}

export default async function AdsPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string; camp?: string };
}) {
  const supabase = createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", params.clientSlug)
    .single();

  if (!client) {
    redirect("/login");
  }

  const range = normalizeRange(searchParams.range);
  const [data, creatives] = await Promise.all([
    getDashboardData(client.id, range),
    getTopCreatives(client.id),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Reklamy — {client.name}</h1>
        <DateRangePicker value={range} />
      </div>

      <CampaignPositions
        campaigns={data.campaigns}
        filter={
          searchParams.camp === "active" || searchParams.camp === "attention"
            ? searchParams.camp
            : "all"
        }
      />

      <TopCreatives creatives={creatives} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CostTrends costTrend={data.costTrend} />
        <PlatformSplit split={data.platformSplit} />
      </div>
    </div>
  );
}
