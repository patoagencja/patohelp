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
const EYEBROW = <span className="kick">Strona www · ostatnie 30 dni</span>;

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
        <PageHeader eyebrow={EYEBROW} title="Strona internetowa" description={DESCRIPTION} />
        <div className="glass flex flex-col items-center justify-center rounded-glass p-8 text-center sm:p-12">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-chip text-ink-2">
            <Globe className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-lg font-medium tracking-[-0.02em]">{g.title}</p>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-2">{g.body}</p>
          {g.href ? (
            <a
              href={g.href}
              className="mt-5 inline-flex min-h-11 items-center rounded-full bg-anchor px-5 text-sm font-medium text-anchor-foreground transition-transform active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
      <PageHeader eyebrow={EYEBROW} title="Strona internetowa" description={DESCRIPTION} />

      {/* Per-widget boundaries: one odd GA4 breakdown shouldn't blank the tab. */}
      <SectionBoundary name="website/kpis">
        <WebsiteKpis
          engagement={data.engagement}
          totalSessions={totalSessions}
          sessionsSeries={data.sessionsTrend.map((p) => p.sessions)}
          periodLabel="w ostatnich 30 dniach"
        />
      </SectionBoundary>

      {/* Full-width, one after the other (Strona-www board): where visitors
          come from, then what they read - each its own slide. */}
      <SectionBoundary name="website/sources">
        <TrafficSources sources={data.sources} />
      </SectionBoundary>
      <SectionBoundary name="website/top-pages">
        <TopPages pages={data.topPages} />
      </SectionBoundary>

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
