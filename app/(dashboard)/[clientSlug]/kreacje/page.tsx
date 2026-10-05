import { redirect } from "next/navigation";
import { ImageOff } from "lucide-react";

import { CreativesExplorer } from "@/components/dashboard/creatives/creatives-explorer";
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
}: {
  params: { clientSlug: string };
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

  return (
    <div className="min-w-0 space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">Kreacje - {client.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Które reklamy działają najlepiej i dlaczego · Meta · {period} ·
          odświeżane automatycznie co 6h
        </p>
      </div>

      {creatives.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-16 text-center">
          <ImageOff className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Brak danych o kreacjach</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Reklamy pojawią się tu po najbliższej synchronizacji kreacji (co 6h).
          </p>
        </div>
      ) : (
        <CreativesExplorer creatives={creatives} />
      )}
    </div>
  );
}
