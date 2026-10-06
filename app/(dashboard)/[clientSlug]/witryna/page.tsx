import { redirect } from "next/navigation";
import { Globe } from "lucide-react";

import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { ActivityHeatmap } from "@/components/dashboard/website/activity-heatmap";
import { Audience } from "@/components/dashboard/website/audience";
import { Devices } from "@/components/dashboard/website/devices";
import { EngagementMetrics } from "@/components/dashboard/website/engagement-metrics";
import { NewVsReturning } from "@/components/dashboard/website/new-vs-returning";
import { SessionsTrend } from "@/components/dashboard/website/sessions-trend";
import { TopPages } from "@/components/dashboard/website/top-pages";
import { TrafficSources } from "@/components/dashboard/website/traffic-sources";
import { getActivityHeatmap } from "@/lib/dashboard/activity";
import { getViewer } from "@/lib/dashboard/context";
import { getDemographics } from "@/lib/dashboard/demographics";
import { getGa4Status, getWebsiteData } from "@/lib/dashboard/ga4-metrics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function WebsitePage({
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
      <div className="p-6">
        <h1 className="text-xl font-semibold">Witryna - {client.name}</h1>
        <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
          <Globe className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{g.title}</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{g.body}</p>
          {g.href ? (
            <a
              href={g.href}
              className="mt-4 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {g.cta}
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Twoja strona internetowa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kto odwiedza stronę {client.name}, skąd przychodzi i co ogląda · ostatnie 30 dni
        </p>
      </div>

      {/* Per-widget boundaries: one odd GA4 breakdown shouldn't blank the tab. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionBoundary name="website/sources">
          <TrafficSources sources={data.sources} />
        </SectionBoundary>
        <SectionBoundary name="website/devices">
          <Devices devices={data.devices} />
        </SectionBoundary>
      </div>

      <SectionBoundary name="website/engagement">
        <EngagementMetrics engagement={data.engagement} />
      </SectionBoundary>

      <SectionBoundary name="website/sessions-trend">
        <SessionsTrend trend={data.sessionsTrend} />
      </SectionBoundary>

      <SectionBoundary name="website/heatmap">
        <ActivityHeatmap data={activity} />
      </SectionBoundary>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionBoundary name="website/top-pages">
          <TopPages pages={data.topPages} />
        </SectionBoundary>
        <SectionBoundary name="website/new-vs-returning">
          <NewVsReturning data={data.newVsReturning} />
        </SectionBoundary>
      </div>

      <SectionBoundary name="website/audience">
        <Audience data={demographics} />
      </SectionBoundary>
    </div>
  );
}
