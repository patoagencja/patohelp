import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Anomaly } from "@/lib/alerts/anomalies";
import { formatNumberPL } from "@/lib/utils";

const WARSAW_TZ = "Europe/Warsaw";
const fmtDate = (d: Date) => formatInTimeZone(d, WARSAW_TZ, "yyyy-MM-dd");

const BASE_DAYS = 28;
/** Need real order volume before calling anything "broken". */
const MIN_BASE_DAILY_ORDERS = 3;

interface Day {
  sessions: number;
  transactions: number;
  revenue: number;
}

const pctLabel = (ratio: number) =>
  `${ratio > 0 ? "+" : ""}${Math.round(ratio * 100)}%`;

/**
 * Sales-side anomalies for e-commerce: the failures that cost a shop the most
 * and that ad metrics never show - a broken checkout, payment gateway or
 * purchase tag. Traffic keeps arriving (sessions normal) while orders stop.
 *
 * Only fires with meaningful order volume, and only on days that actually have
 * synced GA4 data, so a dead integration (no rows) is reported by the health
 * banner instead of masquerading as a sales collapse. Engagement clients have
 * no transactions and therefore never trigger these.
 */
export async function detectEcomAnomalies(
  clientId: string,
  supabase: SupabaseClient
): Promise<Anomaly[]> {
  const today = new Date(`${fmtDate(new Date())}T00:00:00`);
  const yesterday = fmtDate(subDays(today, 1));
  const dayBefore = fmtDate(subDays(today, 2));
  const baseStart = fmtDate(subDays(today, 1 + BASE_DAYS));
  const baseEnd = fmtDate(subDays(today, 2));

  const { data, error } = await supabase
    .from("ga4_daily")
    .select("date, sessions, transactions, revenue_minor_units")
    .eq("client_id", clientId)
    .is("source_medium", null)
    .is("device_category", null)
    .is("page_path", null)
    .gte("date", baseStart)
    .lte("date", yesterday);
  // Revenue columns missing (pre-0016) -> nothing to say.
  if (error || !data?.length) return [];

  const days = new Map<string, Day>();
  for (const r of data) {
    const d = days.get(r.date as string) ?? { sessions: 0, transactions: 0, revenue: 0 };
    d.sessions += Number(r.sessions ?? 0);
    d.transactions += Number(r.transactions ?? 0);
    d.revenue += Number(r.revenue_minor_units ?? 0);
    days.set(r.date as string, d);
  }

  // Baseline: the 28 days before yesterday (dayBefore included), days with data.
  let bSessions = 0;
  let bTx = 0;
  let bRevenue = 0;
  let bDays = 0;
  for (const [date, d] of days) {
    if (date >= baseStart && date <= baseEnd) {
      bSessions += d.sessions;
      bTx += d.transactions;
      bRevenue += d.revenue;
      bDays += 1;
    }
  }
  if (bDays < 20) return [];
  const avgSessions = bSessions / bDays;
  const avgTx = bTx / bDays;
  const avgRevenue = bRevenue / bDays;
  if (avgTx < MIN_BASE_DAILY_ORDERS || bSessions === 0) return [];
  const baseCr = bTx / bSessions;

  const out: Anomaly[] = [];
  const y = days.get(yesterday);
  const trafficNormal = (d: Day) => d.sessions >= avgSessions * 0.6;

  // 1) Orders stopped while visitors keep coming.
  if (y && trafficNormal(y) && y.transactions === 0) {
    out.push({
      id: "ecom-zero-orders",
      severity: "critical",
      scope: "client",
      scopeLabel: "Sklep",
      metric: "Zamówienia",
      direction: "down",
      changePct: -100,
      title: "Wczoraj zero zamówień przy normalnym ruchu",
      description: `${formatNumberPL(y.sessions)} sesji i 0 zamówień (zwykle ok. ${formatNumberPL(
        avgTx
      )} dziennie). Sprawdźcie koszyk, bramkę płatności i tag zakupu w GA4.`,
    });
    return out;
  }

  // 2) Conversion collapse over the last two days (more robust than one day).
  const d2 = days.get(dayBefore);
  if (y && d2 && trafficNormal(y) && trafficNormal(d2)) {
    const sessions = y.sessions + d2.sessions;
    const tx = y.transactions + d2.transactions;
    const expected = sessions * baseCr;
    if (expected >= 6) {
      const ratio = tx / expected;
      if (ratio <= 0.5) {
        out.push({
          id: "ecom-conversion-drop",
          severity: ratio <= 0.3 ? "critical" : "high",
          scope: "client",
          scopeLabel: "Sklep",
          metric: "Konwersja",
          direction: "down",
          changePct: (ratio - 1) * 100,
          title: `Konwersja sklepu ${pctLabel(ratio - 1)}`,
          description: `Ostatnie 2 dni: ${formatNumberPL(tx)} zamówień przy ${formatNumberPL(
            sessions
          )} sesjach - przy zwykłej konwersji byłoby ok. ${formatNumberPL(
            expected
          )}. Ruch jest, ale ludzie nie kupują: sprawdźcie checkout, ceny i dostępność.`,
        });
        return out;
      }
    }
  }

  // 3) Revenue slump over the last three days.
  let rRevenue = 0;
  let rDays = 0;
  for (let i = 1; i <= 3; i++) {
    const d = days.get(fmtDate(subDays(today, i)));
    if (d) {
      rRevenue += d.revenue;
      rDays += 1;
    }
  }
  if (rDays === 3 && avgRevenue > 0) {
    const ratio = rRevenue / 3 / avgRevenue;
    if (ratio <= 0.6) {
      out.push({
        id: "ecom-revenue-drop",
        severity: ratio <= 0.4 ? "high" : "medium",
        scope: "client",
        scopeLabel: "Sklep",
        metric: "Przychód",
        direction: "down",
        changePct: (ratio - 1) * 100,
        title: `Spadek przychodu ${pctLabel(ratio - 1)}`,
        description:
          "Dzienny przychód z ostatnich 3 dni wyraźnie poniżej średniej z 4 tygodni.",
      });
    }
  }

  return out;
}
