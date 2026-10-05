import { redirect } from "next/navigation";

import { AdsPageIntro } from "@/components/dashboard/ads-page-intro";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { CostTrends } from "@/components/dashboard/cost-trends";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { ImpressionShare } from "@/components/dashboard/impression-share";
import { PlatformSplit } from "@/components/dashboard/platform-split";
import { SearchTerms } from "@/components/dashboard/search-terms";
import {
  TopCreatives,
  type CreativeRow,
} from "@/components/dashboard/top-creatives";
import {
  getDashboardData,
  normalizeRange,
  parseCustomRange,
} from "@/lib/dashboard/metrics";
import { getImpressionShare } from "@/lib/dashboard/impression-share";
import { getSearchTerms } from "@/lib/dashboard/search-terms";
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
  searchParams: { range?: string; camp?: string; from?: string; to?: string };
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
  const custom = parseCustomRange(searchParams.from, searchParams.to);
  const [data, creatives, searchTerms, impressionShare] = await Promise.all([
    getDashboardData(client.id, range, custom),
    getTopCreatives(client.id),
    getSearchTerms(client.id),
    getImpressionShare(client.id),
  ]);

  return (
    <div className="space-y-6 p-6">
      <AdsPageIntro kpis={data.kpis} rangeLabel={data.rangeLabel}>
        <DateRangePicker
          value={range}
          customFrom={custom?.start}
          customTo={custom?.end}
        />
      </AdsPageIntro>

      {/* The two short answers first (where the money goes, what a click
          costs); the per-campaign detail follows for anyone who wants it. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <PlatformSplit split={data.platformSplit} />
        <CostTrends costTrend={data.costTrend} />
      </div>

      <CampaignPositions
        campaigns={data.campaigns}
        initialFilter={
          searchParams.camp === "active" || searchParams.camp === "attention"
            ? searchParams.camp
            : "all"
        }
      />

      <SearchTerms terms={searchTerms} />

      <ImpressionShare data={impressionShare} />

      <TopCreatives creatives={creatives} />
    </div>
  );
}
