import { CalendarDays } from "lucide-react";

import { AdsKpiTiles, AdsPageHeader } from "@/components/dashboard/ads-page-intro";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { CostTrends } from "@/components/dashboard/cost-trends";
import { DetailsDisclosure } from "@/components/dashboard/details-disclosure";
import { ImpressionShare } from "@/components/dashboard/impression-share";
import { PlatformSplit } from "@/components/dashboard/platform-split";
import { SearchTerms } from "@/components/dashboard/search-terms";
import { AdsSectionTabs } from "@/components/dashboard/section-tabs";
import { Pill } from "@/components/ui/pill";
import type { SearchTermRow } from "@/lib/dashboard/search-terms";
import { summarizeImpressionShare } from "@/lib/dashboard/impression-share";
import { DEMO_SEARCH_TERMS } from "@/lib/demo/brand";
import { getDemoDashboard } from "@/lib/demo/data";
import { getDemoSource } from "@/lib/demo/profile/store";
import { splitExact, type DemoSource } from "@/lib/demo/source";

export const dynamic = "force-dynamic";

type Dashboard = ReturnType<typeof getDemoDashboard>;

/** The Search campaigns of the table (else the Google ones, which match search terms too). */
function searchCampaigns(src: DemoSource, d: Dashboard) {
  const ids = new Set(src.campaigns.filter((c) => c.type === "SEARCH").map((c) => c.id));
  const rows = d.campaigns.filter((c) => ids.has(c.campaignId));
  return rows.length ? rows : d.campaigns.filter((c) => c.provider === "google_ads").slice(0, 2);
}

/**
 * What customers searched for: the shop's phrases (lib/demo/brand.ts)
 * sharing part of the Search campaigns' clicks and cost - a report never
 * holds every term, so it can't reach the campaigns' totals.
 */
function demoSearchTerms(src: DemoSource, d: Dashboard): SearchTermRow[] {
  const rows = searchCampaigns(src, d);
  const clicks = Math.round(rows.reduce((a, c) => a + c.clicks, 0) * 0.62);
  const cost = Math.round(rows.reduce((a, c) => a + c.spendMinorUnits, 0) * 0.58);
  const byClicks = splitExact(clicks, DEMO_SEARCH_TERMS.map((t) => t[1]));
  const byCost = splitExact(cost, DEMO_SEARCH_TERMS.map((t, i) => byClicks[i] * t[3]));
  return DEMO_SEARCH_TERMS.map(([term, , ctr], i) => ({
    term,
    impressions: Math.round(byClicks[i] / ctr),
    clicks: byClicks[i],
    costMinorUnits: byCost[i],
    conversions: 0,
  })).filter((t) => t.clicks > 0);
}

// Google's raw shares for the Search campaigns, by rank (impression share,
// lost to budget, lost to rank). Impressions, clicks and cost are the
// campaign rows of the table, so the card can't name a spend they don't have.
const SEARCH_SHARES: Array<[number, number, number]> = [
  [0.91, 0, 0.09],
  [0.58, 0.31, 0.11],
  [0.66, 0.18, 0.16],
];

function demoImpressionShare(src: DemoSource, d: Dashboard) {
  return summarizeImpressionShare(
    searchCampaigns(src, d)
      .slice(0, SEARCH_SHARES.length)
      .map((c, i) => {
        const [is, budget, rank] = SEARCH_SHARES[i];
        return {
          customerId: "demo",
          campaignId: c.campaignId,
          campaignName: c.name,
          impressionShare: is,
          budgetLost: budget,
          rankLost: rank,
          impressions: c.impressions,
          clicks: c.clicks,
          costMinorUnits: c.spendMinorUnits,
        };
      }),
    d.trend[d.trend.length - 1]?.date ?? ""
  );
}

export default async function DemoFullReklamy({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const src = await getDemoSource();
  const d = getDemoDashboard(src, lang);
  // The demo's one fixed period is its 30-day trend.
  const exportScope = {
    client: "demo",
    from: d.trend[0]?.date ?? null,
    to: d.trend[d.trend.length - 1]?.date ?? null,
  };

  // Same skeleton as the real Reklamy tab: header + tabs -> 4 numbers ->
  // one chart -> one table -> one "Pokaż szczegóły".
  return (
    <>
      <AdsPageHeader
        kicker={`${en ? "Paid campaigns" : "Płatne kampanie"} · ${d.rangeLabel.toLowerCase()}`}
        title={en ? "Ads" : "Reklamy"}
        lead={
          en
            ? "Where the money goes and what we get for it."
            : "Na co idą pieniądze i co z tego mamy."
        }
        // The demo has one fixed period; show it where the picker sits.
        actions={
          <Pill tone="neutral" className="min-h-11 gap-2 bg-chip px-4 text-sm text-ink-2 [&_svg]:size-4">
            <CalendarDays aria-hidden />
            {d.rangeLabel}
          </Pill>
        }
        tabs={
          <AdsSectionTabs
            base="/demo-full"
            active="kampanie"
            query={en ? "?lang=en" : ""}
            lang={lang}
            showTests
          />
        }
      />

      <AdsKpiTiles kpis={d.kpis} trend={d.trend} lang={lang} />

      <CostTrends costTrend={d.costTrend} lang={lang} />

      <CampaignPositions
        campaigns={d.campaigns}
        lang={lang}
        variant="simple"
        exportScope={exportScope}
      />

      <DetailsDisclosure
        storageKey="pato:details:reklamy"
        openLabel={en ? "Show details" : undefined}
        closeLabel={en ? "Hide details" : undefined}
        summary={
          en
            ? "Budget split between Meta and Google, what your customers search for, visibility on Google and the full campaign table."
            : "Podział budżetu na Meta i Google, czego szukają Twoi klienci, widoczność w Google i pełna tabela kampanii."
        }
      >
        <PlatformSplit split={d.platformSplit} lang={lang} />
        <SearchTerms terms={demoSearchTerms(src, d)} lang={lang} />
        <ImpressionShare data={demoImpressionShare(src, d)} lang={lang} />
        <CampaignPositions
          campaigns={d.campaigns}
          lang={lang}
          title={en ? "Campaigns - all numbers" : "Kampanie - wszystkie liczby"}
          exportScope={exportScope}
        />
      </DetailsDisclosure>
    </>
  );
}
