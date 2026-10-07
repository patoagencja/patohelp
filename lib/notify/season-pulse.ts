// "Poranny puls sezonu": one e-mail every morning of the season for clients
// who earn in one window a year. In December a day decides more than a
// normal month, so the owner wants yesterday's numbers and today's
// decisions before the first coffee - without opening the panel.
//
// Pure: builds the content from the same SeasonView / AbView the pages use,
// so the e-mail can never disagree with the dashboard.

import type { AbView } from "@/lib/ab/types";
import { addDaysIso, dayMonthLong, diffDaysIso } from "@/lib/season/config";
import { compactPln } from "@/lib/season/format";
import type { SeasonView } from "@/lib/season/load";
import { formatNumberPL, formatPlnWhole } from "@/lib/utils";

export interface PulseLine {
  label: string;
  value: string;
  /** "+9% vs ten sam dzień tygodnia rok temu" - null when nothing to compare. */
  change: { text: string; good: boolean | null } | null;
}

export interface SeasonPulse {
  subject: string;
  /** "Sezon 2026 · dzień 71 z 85". */
  kicker: string;
  /** One sentence: how yesterday went. */
  headline: string;
  yesterday: PulseLine[];
  season: PulseLine[];
  forecast: string | null;
  actions: Array<{ title: string; detail: string; impact: string }>;
  dashboardUrl: string;
}

function pct(cur: number, prev: number, higherIsBetter = true): PulseLine["change"] {
  if (!(prev > 0)) return null;
  const r = cur / prev - 1;
  const p = Math.round(Math.abs(r) * 100);
  if (p === 0) return { text: "tyle samo co rok temu", good: null };
  const up = r > 0;
  return {
    text: `${up ? "+" : "−"}${p}% vs ten sam dzień tygodnia rok temu`,
    good: up === higherIsBetter,
  };
}

/**
 * The pulse for `view` (a running season, day ≥ 2). `ab` adds the top
 * creative decisions for shops; `showRevenue` false = clicks only (an
 * engagement client never gets sales or returns).
 */
export function buildSeasonPulse(input: {
  clientName: string;
  view: SeasonView;
  ab: AbView | null;
  showRevenue: boolean;
  dashboardUrl: string;
}): SeasonPulse | null {
  const { clientName, view, ab, showRevenue, dashboardUrl } = input;
  const { state } = view;
  if (state.phase !== "in" || (state.day ?? 0) < 2) return null;

  const cur = state.current;
  const prev = state.previous;
  const yDate = view.asOf;
  const y = diffDaysIso(cur.start, yDate);
  // Same weekday a year earlier (364 days back) on the previous season's axis.
  const j = diffDaysIso(prev.start, addDaysIso(yDate, -364));
  const day = view.days[y];
  const prevDay = j >= 0 && j < view.days.length ? view.days[j] : null;
  const shop = showRevenue ? view.shop : null;
  // Yesterday's orders that are placed but not paid yet count too: last
  // year's same day is fully paid by now, and leaving them out made every
  // morning read as a dip.
  const pendingY = shop?.pendingDays[y] ?? 0;
  const shopY = shop && shop.lastDate && shop.lastDate >= yDate ? (shop.days[y] ?? 0) + pendingY : null;
  const shopPrev = shop?.hasPrev && j >= 0 && j < (shop?.prevDays.length ?? 0) ? shop.prevDays[j] ?? 0 : null;
  const spend = day?.spend ?? 0;
  const prevSpend = prevDay?.prevSpend ?? 0;

  const yesterday: PulseLine[] = [];
  let headline: string;
  if (shop && shopY !== null) {
    yesterday.push({
      label: pendingY > 0 ? `Sprzedaż sklepu (w tym ${formatPlnWhole(pendingY)} czeka na płatność)` : "Sprzedaż sklepu",
      value: formatPlnWhole(shopY),
      change: shopPrev !== null ? pct(shopY, shopPrev) : null,
    });
    yesterday.push({ label: "Zamówienia", value: formatNumberPL(shop.orderDays[y] ?? 0), change: null });
  } else if (showRevenue) {
    const v = day?.value ?? 0;
    yesterday.push({ label: "Sprzedaż z reklam (wg Meta i Google)", value: formatPlnWhole(v), change: pct(v, prevDay?.prevValue ?? 0) });
  } else {
    const c = day?.clicks ?? 0;
    yesterday.push({ label: "Kliknięcia", value: formatNumberPL(c), change: pct(c, prevDay?.prevClicks ?? 0) });
  }
  yesterday.push({ label: "Wydatki na reklamy", value: formatPlnWhole(spend), change: null });
  if (shop && shopY !== null && spend > 0) {
    yesterday.push({
      label: "Zwrot ze sklepu",
      value: `${(shopY / spend).toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`,
      change: shopPrev !== null && prevSpend > 0 ? pct(shopY / spend, shopPrev / prevSpend) : null,
    });
  }

  const lead = yesterday[0];
  headline = `Wczoraj (${dayMonthLong(yDate)}): ${lead.label.replace(/ \(w tym.*$/, "").toLowerCase()} ${lead.value}${
    lead.change ? `, ${lead.change.text}` : ""
  }.`;
  if (shop && shopY === null && shop.lastDate) {
    headline += ` Sklep przysłał dane do ${dayMonthLong(shop.lastDate)}.`;
  }

  const season: PulseLine[] = [];
  if (shop) {
    season.push({
      label: "Sprzedaż sklepu od początku sezonu",
      value: compactPln(shop.totals.revenue),
      change: shop.hasPrev && shop.prevSamePoint.revenue > 0
        ? { text: `${shop.totals.revenue >= shop.prevSamePoint.revenue ? "+" : "−"}${Math.round(Math.abs(shop.totals.revenue / shop.prevSamePoint.revenue - 1) * 100)}% vs ten sam moment sezonu ${prev.year}`, good: shop.totals.revenue >= shop.prevSamePoint.revenue }
        : null,
    });
  } else if (showRevenue) {
    season.push({
      label: "Sprzedaż z reklam od początku sezonu",
      value: compactPln(view.totals.value),
      change: view.prevSamePoint.value > 0
        ? { text: `${view.totals.value >= view.prevSamePoint.value ? "+" : "−"}${Math.round(Math.abs(view.totals.value / view.prevSamePoint.value - 1) * 100)}% vs ten sam moment sezonu ${prev.year}`, good: view.totals.value >= view.prevSamePoint.value }
        : null,
    });
  }
  season.push({ label: "Wydatki od początku sezonu", value: compactPln(view.totals.spend), change: null });

  const f = shop ? shop.forecast : showRevenue ? view.forecast : null;
  const forecast = f
    ? `${f.preliminary ? "Prognoza wstępna" : "Prognoza"}: ok. ${compactPln(f.value)} ${
        shop ? "sprzedaży sklepu" : "sprzedaży z reklam"
      } na koniec sezonu (zakres ${compactPln(f.low)} - ${compactPln(f.high)}).`
    : null;

  const actions = (ab?.available ? ab.actions : [])
    .filter((a) => a.kind !== "watch")
    .slice(0, 3)
    .map((a) => ({
      title: a.title,
      detail: a.detail,
      impact: a.impactPerDay > 0 ? `~+${compactPln(a.impactPerDay)} sprzedaży dziennie` : "",
    }));

  return {
    subject: `Puls sezonu · ${clientName} · ${dayMonthLong(yDate)}`,
    kicker: `Sezon ${cur.year} · dzień ${state.day} z ${state.totalDays}`,
    headline,
    yesterday,
    season,
    forecast,
    actions,
    dashboardUrl,
  };
}

// --------------------------------------------------------------- e-mail

// Table layout, inline styles (Gmail/Outlook strip <style>); the palette is
// the weekly digest's (lib/notify/weekly-digest.ts).
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function lineRows(lines: PulseLine[]): string {
  return lines
    .map((l) => {
      const color = !l.change || l.change.good === null ? "#64748b" : l.change.good ? "#15803d" : "#b91c1c";
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#334155">${esc(l.label)}${
          l.change ? `<div style="margin-top:2px;font-size:12.5px;color:${color};font-weight:600">${esc(l.change.text)}</div>` : ""
        }</td>
        <td align="right" valign="top" style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:18px;font-weight:800;color:#0f172a;white-space:nowrap">${esc(l.value)}</td>
      </tr>`;
    })
    .join("");
}

function sectionTitle(text: string): string {
  return `<div style="font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;margin:0 0 6px">${esc(text)}</div>`;
}

export function buildSeasonPulseEmail(p: SeasonPulse): { subject: string; html: string } {
  const section = (inner: string, top = 24) =>
    `<tr><td style="padding:${top}px 28px 0">${inner}</td></tr>`;
  const actions = p.actions.length
    ? section(
        `${sectionTitle("Do decyzji dziś")}${p.actions
          .map(
            (a) => `<div style="margin-top:10px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
              <div style="font-size:14px;font-weight:700;color:#0f172a">${esc(a.title)}</div>
              <div style="margin-top:4px;font-size:13px;line-height:1.45;color:#475569">${esc(a.detail)}</div>
              ${a.impact ? `<div style="margin-top:6px;font-size:13px;font-weight:700;color:#15803d">${esc(a.impact)}</div>` : ""}
            </div>`
          )
          .join("")}`
      )
    : "";
  const html = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9">
<div style="display:none;max-height:0;overflow:hidden">${esc(p.headline)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9">
<tr><td align="center" style="padding:24px 10px;font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
  <tr><td style="background:#0f172a;padding:24px 28px;color:#ffffff">
    <div style="font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#a3e635">Puls sezonu</div>
    <div style="margin-top:6px;font-size:13px;color:#cbd5e1">${esc(p.kicker)}</div>
  </td></tr>
  ${section(`<div style="font-size:18px;line-height:1.45;font-weight:700;color:#0f172a">${esc(p.headline)}</div>`)}
  ${section(`${sectionTitle("Wczoraj")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lineRows(p.yesterday)}</table>`)}
  ${section(`${sectionTitle("Sezon")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lineRows(p.season)}</table>${
    p.forecast ? `<div style="margin-top:12px;font-size:14px;line-height:1.5;color:#334155">${esc(p.forecast)}</div>` : ""
  }`)}
  ${actions}
  ${section(`<a href="${esc(p.dashboardUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:999px">Otwórz sezon w panelu</a>`)}
  <tr><td style="padding:22px 28px 26px;font-size:12px;line-height:1.5;color:#94a3b8">Wysyłamy codziennie rano w trakcie sezonu. Liczby z wczoraj mogą jeszcze lekko urosnąć (zamówienia opłacane później, opóźnione konwersje w Meta i Google).</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject: p.subject, html };
}
