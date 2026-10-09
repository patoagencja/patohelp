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

// Demo search terms for lokalnepomidorki, the online vegetable shop:
// [phrase, impressions, clicks, cost in grosze]. "warzywa" recurs on purpose:
// the search-terms card drops a word that is in nearly every phrase.
const DEMO_SEARCH_TERMS: SearchTermRow[] = (
  [
    ["warzywa z dostawą do domu", 9840, 612, 104_040],
    ["skrzynka warzyw", 7320, 418, 79_420],
    ["warzywa od rolnika warszawa", 3110, 287, 51_660],
    ["pomidory malinowe sklep internetowy", 4580, 254, 38_100],
    ["dostawa warzyw cena", 6900, 241, 40_970],
    ["ekologiczne warzywa z dostawą", 3870, 196, 37_240],
    ["pomidory na przetwory 10 kg", 2240, 171, 22_230],
    ["skrzynka warzyw abonament", 2950, 158, 30_020],
    ["warzywa online kraków", 3420, 142, 25_560],
    ["lokalne pomidory", 1980, 131, 9_170],
    ["kapusta do kiszenia zamówienie", 2610, 119, 14_280],
    ["warzywa sezonowe dostawa jutro", 2130, 104, 19_760],
    ["passata domowa", 1760, 88, 10_560],
    ["owoce i warzywa z dostawą", 1540, 81, 15_390],
    ["warzywa promocja", 2890, 76, 9_880],
    ["pomidory koktajlowe kolorowe", 940, 63, 8_190],
    ["dostawa warzyw opinie", 1210, 57, 10_830],
    ["ziemniaki 15 kg z dostawą", 1330, 52, 7_800],
    ["warzywniak online", 880, 49, 9_310],
    ["warzywa bez chemii", 1090, 41, 6_970],
  ] as const
).map(([term, impressions, clicks, costMinorUnits]) => ({
  term,
  impressions,
  clicks,
  costMinorUnits,
  conversions: 0,
}));

// Google's raw shares for the demo's two Search campaigns (impression share,
// lost to budget, lost to rank). Impressions, clicks and cost come from the
// same campaign rows as the table below, so the card can't name a campaign
// or a spend the table doesn't have.
const DEMO_SEARCH_SHARES: Record<string, [number, number, number]> = {
  "d-g2": [0.62, 0.28, 0.1],
  "d-g1": [0.93, 0, 0.07],
};

function demoImpressionShare(d: ReturnType<typeof getDemoDashboard>) {
  return summarizeImpressionShare(
    d.campaigns
      .filter((c) => DEMO_SEARCH_SHARES[c.campaignId])
      .map((c) => {
        const [is, budget, rank] = DEMO_SEARCH_SHARES[c.campaignId];
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
        <ImpressionShare data={demoImpressionShare(d)} lang={lang} />
        <CampaignPositions
          campaigns={d.campaigns}
          lang={lang}
          title={en ? "Campaigns - all numbers" : "Kampanie - wszystkie liczby"}
        />
      </DetailsDisclosure>
    </>
  );
}
