import { format, getDaysInMonth, startOfMonth, subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

const WARSAW_TZ = "Europe/Warsaw";

export interface AlertCandidate {
  severity: "info" | "warning" | "critical";
  category: string;
  title: string;
  description: string;
  campaignId: string | null;
  provider: string | null;
}

const pln = (minor: number) => `${(minor / 100).toFixed(2)} PLN`;

/**
 * Evaluate alert rules on recent ads_daily data (+ monthly budget pace).
 * Pure evaluation — persistence and dedup happen in the cron.
 */
export async function evaluateAlerts(
  admin: SupabaseClient,
  clientId: string
): Promise<AlertCandidate[]> {
  const now = new Date();
  const todayStr = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const today = new Date(`${todayStr}T00:00:00`);
  const start21 = format(subDays(today, 20), "yyyy-MM-dd");
  const start7 = format(subDays(today, 6), "yyyy-MM-dd");
  const last24h = format(subDays(today, 1), "yyyy-MM-dd");
  const baselineEnd = format(subDays(today, 3), "yyyy-MM-dd");
  const monthStart = format(startOfMonth(today), "yyyy-MM-dd");

  const [adsRes, budgetRes, monthSpendRes] = await Promise.all([
    admin
      .from("ads_daily")
      .select(
        "provider, campaign_id, campaign_name, date, spend_minor_units, clicks, impressions, frequency"
      )
      .eq("client_id", clientId)
      .gte("date", start21),
    admin
      .from("client_budgets")
      .select("budget_minor_units")
      .eq("client_id", clientId)
      .eq("month", monthStart)
      .eq("platform", "total")
      .maybeSingle(),
    admin
      .from("ads_daily")
      .select("spend_minor_units")
      .eq("client_id", clientId)
      .gte("date", monthStart),
  ]);

  const rows = adsRes.data ?? [];
  const alerts: AlertCandidate[] = [];

  interface Camp {
    name: string;
    provider: string;
    recentSpend: number; // last 3 days
    recentClicks: number;
    recentImpr: number;
    baseSpend: number; // preceding 14 days
    baseClicks: number;
    last24Impr: number;
    prior7Spend: number; // spend in days -7..-2 (activity signal)
    week7Clicks: number;
    week7Impr: number;
    freqSum: number;
    freqCount: number;
  }
  const camps = new Map<string, Camp>();
  let clientWeekClicks = 0;
  let clientWeekImpr = 0;

  for (const r of rows) {
    const d = r.date as string;
    const spend = Number(r.spend_minor_units);
    const clicks = Number(r.clicks);
    const impr = Number(r.impressions);
    const key = `${r.provider}:${r.campaign_id}`;
    const c =
      camps.get(key) ??
      ({
        name: (r.campaign_name as string) || (r.campaign_id as string),
        provider: r.provider as string,
        recentSpend: 0,
        recentClicks: 0,
        recentImpr: 0,
        baseSpend: 0,
        baseClicks: 0,
        last24Impr: 0,
        prior7Spend: 0,
        week7Clicks: 0,
        week7Impr: 0,
        freqSum: 0,
        freqCount: 0,
      } as Camp);

    if (d > baselineEnd) {
      c.recentSpend += spend;
      c.recentClicks += clicks;
      c.recentImpr += impr;
    } else {
      c.baseSpend += spend;
      c.baseClicks += clicks;
    }
    if (d >= last24h) c.last24Impr += impr;
    if (d >= format(subDays(today, 7), "yyyy-MM-dd") && d < last24h) {
      c.prior7Spend += spend;
    }
    if (d >= start7) {
      c.week7Clicks += clicks;
      c.week7Impr += impr;
      clientWeekClicks += clicks;
      clientWeekImpr += impr;
      if (r.frequency != null) {
        c.freqSum += Number(r.frequency);
        c.freqCount += 1;
      }
    }
    camps.set(key, c);
  }

  const clientAvgCtr =
    clientWeekImpr > 0 ? (clientWeekClicks / clientWeekImpr) * 100 : 0;

  for (const [key, c] of camps) {
    const campaignId = key.split(":").slice(1).join(":");
    const providerLabel = c.provider === "meta_ads" ? "Meta" : "Google";

    // zero_impressions: was spending, now silent.
    if (c.prior7Spend > 0 && c.last24Impr === 0) {
      alerts.push({
        severity: "critical",
        category: "zero_impressions",
        title: `Kampania "${c.name}" przestała się wyświetlać`,
        description: `${providerLabel}: kampania wydawała budżet w ostatnim tygodniu, ale ma 0 wyświetleń w ostatnich 24h. Sprawdź status i budżet kampanii.`,
        campaignId,
        provider: c.provider,
      });
      continue;
    }

    // high_cpc: recent CPC 2x its own 14-day baseline.
    const recentCpc = c.recentClicks > 0 ? c.recentSpend / c.recentClicks : null;
    const baseCpc = c.baseClicks > 0 ? c.baseSpend / c.baseClicks : null;
    if (
      recentCpc != null &&
      baseCpc != null &&
      baseCpc > 0 &&
      recentCpc > 2 * baseCpc &&
      c.recentSpend > 1000 // ignore sub-10 PLN noise
    ) {
      alerts.push({
        severity: "warning",
        category: "high_cpc",
        title: `Rosnący CPC w kampanii "${c.name}"`,
        description: `${providerLabel}: CPC z ostatnich 3 dni (${pln(Math.round(recentCpc))}) jest ponad 2× wyższy niż średnia z poprzednich 14 dni (${pln(Math.round(baseCpc))}).`,
        campaignId,
        provider: c.provider,
      });
    }

    // low_ctr vs client average (7 days).
    const ctr7 = c.week7Impr > 0 ? (c.week7Clicks / c.week7Impr) * 100 : null;
    if (
      ctr7 != null &&
      clientAvgCtr > 0 &&
      c.week7Impr > 1000 &&
      ctr7 < 0.5 * clientAvgCtr
    ) {
      alerts.push({
        severity: "info",
        category: "low_ctr",
        title: `Niski CTR w kampanii "${c.name}"`,
        description: `${providerLabel}: CTR z 7 dni (${ctr7.toFixed(2)}%) jest poniżej połowy średniej konta (${clientAvgCtr.toFixed(2)}%). Warto przejrzeć kreacje lub targetowanie.`,
        campaignId,
        provider: c.provider,
      });
    }

    // high_frequency (Meta only).
    const avgFreq = c.freqCount > 0 ? c.freqSum / c.freqCount : 0;
    if (c.provider === "meta_ads" && avgFreq > 4) {
      alerts.push({
        severity: "warning",
        category: "high_frequency",
        title: `Wysoka częstotliwość w kampanii "${c.name}"`,
        description: `Meta: średnia częstotliwość ${avgFreq.toFixed(1)} w ostatnich 7 dniach — odbiorcy widzą reklamy zbyt często, czas na nowe kreacje.`,
        campaignId,
        provider: c.provider,
      });
    }
  }

  // Budget pace.
  const budget = Number(budgetRes.data?.budget_minor_units ?? 0);
  if (budget > 0) {
    const spent = (monthSpendRes.data ?? []).reduce(
      (sum, r) => sum + Number(r.spend_minor_units),
      0
    );
    const monthPct = (today.getDate() / getDaysInMonth(today)) * 100;
    const spentPct = (spent / budget) * 100;

    if (spentPct > 90 && monthPct < 80) {
      alerts.push({
        severity: "warning",
        category: "budget_pace_fast",
        title: "Budżet miesięczny prawie wyczerpany",
        description: `Wydano ${pln(spent)} z ${pln(budget)} (${Math.round(spentPct)}%) przy ${Math.round(monthPct)}% miesiąca. Przy tym tempie budżet skończy się przed końcem miesiąca.`,
        campaignId: null,
        provider: null,
      });
    } else if (spentPct < 60 && monthPct > 80) {
      alerts.push({
        severity: "info",
        category: "budget_pace_slow",
        title: "Wydatki poniżej planu miesięcznego",
        description: `Wydano ${pln(spent)} z ${pln(budget)} (${Math.round(spentPct)}%) przy ${Math.round(monthPct)}% miesiąca. Część budżetu pozostanie niewykorzystana.`,
        campaignId: null,
        provider: null,
      });
    }
  }

  return alerts;
}
