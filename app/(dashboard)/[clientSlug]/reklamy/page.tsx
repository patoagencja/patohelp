import { redirect } from "next/navigation";

import { AdsKpiTiles, AdsPageHeader } from "@/components/dashboard/ads-page-intro";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { CostTrends } from "@/components/dashboard/cost-trends";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { DetailsDisclosure } from "@/components/dashboard/details-disclosure";
import { ImpressionShare } from "@/components/dashboard/impression-share";
import { PlatformSplit } from "@/components/dashboard/platform-split";
import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { SearchTerms } from "@/components/dashboard/search-terms";
import { AdsSectionTabs } from "@/components/dashboard/section-tabs";
import {
  loadDashboardData,
  normalizeRange,
  parseCustomRange,
} from "@/lib/dashboard/metrics";
import { getClientBySlug } from "@/lib/dashboard/context";
import { getImpressionShare } from "@/lib/dashboard/impression-share";
import { getSearchTerms } from "@/lib/dashboard/search-terms";

export const dynamic = "force-dynamic";

export default async function AdsPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string; camp?: string; from?: string; to?: string };
}) {
  // Shared per-request lookup: the layout already asked for this client, so
  // the page no longer pays its own round trip for the same row.
  const client = await getClientBySlug(params.clientSlug);

  if (!client) {
    redirect("/login");
  }

  const range = normalizeRange(searchParams.range);
  const custom = parseCustomRange(searchParams.from, searchParams.to);
  // Top creatives used to be teased here too; they now live one tab over
  // (Kreacje), so the page no longer queries them.
  // Search terms and impression share sit behind "Pokaż szczegóły": they
  // stream in after the first screen instead of holding the whole page back
  // (the slowest part of this tab on big Google accounts).
  const data = await loadDashboardData(client.id, range, custom?.start ?? null, custom?.end ?? null);

  // Keep the chosen range when hopping between the Kampanie/Kreacje tabs.
  const keep = new URLSearchParams();
  if (searchParams.range) keep.set("range", searchParams.range);
  if (searchParams.from) keep.set("from", searchParams.from);
  if (searchParams.to) keep.set("to", searchParams.to);
  const query = keep.toString() ? `?${keep.toString()}` : "";
  const initialFilter =
    searchParams.camp === "active" || searchParams.camp === "attention"
      ? searchParams.camp
      : "all";

  // Page skeleton: header + tabs -> 4 numbers -> one chart -> one table ->
  // one "Pokaż szczegóły". Each top-level child is a presentation slide, and
  // each widget has its own boundary so one bad dataset can't blank the tab.
  return (
    <div className="min-w-0 space-y-8 px-4 py-6 sm:px-6 md:py-8">
      <AdsPageHeader
        kicker={`Płatne kampanie · ${data.rangeLabel.toLowerCase()}`}
        title="Reklamy"
        lead="Na co idą pieniądze i co z tego mamy."
        actions={
          <DateRangePicker
            value={range}
            customFrom={custom?.start}
            customTo={custom?.end}
            size="lg"
          />
        }
        tabs={<AdsSectionTabs base={`/${params.clientSlug}`} active="kampanie" query={query} />}
      />

      <SectionBoundary name="ads/kpis">
        <AdsKpiTiles kpis={data.kpis} trend={data.trend} />
      </SectionBoundary>

      <SectionBoundary name="ads/cost-trends">
        <CostTrends costTrend={data.costTrend} />
      </SectionBoundary>

      <SectionBoundary name="ads/campaigns">
        <CampaignPositions
          campaigns={data.campaigns}
          variant="simple"
          initialFilter={initialFilter}
        />
      </SectionBoundary>

      <DetailsDisclosure
        storageKey="pato:details:reklamy"
        summary="Podział budżetu na Meta i Google, czego szukają Twoi klienci, widoczność w Google i pełna tabela kampanii."
      >
        <SectionBoundary name="ads/platform-split">
          <PlatformSplit split={data.platformSplit} />
        </SectionBoundary>
        <SectionBoundary name="ads/search-terms">
          <SearchTermsSection clientId={client.id} />
        </SectionBoundary>
        <SectionBoundary name="ads/impression-share">
          <ImpressionShareSection clientId={client.id} />
        </SectionBoundary>
        <SectionBoundary name="ads/campaigns-full">
          <CampaignPositions
            campaigns={data.campaigns}
            initialFilter={initialFilter}
            title="Kampanie - wszystkie liczby"
          />
        </SectionBoundary>
      </DetailsDisclosure>
    </div>
  );
}

async function SearchTermsSection({ clientId }: { clientId: string }) {
  return <SearchTerms terms={await getSearchTerms(clientId)} />;
}

async function ImpressionShareSection({ clientId }: { clientId: string }) {
  return <ImpressionShare data={await getImpressionShare(clientId)} />;
}
