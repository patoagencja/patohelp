import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { redirect } from "next/navigation";
import { Card, Metric, Text } from "@tremor/react";

import { formatMoneyPLN } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";

const WARSAW_TZ = "Europe/Warsaw";

// Phase 2 dashboard: a single number proving ad data flows end-to-end.
// The full KPI cards / charts / tables arrive in Phase 3.
export default async function ClientDashboardPage({
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

  const yesterday = formatInTimeZone(
    subDays(new Date(), 1),
    WARSAW_TZ,
    "yyyy-MM-dd"
  );

  const { data: rows } = await supabase
    .from("ads_daily")
    .select("provider, spend_minor_units")
    .eq("client_id", client.id)
    .eq("date", yesterday);

  let metaSpend = 0;
  let googleSpend = 0;
  for (const row of rows ?? []) {
    const spend = Number(row.spend_minor_units);
    if (row.provider === "meta_ads") metaSpend += spend;
    else if (row.provider === "google_ads") googleSpend += spend;
  }
  const total = metaSpend + googleSpend;
  const hasData = (rows?.length ?? 0) > 0;

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Dashboard {client.name}</h1>

      {hasData ? (
        <Card className="mt-4 max-w-md">
          <Text>Wydane wczoraj</Text>
          <Metric>{formatMoneyPLN(total)}</Metric>
          <Text className="mt-2">
            Meta: {formatMoneyPLN(metaSpend)} · Google:{" "}
            {formatMoneyPLN(googleSpend)}
          </Text>
        </Card>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Dane pojawią się po pierwszej synchronizacji (max 1h).
        </p>
      )}
    </div>
  );
}
