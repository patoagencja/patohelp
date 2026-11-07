import { formatInTimeZone } from "date-fns-tz";

import {
  alertItems,
  bestItems,
  briefLink,
  briefNote,
  goalActions,
  testActions,
  todayActions,
} from "@/components/dashboard/today/today-items";
import {
  TodayActions,
  TodayAlerts,
  TodayBest,
  TodayBrief,
  TodayColumn,
} from "@/components/dashboard/today/today-view";
import type { AbAd } from "@/lib/ab/types";
import { getDemoAbSeries, getDemoAbView } from "@/lib/demo/ab";
import { demoGoalTiles } from "@/lib/demo/campaign-goals";
import { getDemoDashboard } from "@/lib/demo/data";
import { getDemoEcom } from "@/lib/demo/ecom";
import { addDays, buildBrief, pickBriefSource, topBy } from "@/lib/today/brief";
import type { YesterdayBest } from "@/lib/today/load";

export const dynamic = "force-dynamic";

const BASE = "/demo-full";
const WARSAW_TZ = "Europe/Warsaw";

/**
 * Demo of "Dziś" for the lokalnepomidorki shop: the same sections and
 * words as app/(dashboard)/[clientSlug]/dzis, fed by the data the other
 * demo pages show - the Sprzedaż demo's days for the brief and the top
 * product, the demo alerts, the Testy kreacji demo's proposals and best ad,
 * the demo goal tiles. The shop has no season (like the demo nav), so no
 * season budget row.
 */
export default function DemoTodayPage() {
  const now = new Date();
  const today = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const hour = Number(formatInTimeZone(now, WARSAW_TZ, "H"));
  const yesterday = addDays(today, -1);

  const ecom = getDemoEcom("30d", null, today);
  const picked = pickBriefSource({ isShop: true, trend: ecom.trend, shopDays: null, start: ecom.rangeStart, end: today });
  const brief = buildBrief({ picked, today, hour });
  const note = briefNote(picked?.kind ?? null, picked?.source ?? null, false);

  const { items: alerts, rest } = alertItems(getDemoDashboard().alerts);

  const ab = getDemoAbView("7d", today);
  const actions = todayActions({ goal: goalActions(demoGoalTiles(), BASE), test: testActions(ab, BASE) });

  return (
    <TodayColumn>
      <h1 className="sr-only">Dziś - lokalnepomidorki</h1>
      <TodayBrief brief={brief} note={note ? `${note} Dane przykładowe.` : null} link={briefLink(picked?.kind ?? null, BASE)} />
      <TodayAlerts items={alerts} rest={rest} alertsHref={`${BASE}/alerty`} />
      <TodayActions items={actions} calmHref={BASE} withTests />
      <TodayBest items={bestItems(demoBest(ab.tests.flatMap((t) => t.ads), today, yesterday), BASE, true)} />
    </TodayColumn>
  );
}

/** Yesterday's best product and ad, picked from the demo days like the live reads pick from theirs. */
function demoBest(ads: AbAd[], today: string, yesterday: string): YesterdayBest {
  const product = getDemoEcom("30d", { start: yesterday, end: yesterday }, today).products[0] ?? null;
  const series = getDemoAbSeries({ adIds: ads.map((a) => a.adId), start: yesterday, end: yesterday }, today);
  const top = topBy(series, (s) => s.days[0]?.value ?? 0);
  const ad = top ? ads.find((a) => a.adId === top.adId) : undefined;
  const day = top?.days[0];
  return {
    date: yesterday,
    product: product
      ? {
          name: product.itemName,
          revenue: product.revenueMinorUnits,
          count: product.quantity,
          unit: "items",
          source: "ga4",
        }
      : null,
    ad:
      ad && day
        ? {
            adId: ad.adId,
            name: ad.adName,
            campaignName: ad.campaignName,
            value: day.value,
            purchases: day.purchases,
            clicks: day.clicks,
            thumbnailUrl: ad.thumbnailUrl,
            video: (ad.totals.video3s ?? 0) > 0,
          }
        : null,
    campaign: null,
  };
}
