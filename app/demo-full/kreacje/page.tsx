import { CreativesExplorer } from "@/components/dashboard/creatives/creatives-explorer";
import { AdsSectionTabs } from "@/components/dashboard/section-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import type { CreativeItem } from "@/lib/dashboard/creatives";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

// Per-ad diagnostics layered onto the shared demo creatives (keyed by their
// stable demo ids). Values sit in typical Meta ranges for a traffic account:
// hooks 15-45%, completions 5-25%, 30-day frequency 1.5-5. Two ads are set
// up as fatigued (one by engagement ranking, one by a weak hook) and the
// retargeting ad has high frequency but healthy engagement, so the demo also
// shows that frequency alone is never flagged.
interface DemoDiag {
  freq: number;
  quality: string;
  engagement: string;
  conversion: string;
  video?: { hook: number; hold: number; completion: number; avgSec: number };
}

const DIAG: Record<string, DemoDiag> = {
  "demo-ad1": {
    freq: 2.1,
    quality: "ABOVE_AVERAGE",
    engagement: "AVERAGE",
    conversion: "AVERAGE",
    video: { hook: 0.31, hold: 0.38, completion: 0.11, avgSec: 7.4 },
  },
  "demo-ad2": { freq: 2.4, quality: "ABOVE_AVERAGE", engagement: "AVERAGE", conversion: "AVERAGE" },
  "demo-ad3": { freq: 4.2, quality: "AVERAGE", engagement: "BELOW_AVERAGE_20", conversion: "UNKNOWN" },
  "demo-ad4": { freq: 5.1, quality: "AVERAGE", engagement: "ABOVE_AVERAGE", conversion: "ABOVE_AVERAGE" },
  "demo-ad5": {
    freq: 1.8,
    quality: "ABOVE_AVERAGE",
    engagement: "ABOVE_AVERAGE",
    conversion: "AVERAGE",
    video: { hook: 0.42, hold: 0.46, completion: 0.24, avgSec: 6.1 },
  },
  "demo-ad6": { freq: 2.7, quality: "AVERAGE", engagement: "AVERAGE", conversion: "AVERAGE" },
  "demo-ad7": {
    freq: 3.7,
    quality: "AVERAGE",
    engagement: "AVERAGE",
    conversion: "BELOW_AVERAGE_35",
    video: { hook: 0.16, hold: 0.22, completion: 0.06, avgSec: 3.9 },
  },
  "demo-ad8": { freq: 2.2, quality: "ABOVE_AVERAGE", engagement: "AVERAGE", conversion: "AVERAGE" },
  "demo-ad9": { freq: 2.0, quality: "BELOW_AVERAGE_35", engagement: "AVERAGE", conversion: "AVERAGE" },
  "demo-ad10": {
    freq: 1.6,
    quality: "AVERAGE",
    engagement: "ABOVE_AVERAGE",
    conversion: "AVERAGE",
    video: { hook: 0.36, hold: 0.41, completion: 0.19, avgSec: 5.2 },
  },
};

function withDiagnostics(c: CreativeItem): CreativeItem {
  const d = DIAG[c.adId];
  if (!d) return c;
  const v = d.video;
  const plays3s = v ? Math.round(c.impressions * v.hook) : null;
  // Retention drops roughly geometrically from 3s to the end; interpolate
  // the quartiles between "hooked" and "completed" so they stay monotonic.
  const quartile = (q: number) =>
    v && plays3s != null ? Math.round(plays3s * Math.pow(v.completion, q)) : null;
  return {
    ...c,
    reach: Math.round(c.impressions / d.freq),
    frequency: d.freq,
    qualityRanking: d.quality,
    engagementRanking: d.engagement,
    conversionRanking: d.conversion,
    video:
      v && plays3s != null
        ? {
            plays3s,
            thruplays: Math.round(plays3s * v.hold),
            p25: quartile(0.25),
            p50: quartile(0.5),
            p75: quartile(0.75),
            p100: Math.round(plays3s * v.completion),
            avgWatchSeconds: v.avgSec,
          }
        : null,
  };
}

export default function DemoFullKreacje({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const d = getDemoDashboard(lang);
  const creatives = d.creativesFull.map(withDiagnostics);
  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title={en ? "Ads" : "Reklamy"}
          description={
            en
              ? "Which ads work best - and which are worth refreshing."
              : "Które reklamy działają najlepiej - i co warto odświeżyć."
          }
          actions={<Pill className="px-3 py-1 text-sm">Meta · {d.rangeLabel}</Pill>}
        />
        <AdsSectionTabs
          base="/demo-full"
          active="kreacje"
          query={en ? "?lang=en" : ""}
          lang={lang}
        />
      </div>

      <CreativesExplorer creatives={creatives} lang={lang} />
    </>
  );
}
