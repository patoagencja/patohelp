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
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

// Demo search terms for a door maker: [phrase, impressions, clicks, cost in grosze].
const DEMO_SEARCH_TERMS: SearchTermRow[] = (
  [
    ["drzwi wewnętrzne białe", 9840, 612, 104_040],
    ["drzwi zewnętrzne do domu", 7320, 418, 125_400],
    ["drzwi wewnętrzne z montażem warszawa", 3110, 287, 71_750],
    ["drzwi przesuwne do salonu", 4580, 254, 50_800],
    ["drzwi wewnętrzne cena", 6900, 241, 33_740],
    ["drzwi antywłamaniowe do mieszkania", 3870, 196, 64_680],
    ["drzwi bezprzylgowe białe", 2240, 171, 32_490],
    ["drzwi łazienkowe z podcięciem", 2950, 158, 23_700],
    ["drzwi wewnętrzne dąb", 3420, 142, 25_560],
    ["montaż drzwi wewnętrznych cena", 1980, 131, 27_510],
    ["drzwi zewnętrzne ocieplane", 2610, 119, 38_080],
    ["drzwi wewnętrzne czarne loft", 2130, 104, 17_680],
    ["drzwi szklane do kuchni", 1760, 88, 14_960],
    ["drzwi do mieszkania w bloku", 1540, 81, 22_680],
    ["drzwi wewnętrzne promocja", 2890, 76, 9_880],
    ["drzwi ukryte bezprzylgowe montaż", 940, 63, 15_120],
    ["drzwi zewnętrzne antywłamaniowe opinie", 1210, 57, 18_810],
    ["drzwi przesuwne naścienne", 1330, 52, 9_360],
    ["salon drzwi warszawa", 880, 49, 12_740],
    ["drzwi wewnętrzne szare", 1090, 41, 6_970],
  ] as const
).map(([term, impressions, clicks, costMinorUnits]) => ({
  term,
  impressions,
  clicks,
  costMinorUnits,
  conversions: 0,
}));

// Demo Search campaigns: [name, impression share, lost to budget, lost to
// rank, impressions, clicks, cost in grosze]. Shares are raw Google fractions
// (0.0999 = Google's "<10%", null = not enough data) so the demo runs through
// the same math as the real page.
const DEMO_IMPRESSION_SHARE = summarizeImpressionShare(
  (
    [
      ["Drzwi wewnętrzne - wyszukiwarka", 0.62, 0.28, 0.1, 41_200, 2_470, 1_037_400],
      ["Drzwi zewnętrzne - wyszukiwarka", 0.64, 0.22, 0.14, 26_800, 1_340, 643_200],
      ["Marka DRE", 0.93, 0, 0.07, 8_400, 1_930, 96_500],
      ["Montaż drzwi - Warszawa", 0.47, 0.38, 0.15, 6_100, 305, 158_600],
      ["Drzwi przesuwne", 0.0999, 0.12, 0.78, 900, 27, 13_500],
      ["Drzwi techniczne", null, null, null, 120, 3, 1_800],
    ] as const
  ).map(([name, is, budget, rank, impressions, clicks, cost], i) => ({
    customerId: "demo",
    campaignId: String(i + 1),
    campaignName: name,
    impressionShare: is,
    budgetLost: budget,
    rankLost: rank,
    impressions,
    clicks,
    costMinorUnits: cost,
  })),
  "2026-10-05"
);

export default function DemoFullReklamy({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const d = getDemoDashboard(lang);

  // Same skeleton as the real Reklamy tab: header + tabs -> 4 numbers ->
  // one chart -> one table -> one "Pokaż szczegóły". The ads teaser that
  // used to close the page lives one tab over, on Kreacje.
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

      <CampaignPositions campaigns={d.campaigns} lang={lang} variant="simple" />

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
        <SearchTerms terms={DEMO_SEARCH_TERMS} lang={lang} />
        <ImpressionShare data={DEMO_IMPRESSION_SHARE} lang={lang} />
        <CampaignPositions
          campaigns={d.campaigns}
          lang={lang}
          title={en ? "Campaigns - all numbers" : "Kampanie - wszystkie liczby"}
        />
      </DetailsDisclosure>
    </>
  );
}
