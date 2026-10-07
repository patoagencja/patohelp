import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAbClient } from "@/lib/ab/eligibility";
import { readAbData, readAbStamp } from "@/lib/ab/load";
import { analyzeAb, formatX, formatZl } from "@/lib/ab/stats";
import { resolveAbWindow, salesMomentsFor } from "@/lib/ab/window";
import type { Anomaly } from "@/lib/alerts/anomalies";
import { marketOf } from "@/lib/season/markets";

/**
 * Reaction alerts from the creative tests: the very analysis of the "Testy
 * kreacji" view over the last 7 FINISHED days (never today's partial data),
 * for shops only. They come out in the Anomaly shape notify-alerts already
 * sends: the id is the alert_key, deduplicated per client per day by
 * notifications_sent, so each ad + kind goes out at most once a day.
 * Severity "high" = a warning: it waits for the client's allowed hours,
 * never pages at night.
 *
 * Only what costs real money right now:
 * - a "Wyłącz" action on an ad still spending >= 300 zł a day over the last
 *   3 finished days;
 * - fatigue with >= 1 000 zł of sales a day at stake (against the rest of
 *   its set's trend, at the current spend).
 * Ads Meta reports as switched off are skipped - the owner already acted.
 */

/** 300 zł a day, grosze. */
const CUT_MIN_DAILY_SPEND = 30_000;
/** 1 000 zł a day, grosze. */
const FATIGUE_MIN_DAILY_DROP = 100_000;

export async function detectCreativeAlerts(
  clientId: string,
  admin: SupabaseClient
): Promise<Anomaly[]> {
  const client = await getAbClient(admin, clientId);
  if (!client) return [];
  // No table (migration 0039) or nothing synced: nothing to judge.
  if (!(await readAbStamp(admin, clientId))) return [];
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const win = resolveAbWindow("7d", today, null);
  const data = await readAbData(admin, clientId, win, today);

  const { ads } = analyzeAb({
    windowKey: win.key,
    start: win.start,
    end: win.end,
    today,
    rows: data.rows,
    meta: data.meta,
    marketOf,
    moments: salesMomentsFor(client.season, today),
  });

  const out: Anomaly[] = [];
  for (const a of ads) {
    if (a.off) continue;
    const { ad } = a;
    const scopeLabel = `Testy kreacji · ${ad.adsetName || ad.campaignName || "zestaw reklam"}`;
    const roas = ad.rates.roas ?? 0;

    if (a.action?.kind === "cut" && a.recentDailySpend >= CUT_MIN_DAILY_SPEND) {
      out.push({
        id: `creative-loser-${ad.adId}`,
        severity: "high",
        scope: "campaign",
        scopeLabel,
        metric: "roas",
        direction: "down",
        changePct: a.restRoas ? (roas / a.restRoas - 1) * 100 : 0,
        title: `Reklama sprzedaje drożej niż reszta zestawu: „${ad.adName}”`,
        description: `${a.action.title}. ${ad.verdict.text}. Wydaje ok. ${formatZl(a.recentDailySpend)} dziennie; ten budżet w reszcie zestawu sprzedałby ok. ${formatZl(a.action.impactPerDay)} więcej dziennie. Rozważ wyłączenie.`,
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
        title: `Kreacja się wypala: „${ad.adName}”`,
        description: `${ad.verdict.text}. Spada szybciej niż reszta zestawu (zwrot ${formatX(roas)} w ostatnich 7 dniach) - przy obecnym budżecie to ok. ${formatZl(a.fatigue.valueDropPerDay)} sprzedaży mniej dziennie. Czas na nową wersję.`,
      });
    }
  }
  return out;
}
