import { redirect } from "next/navigation";
import { Globe } from "lucide-react";

import { Devices } from "@/components/dashboard/website/devices";
import { EngagementMetrics } from "@/components/dashboard/website/engagement-metrics";
import { NewVsReturning } from "@/components/dashboard/website/new-vs-returning";
import { SessionsTrend } from "@/components/dashboard/website/sessions-trend";
import { TopPages } from "@/components/dashboard/website/top-pages";
import { TrafficSources } from "@/components/dashboard/website/traffic-sources";
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

  const data = await getWebsiteData(client.id);

  if (!data.hasData) {
    const status = await getGa4Status(client.id);

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
        body: `Property ${status.propertyId} jest podłączone, ale w bazie nie ma jeszcze danych. Kliknij „Odśwież" w nagłówku i odczekaj chwilę. Jeśli dalej pusto — sprawdź, czy w Google Cloud jest włączone „Analytics Data API".`,
      },
      not_connected: {
        title: "GA4 nie jest połączone",
        body: "Połącz Google Analytics 4 w Ustawieniach, aby zobaczyć ruch na stronie.",
        href: `/${params.clientSlug}/settings`,
        cta: "Przejdź do Ustawień",
      },
      no_property: {
        title: "Nie wybrano property GA4",
        body: "GA4 jest połączone, ale nie wskazano, którą property pobierać. Bez tego synchronizacja jest pomijana. Wybierz property DRE.",
        href: `/${params.clientSlug}/settings/ga4-select`,
        cta: "Wybierz property",
      },
      sync_failed: {
        title: "Synchronizacja GA4 się nie powiodła",
        body:
          status.lastError ??
          `Ostatni sync GA4 zwrócił błąd. Najczęściej: niewłączone „Analytics Data API" w projekcie Google Cloud, albo property należy do innego konta niż użyte przy logowaniu.`,
        href: `/${params.clientSlug}/settings`,
        cta: "Sprawdź integrację",
      },
    };

    const g = guidance[status.reason];

    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Witryna — {client.name}</h1>
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
      <h1 className="text-xl font-semibold">Witryna — {client.name}</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <TrafficSources sources={data.sources} />
        <Devices devices={data.devices} />
      </div>

      <EngagementMetrics engagement={data.engagement} />

      <SessionsTrend trend={data.sessionsTrend} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TopPages pages={data.topPages} />
        <NewVsReturning data={data.newVsReturning} />
      </div>
    </div>
  );
}
