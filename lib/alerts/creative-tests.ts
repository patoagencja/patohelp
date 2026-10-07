import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAbClient } from "@/lib/ab/eligibility";
import { readAbData, resolveAbWindow } from "@/lib/ab/load";
import { analyzeAb, formatX, formatZl } from "@/lib/ab/stats";
import type { Anomaly } from "@/lib/alerts/anomalies";
import { marketOf } from "@/lib/season/markets";

/**
 * Reaction alerts from the creative tests (same verdicts as the "Testy
 * kreacji" view, over the last 7 days), for seasonal and e-commerce clients
 * only. They come out in the Anomaly shape notify-alerts already sends: the
 * id is the alert_key, deduplicated per client per day by notifications_sent,
 * so each ad + kind goes out at most once a day. Severity "high" = a warning:
 * it waits for the client's allowed hours, never pages at night.
 *
 * Only what costs real money right now:
 * - a loser still spending >= 300 zł a day over the last 3 finished days;
 * - fatigue losing >= 1 000 zł of sales a day at the current spend.
 * Ads Meta reports as switched off are skipped - the owner already acted.
 */

/** 300 zł a day, grosze. */
const LOSER_MIN_DAILY_SPEND = 30_000;
/** 1 000 zł a day, grosze. */
const FATIGUE_MIN_DAILY_DROP = 100_000;

export async function detectCreativeAlerts(
  clientId: string,
  admin: SupabaseClient
): Promise<Anomaly[]> {
  if (!(await getAbClient(admin, clientId))) return [];
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const win = resolveAbWindow("7d", today, null);
  const data = await readAbData(admin, clientId, win, today);
  if (!data) return [];

  const { ads } = analyzeAb({
    windowKey: win.key,
    start: win.start,
    end: win.end,
    today,
    rows: data.rows,
    meta: data.meta,
    updatedAt: data.updatedAt,
    marketOf,
  });

  const out: Anomaly[] = [];
  for (const a of ads) {
    if (a.off) continue;
    const { ad } = a;
    const scopeLabel = `Testy kreacji · ${ad.adsetName || ad.campaignName || "zestaw reklam"}`;
    const roas = ad.rates.roas ?? 0;

    if (ad.verdict.kind === "loser" && a.recentDailySpend >= LOSER_MIN_DAILY_SPEND) {
      out.push({
        id: `creative-loser-${ad.adId}`,
        severity: "high",
        scope: "campaign",
        scopeLabel,
        metric: "roas",
        direction: "down",
        changePct: a.setRoas ? (roas / a.setRoas - 1) * 100 : 0,
        title: `Reklama przepala budżet: «${ad.adName}»`,
        description:
          a.setRoas != null
            ? `${formatZl(a.recentDailySpend)} dziennie przy zwrocie ${formatX(roas)} (zestaw: ${formatX(a.setRoas)}). ${ad.verdict.text}. Rozważ wyłączenie.`
            : `${formatZl(a.recentDailySpend)} dziennie. ${ad.verdict.text}. Rozważ wyłączenie.`,
      });
    } else if (
      ad.verdict.kind === "fatigue" &&
      a.fatigue &&
      a.fatigue.valueDropPerDay >= FATIGUE_MIN_DAILY_DROP
    ) {
      out.push({
        id: `creative-fatigue-${ad.adId}`,
        severity: "high",
        scope: "campaign",
        scopeLabel,
        metric: "roas",
        direction: "down",
        changePct: (a.fatigue.roasRecent / a.fatigue.roasBefore - 1) * 100,
        title: `Kreacja się wypala: «${ad.adName}»`,
        description: `${ad.verdict.text}. Przy obecnym budżecie to ok. ${formatZl(a.fatigue.valueDropPerDay)} sprzedaży mniej dziennie - czas na nową wersję.`,
      });
    }
  }
  return out;
}
