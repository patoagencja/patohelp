import { redirect } from "next/navigation";
import { Globe } from "lucide-react";

import { DetailsDisclosure } from "@/components/dashboard/details-disclosure";
import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { ActivityHeatmap } from "@/components/dashboard/website/activity-heatmap";
import { Audience } from "@/components/dashboard/website/audience";
import { Devices } from "@/components/dashboard/website/devices";
import { WebsiteKpis } from "@/components/dashboard/website/engagement-metrics";
import { NewVsReturning } from "@/components/dashboard/website/new-vs-returning";
import { SessionsTrend } from "@/components/dashboard/website/sessions-trend";
import { TopPages } from "@/components/dashboard/website/top-pages";
import { TrafficSources } from "@/components/dashboard/website/traffic-sources";
import { PageHeader } from "@/components/ui/page-header";
import { getActivityHeatmap } from "@/lib/dashboard/activity";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { getDemographics } from "@/lib/dashboard/demographics";
import { getGa4Status, getWebsiteData } from "@/lib/dashboard/ga4-metrics";

export const dynamic = "force-dynamic";

const DESCRIPTION = "Kto odwiedza Twoją stronę, skąd przychodzi i co ogląda - ostatnie 30 dni.";

export default async function WebsitePage({
  params,
}: {
  params: { clientSlug: string };
}) {
  // Shared per-request lookups: the layout already asked for the client and
  // the viewer, so the page no longer pays its own round trip for the row.
  const client = await getClientBySlug(params.clientSlug);

  if (!client) {
    redirect("/login");
  }

  const [data, demographics, activity] = await Promise.all([
    getWebsiteData(client.id),
    getDemographics(client.id),
    getActivityHeatmap(client.id),
  ]);

  if (!data.hasData) {
    const [status, { isAgency }] = await Promise.all([
      getGa4Status(client.id),
      getViewer(),
    ]);

    // Turn the raw reason into a concrete, actionable message + CTA.
    const guidance: Record<
      typeof status.reason,
      { title: string; body: string; href?: string; cta?: string }
    > = {
      ok: {
        title: "Brak danych z GA4",
        body: "Poczekaj na pierwszą synchronizację. Dane o ruchu pojawią się tutaj.",
      },
      no_data_yet: {
        title: "Trwa pierwsza synchronizacja GA4",
        body: `Property ${status.propertyId} jest podłączona, ale w bazie nie ma jeszcze danych. Kliknij „Odśwież” w nagłówku i odczekaj chwilę. Jeśli dalej pusto - sprawdź, czy w Google Cloud jest włączone „Analytics Data API”.`,
      },
      not_connected: {
        title: "GA4 nie jest połączone",
        body: "Połącz Google Analytics 4 w Ustawieniach, aby zobaczyć ruch na stronie.",
        href: `/${params.clientSlug}/settings`,
        cta: "Przejdź do Ustawień",
      },
      no_property: {
        title: "Nie wybrano property GA4",
        body: "GA4 jest połączone, ale nie wskazano, którą property pobierać. Bez tego synchronizacja jest pomijana. Wybierz właściwą property.",
        href: `/${params.clientSlug}/settings/ga4-select`,
        cta: "Wybierz property",
      },
      sync_failed: {
        title: "Synchronizacja GA4 się nie powiodła",
        // The raw provider error is agency diagnostics (property ids, API
        // internals); client users get the generic explanation instead.
        body:
          (isAgency ? status.lastError : null) ??
          `Ostatnia synchronizacja GA4 zwróciła błąd. Najczęściej: niewłączone „Analytics Data API” w projekcie Google Cloud albo property należy do innego konta niż użyte przy logowaniu.`,
        href: `/${params.clientSlug}/settings`,
        cta: "Sprawdź integrację",
      },
    };

    const g = guidance[status.reason];

    return (
      <div className="space-y-8 p-4 sm:p-6">
        <PageHeader title="Strona internetowa" description={DESCRIPTION} />
        <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-card p-8 text-center sm:p-12">
          <Globe className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{g.title}</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{g.body}</p>
          {g.href ? (
            <a
              href={g.href}
              className="mt-4 inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {g.cta}
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  const totalSessions = data.sessionsTrend.reduce((a, p) => a + p.sessions, 0);

  // Top-level children are the presentation-mode slides: header, numbers,
  // where visitors come from + what they read, details.
  return (
    <div className="min-w-0 space-y-8 p-4 sm:p-6">
      <PageHeader title="Strona internetowa" description={DESCRIPTION} />

      {/* Per-widget boundaries: one odd GA4 breakdown shouldn't blank the tab. */}
      <SectionBoundary name="website/kpis">
        <WebsiteKpis
          engagement={data.engagement}
          totalSessions={totalSessions}
          periodLabel="w ostatnich 30 dniach"
        />
      </SectionBoundary>

      {/* grid-cols-1 (= minmax(0,1fr)) keeps long page names from widening
          the track past a phone screen. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <SectionBoundary name="website/sources">
          <TrafficSources sources={data.sources} />
        </SectionBoundary>
        <SectionBoundary name="website/top-pages">
          <TopPages pages={data.topPages} />
        </SectionBoundary>
      </div>

      <DetailsDisclosure
        storageKey="pato:details:witryna"
        summary="Urządzenia, nowi i powracający, wizyty dzień po dniu, godziny aktywności i kim są odbiorcy"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <SectionBoundary name="website/devices">
            <Devices devices={data.devices} />
          </SectionBoundary>
          <SectionBoundary name="website/new-vs-returning">
            <NewVsReturning data={data.newVsReturning} />
          </SectionBoundary>
        </div>
        <SectionBoundary name="website/sessions-trend">
          <SessionsTrend trend={data.sessionsTrend} />
        </SectionBoundary>
        <SectionBoundary name="website/heatmap">
          <ActivityHeatmap data={activity} />
        </SectionBoundary>
        <SectionBoundary name="website/audience">
          <Audience data={demographics} />
        </SectionBoundary>
      </DetailsDisclosure>
    </div>
  );
}
