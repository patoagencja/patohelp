import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";

import { DailyNetPageView } from "@/components/dashboard/daily-net/daily-net-page";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { parseCompareMode, resolveNetRange } from "@/lib/daily-net/calc";
import { loadDailyNet, MANUAL_COSTS_MIGRATION } from "@/lib/daily-net/load";
import { seasonState } from "@/lib/season/config";
import { getClientSeason } from "@/lib/season/load";

import { saveManualCosts } from "./actions";

export const dynamic = "force-dynamic";

/**
 * "Wynik dzień po dniu" (a child of Sprzedaż): the shop's revenue minus
 * every ad channel per day, against last year. Client users see it too -
 * it is their own revenue and their own ad spend, nothing of the agency's.
 * Reads Supabase only (shop feed, synced ads, hand-entered costs).
 */
export default async function WynikPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string; from?: string; to?: string; cmp?: string };
}) {
  const viewerPromise = getViewer();
  // Awaited below; this only stops Node flagging an early rejection.
  viewerPromise.catch(() => {});
  const client = await getClientBySlug(params.clientSlug);
  if (!client) redirect("/login");
  // Shops only, like Sprzedaż.
  if (client.clientType !== "ecommerce") redirect(`/${params.clientSlug}`);

  const season = await getClientSeason(client.id);
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const state = season ? seasonState(season, today) : null;
  const range = resolveNetRange({
    range: searchParams.range,
    from: searchParams.from,
    to: searchParams.to,
    today,
    season: state ? state.current : null,
  });
  const mode = parseCompareMode(searchParams.cmp);

  const [data, viewer] = await Promise.all([loadDailyNet(client.id, range, mode, today), viewerPromise]);

  return (
    <DailyNetPageView
      view={data}
      range={range}
      mode={mode}
      base={`/${params.clientSlug}`}
      seasonLabel={state ? { cur: `Sezon ${state.current.year}`, ly: `Sezon ${state.previous.year}` } : null}
      shop={data.shop}
      manual={{ ...data.manual, migration: MANUAL_COSTS_MIGRATION }}
      tiktokApiDates={data.tiktokApiDates}
      isAgency={viewer.isAgency}
      exportClient={params.clientSlug}
      save={saveManualCosts}
    />
  );
}
