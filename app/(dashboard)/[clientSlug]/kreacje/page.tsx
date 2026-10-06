import { redirect } from "next/navigation";
import { ImageOff } from "lucide-react";

import { CreativesExplorer } from "@/components/dashboard/creatives/creatives-explorer";
import { EmptyState } from "@/components/dashboard/empty-state";
import { AdsSectionTabs } from "@/components/dashboard/section-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { getClientBySlug } from "@/lib/dashboard/context";
import type { CreativeItem } from "@/lib/dashboard/creatives";
import { createClient } from "@/lib/supabase/server";
import { formatDateWarsaw } from "@/lib/utils";

export const dynamic = "force-dynamic";

// bigint/numeric columns can arrive as strings from PostgREST.
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function periodLabel(start: string | null, end: string | null): string {
  if (!start || !end) return "ostatnie 30 dni";
  return `${formatDateWarsaw(start, "d MMM")} - ${formatDateWarsaw(end, "d MMM yyyy")}`;
}

export default async function KreacjePage({
  params,
  searchParams = {},
}: {
  params: { clientSlug: string };
  searchParams?: { range?: string; from?: string; to?: string };
}) {
  // Shared per-request lookup: the layout already asked for this client, so
  // the page no longer pays its own round trip for the same row.
  const client = await getClientBySlug(params.clientSlug);

  if (!client) {
    redirect("/login");
  }

  const supabase = createClient();
  const { data } = await supabase
    .from("creatives")
    // "*" rather than a column list: naming the 0025 metric columns would
    // make the whole query fail (and the tab look empty) until that
    // migration has run. Missing columns simply read as undefined.
    .select("*")
    .eq("client_id", client.id)
    .eq("provider", "meta_ads")
    .order("spend_minor_units", { ascending: false })
    .limit(300);

  const rows = data ?? [];
  const creatives: CreativeItem[] = rows.map((c) => ({
    adId: c.ad_id as string,
    name: (c.ad_name as string) || (c.ad_id as string),
    thumbnailUrl: (c.thumbnail_url as string | null) || null,
    spend: Number(c.spend_minor_units),
    impressions: Number(c.impressions),
    clicks: Number(c.clicks),
    ctr: c.ctr != null ? Number(c.ctr) : null,
    cpc: c.cpc_minor_units != null ? Number(c.cpc_minor_units) : null,
    reach: numOrNull(c.reach),
    frequency: numOrNull(c.frequency),
    qualityRanking: (c.quality_ranking as string | null) ?? null,
    engagementRanking: (c.engagement_rate_ranking as string | null) ?? null,
    conversionRanking: (c.conversion_rate_ranking as string | null) ?? null,
    // No 3-second play count means a static/carousel ad: no video block.
    video:
      c.video_3s_views != null
        ? {
            plays3s: numOrNull(c.video_3s_views),
            thruplays: numOrNull(c.video_thruplays),
            p25: numOrNull(c.video_p25),
            p50: numOrNull(c.video_p50),
            p75: numOrNull(c.video_p75),
            p100: numOrNull(c.video_p100),
            avgWatchSeconds: numOrNull(c.video_avg_watch_seconds),
          }
        : null,
  }));

  const period = periodLabel(
    (rows[0]?.period_start as string | null) ?? null,
    (rows[0]?.period_end as string | null) ?? null
  );

  // Creatives are a fixed synced window (not the page's range picker), but
  // the range chosen on Kampanie is carried through so the way back keeps it.
  const keep = new URLSearchParams();
  if (searchParams.range) keep.set("range", searchParams.range);
  if (searchParams.from) keep.set("from", searchParams.from);
  if (searchParams.to) keep.set("to", searchParams.to);
  const query = keep.toString() ? `?${keep.toString()}` : "";

  // Same header and tabs as Kampanie: Kreacje is a tab of Reklamy, not a
  // separate place. Top-level children are the presentation slides.
  return (
    <div className="min-w-0 space-y-8 px-4 py-6 sm:px-6 md:py-8">
      <div className="space-y-6">
        <PageHeader
          title="Reklamy"
          description="Które reklamy działają najlepiej - i co warto odświeżyć."
          actions={
            <Pill className="px-3 py-1 text-sm" title="Reklamy odświeżane automatycznie co 6 godzin">
              Meta · {period}
            </Pill>
          }
        />
        <AdsSectionTabs base={`/${params.clientSlug}`} active="kreacje" query={query} />
      </div>

      {creatives.length === 0 ? (
        <EmptyState
          icon={ImageOff}
          title="Nie ma jeszcze reklam do pokazania"
          description="Grafiki i filmy z Meta pojawią się tu po najbliższym odświeżeniu danych (co 6 godzin)."
        />
      ) : (
        <CreativesExplorer creatives={creatives} />
      )}
    </div>
  );
}
