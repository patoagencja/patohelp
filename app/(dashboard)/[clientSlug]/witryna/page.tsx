import { redirect } from "next/navigation";
import { Globe } from "lucide-react";

import { Devices } from "@/components/dashboard/website/devices";
import { EngagementMetrics } from "@/components/dashboard/website/engagement-metrics";
import { NewVsReturning } from "@/components/dashboard/website/new-vs-returning";
import { SessionsTrend } from "@/components/dashboard/website/sessions-trend";
import { TopPages } from "@/components/dashboard/website/top-pages";
import { TrafficSources } from "@/components/dashboard/website/traffic-sources";
import { getWebsiteData } from "@/lib/dashboard/ga4-metrics";
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
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Witryna — {client.name}</h1>
        <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
          <Globe className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Brak danych z GA4</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Połącz Google Analytics 4 w Ustawieniach i poczekaj na pierwszą
            synchronizację (do godziny). Dane o ruchu pojawią się tutaj.
          </p>
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
