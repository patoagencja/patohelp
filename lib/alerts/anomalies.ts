import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import { formatMoneyPLN, formatPercent } from "@/lib/utils";

const WARSAW_TZ = "Europe/Warsaw";

export type AnomalySeverity = "critical" | "high" | "medium";

export interface Anomaly {
  id: string;
  severity: AnomalySeverity;
  scope: "client" | "campaign";
  scopeLabel: string;
  metric: string;
  direction: "up" | "down";
  changePct: number; // signed, e.g. +42.3
  title: string;
  description: string;
}

// Recent window (3 full days) vs a 14-day baseline before it. Today is excluded
// because it's a partial day and would skew short-window averages.
const RECENT_DAYS = 3;
const BASE_DAYS = 14;

// Minimum baseline spend (grosze) for a campaign to be worth flagging — avoids
// noise from tiny/paused campaigns. 50 PLN.
const MIN_CAMPAIGN_SPEND = 5000;

const fmtDate = (d: Date) => formatInTimeZone(d, WARSAW_TZ, "yyyy-MM-dd");

interface Agg {
  spend: number;
  clicks: number;
  impressions: number;
}
const empty = (): Agg => ({ spend: 0, clicks: 0, impressions: 0 });
const cpc = (a: Agg) => (a.clicks > 0 ? a.spend / a.clicks : null);
const ctr = (a: Agg) => (a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null);
const perDay = (v: number, days: number) => v / days;
const change = (recent: number, base: number) =>
  base > 0 ? (recent - base) / base : null;

const sev = (absPct: number): AnomalySeverity => (absPct >= 0.6 ? "high" : "medium");

/**
 * Change-based anomaly detection: compares the last 3 days against the prior
 * 14-day baseline (account-wide and per campaign) and flags sudden spikes /
 * drops in CPC, CTR, clicks, spend and GA4 sessions. Computed live from
 * ads_daily / ga4_daily — no extra table needed. Reusable by a future
 * notification cron (e.g. WhatsApp).
 */
export async function detectAnomalies(
  clientId: string,
  client?: SupabaseClient
): Promise<Anomaly[]> {
  // Accepts an admin client so the notify cron can read past RLS (no session).
  const supabase = client ?? createClient();
  const todayStr = fmtDate(new Date());
  const today = new Date(`${todayStr}T00:00:00`);

  const recentStart = fmtDate(subDays(today, RECENT_DAYS)); // today-3
  const recentEnd = fmtDate(subDays(today, 1)); // yesterday
  const baseStart = fmtDate(subDays(today, RECENT_DAYS + BASE_DAYS)); // today-17
  const baseEnd = fmtDate(subDays(today, RECENT_DAYS + 1)); // today-4

  const inRecent = (d: string) => d >= recentStart && d <= recentEnd;
  const inBase = (d: string) => d >= baseStart && d <= baseEnd;

  const [rows, ga4Rows] = await Promise.all([
    fetchAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("ads_daily")
        .select("campaign_id, campaign_name, date, spend_minor_units, clicks, impressions")
        .eq("client_id", clientId)
        .gte("date", baseStart)
        .lte("date", recentEnd)
        .order("date", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
    ),
    fetchAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("ga4_daily")
        .select("date, sessions")
        .eq("client_id", clientId)
        .is("source_medium", null)
        .is("device_category", null)
        .is("page_path", null)
        .gte("date", baseStart)
        .lte("date", recentEnd)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const clientRecent = empty();
  const clientBase = empty();
  const campaigns = new Map<
    string,
    { name: string; recent: Agg; base: Agg }
  >();

  for (const r of rows) {
    const date = r.date as string;
    const spend = Number(r.spend_minor_units);
    const clicks = Number(r.clicks);
    const impressions = Number(r.impressions);
    const bucket = inRecent(date) ? "recent" : inBase(date) ? "base" : null;
    if (!bucket) continue;

    const c =
      campaigns.get(r.campaign_id as string) ??
      {
        name: (r.campaign_name as string) || (r.campaign_id as string),
        recent: empty(),
        base: empty(),
      };
    const target = bucket === "recent" ? c.recent : c.base;
    target.spend += spend;
    target.clicks += clicks;
    target.impressions += impressions;
    campaigns.set(r.campaign_id as string, c);

    const clientTarget = bucket === "recent" ? clientRecent : clientBase;
    clientTarget.spend += spend;
    clientTarget.clicks += clicks;
    clientTarget.impressions += impressions;
  }

  const anomalies: Anomaly[] = [];
  const pct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;

  // ---- Account-wide checks ----
  const cpcCh = change(cpc(clientRecent) ?? 0, cpc(clientBase) ?? 0);
  if (cpcCh !== null && cpcCh >= 0.3) {
    anomalies.push({
      id: "client-cpc-up",
      severity: sev(cpcCh),
      scope: "client",
      scopeLabel: "Całe konto",
      metric: "CPC",
      direction: "up",
      changePct: cpcCh * 100,
      title: `Skok CPC ${pct(cpcCh)}`,
      description: `Średni koszt kliknięcia wzrósł do ${formatMoneyPLN(
        Math.round(cpc(clientRecent) ?? 0)
      )} (baza: ${formatMoneyPLN(Math.round(cpc(clientBase) ?? 0))}).`,
    });
  }

  const ctrCh = change(ctr(clientRecent) ?? 0, ctr(clientBase) ?? 0);
  if (ctrCh !== null && ctrCh <= -0.3) {
    anomalies.push({
      id: "client-ctr-down",
      severity: sev(Math.abs(ctrCh)),
      scope: "client",
      scopeLabel: "Całe konto",
      metric: "CTR",
      direction: "down",
      changePct: ctrCh * 100,
      title: `Spadek CTR ${pct(ctrCh)}`,
      description: `CTR spadł do ${formatPercent(ctr(clientRecent) ?? 0)} (baza: ${formatPercent(
        ctr(clientBase) ?? 0
      )}).`,
    });
  }

  const clicksCh = change(
    perDay(clientRecent.clicks, RECENT_DAYS),
    perDay(clientBase.clicks, BASE_DAYS)
  );
  if (clicksCh !== null && clicksCh <= -0.4) {
    anomalies.push({
      id: "client-clicks-down",
      severity: sev(Math.abs(clicksCh)),
      scope: "client",
      scopeLabel: "Całe konto",
      metric: "Kliknięcia",
      direction: "down",
      changePct: clicksCh * 100,
      title: `Spadek kliknięć ${pct(clicksCh)}`,
      description: `Dzienne kliknięcia spadły względem ostatnich 2 tygodni.`,
    });
  }

  const spendCh = change(
    perDay(clientRecent.spend, RECENT_DAYS),
    perDay(clientBase.spend, BASE_DAYS)
  );
  if (spendCh !== null && Math.abs(spendCh) >= 0.5) {
    anomalies.push({
      id: "client-spend",
      severity: sev(Math.abs(spendCh)),
      scope: "client",
      scopeLabel: "Całe konto",
      metric: "Wydatki",
      direction: spendCh > 0 ? "up" : "down",
      changePct: spendCh * 100,
      title: `${spendCh > 0 ? "Skok" : "Spadek"} wydatków ${pct(spendCh)}`,
      description: `Dzienne wydatki ${spendCh > 0 ? "wzrosły" : "spadły"} względem ostatnich 2 tygodni.`,
    });
  }

  // GA4 sessions
  let ga4Recent = 0;
  let ga4Base = 0;
  for (const r of ga4Rows) {
    const d = r.date as string;
    const s = Number(r.sessions);
    if (inRecent(d)) ga4Recent += s;
    else if (inBase(d)) ga4Base += s;
  }
  const sessCh = change(perDay(ga4Recent, RECENT_DAYS), perDay(ga4Base, BASE_DAYS));
  if (sessCh !== null && sessCh <= -0.4 && ga4Base > 0) {
    anomalies.push({
      id: "client-sessions-down",
      severity: sev(Math.abs(sessCh)),
      scope: "client",
      scopeLabel: "Ruch na stronie",
      metric: "Sesje",
      direction: "down",
      changePct: sessCh * 100,
      title: `Spadek ruchu ${pct(sessCh)}`,
      description: `Dzienne sesje w GA4 wyraźnie spadły względem ostatnich 2 tygodni.`,
    });
  }

  // ---- Per-campaign checks ----
  // Only campaigns STILL running (spending now) that were also active before —
  // we care about in-flight degradation, not campaigns someone paused on purpose.
  for (const [id, c] of campaigns) {
    if (c.recent.spend < MIN_CAMPAIGN_SPEND || c.base.spend < MIN_CAMPAIGN_SPEND)
      continue;

    // Sudden drop in clicks while still spending ("nie dowozi").
    const clicksCampCh = change(
      perDay(c.recent.clicks, RECENT_DAYS),
      perDay(c.base.clicks, BASE_DAYS)
    );
    if (clicksCampCh !== null && clicksCampCh <= -0.5) {
      anomalies.push({
        id: `camp-${id}-clicks`,
        severity: sev(Math.abs(clicksCampCh)),
        scope: "campaign",
        scopeLabel: c.name,
        metric: "Kliknięcia",
        direction: "down",
        changePct: clicksCampCh * 100,
        title: `Spadek kliknięć ${pct(clicksCampCh)}`,
        description: `Kampania wciąż wydaje, ale dzienne kliknięcia mocno spadły względem ostatnich 2 tygodni.`,
      });
    }

    const ccpc = change(cpc(c.recent) ?? 0, cpc(c.base) ?? 0);
    if (ccpc !== null && ccpc >= 0.4) {
      anomalies.push({
        id: `camp-${id}-cpc`,
        severity: sev(ccpc),
        scope: "campaign",
        scopeLabel: c.name,
        metric: "CPC",
        direction: "up",
        changePct: ccpc * 100,
        title: `Skok CPC ${pct(ccpc)}`,
        description: `CPC wzrósł do ${formatMoneyPLN(Math.round(cpc(c.recent) ?? 0))} (baza: ${formatMoneyPLN(
          Math.round(cpc(c.base) ?? 0)
        )}).`,
      });
    }

    const cctr = change(ctr(c.recent) ?? 0, ctr(c.base) ?? 0);
    if (cctr !== null && cctr <= -0.4) {
      anomalies.push({
        id: `camp-${id}-ctr`,
        severity: sev(Math.abs(cctr)),
        scope: "campaign",
        scopeLabel: c.name,
        metric: "CTR",
        direction: "down",
        changePct: cctr * 100,
        title: `Spadek CTR ${pct(cctr)}`,
        description: `CTR spadł do ${formatPercent(ctr(c.recent) ?? 0)} (baza: ${formatPercent(
          ctr(c.base) ?? 0
        )}).`,
      });
    }
  }

  const rank = { critical: 0, high: 1, medium: 2 };
  return anomalies
    .sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] ||
        Math.abs(b.changePct) - Math.abs(a.changePct)
    )
    .slice(0, 25);
}
