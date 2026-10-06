import { AlertTriangle, Radio } from "lucide-react";

import { MetricLabel } from "@/components/dashboard/info-tip";
import {
  computeProfit,
  dayLabelPl,
  type ChannelEfficiency as ChannelEfficiencyData,
  type ChannelKey,
  type ChannelRow,
  type EcomSettings,
} from "@/lib/ecom/insights";
import { plPlural } from "@/lib/dashboard/story";
import { cn, formatNumberPL, formatPlnWhole } from "@/lib/utils";

import {
  aboutPln,
  ECOM_TERMS,
  pctOf,
  perHundred,
  Takeaway,
  todayWarsawIso,
  zlPerZl,
  type TakeawayTone,
} from "./plain";

/** YYYY-MM-DD minus one day (UTC maths on a plain date - no DST surprises). */
const dayBefore = (iso: string) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Where the sale came from, phrased for a sentence ("przychodzi z ..."). */
const FROM: Record<ChannelKey, string> = {
  meta: "z reklam na Facebooku i Instagramie",
  google_ads: "z reklam Google",
  tiktok: "z reklam na TikToku",
  organic_search: "z bezpłatnych wyników wyszukiwania",
  social_organic: "z bezpłatnych postów w social mediach",
  direct: "od osób, które wpisały adres sklepu",
  email: "z e-maili i newslettera",
  other: "z innych źródeł",
};

/** Short, client-friendly channel names for the table and cards. */
const NAME: Record<ChannelKey, string> = {
  meta: "Meta (Facebook, Instagram)",
  google_ads: "Reklamy Google",
  tiktok: "TikTok",
  organic_search: "Wyszukiwarka (bezpłatnie)",
  social_organic: "Social media (bezpłatnie)",
  direct: "Wejścia bezpośrednie",
  email: "E-mail / newsletter",
  other: "Pozostałe",
};

const BAR: Record<ChannelKey, string> = {
  meta: "bg-indigo-500",
  google_ads: "bg-sky-500",
  tiktok: "bg-rose-400",
  organic_search: "bg-emerald-500",
  social_organic: "bg-violet-400",
  direct: "bg-slate-400",
  email: "bg-amber-400",
  other: "bg-slate-300",
};

// Below this ratio the cost-per-order gap between platforms is too small to
// headline - "1,1× taniej" would be noise dressed up as a finding.
const MIN_CPA_GAP = 1.2;

function channelTakeaway(
  data: ChannelEfficiencyData,
  paid: ChannelRow[]
): { text: string; tone: TakeawayTone } {
  if (data.revenuePending) {
    return {
      text: "Podział sprzedaży na kanały pojawi się po najbliższym odświeżeniu danych.",
      tone: "neutral",
    };
  }
  const withRevenue = data.rows.filter((r) => r.revenue > 0);
  if (withRevenue.length === 0) {
    return {
      text: "W ostatnich 30 dniach Google Analytics nie przypisał sprzedaży żadnemu kanałowi.",
      tone: "warn",
    };
  }
  const top = [...withRevenue].sort((a, b) => b.revenue - a.revenue)[0];
  const lead = `Najwięcej sprzedaży (${pctOf(top.share)}) przychodzi ${FROM[top.channel]}`;

  const priced = paid
    .filter((r) => r.cpa !== null && r.cpa > 0)
    .sort((a, b) => (a.cpa ?? 0) - (b.cpa ?? 0));
  if (priced.length >= 2) {
    const cheap = priced[0];
    const pricey = priced[priced.length - 1];
    const gap = (pricey.cpa ?? 0) / (cheap.cpa ?? 1);
    if (gap >= MIN_CPA_GAP) {
      const gapText = gap.toLocaleString("pl-PL", { maximumFractionDigits: 1 });
      if (cheap.channel === top.channel) {
        return {
          text: `${lead} - jedno zamówienie kosztuje tam ${gapText}× mniej niż ${FROM[pricey.channel]}.`,
          tone: "good",
        };
      }
      return {
        text: `${lead}. Z płatnych kanałów najtaniej zdobywamy zamówienia ${FROM[cheap.channel]} - ${gapText}× taniej niż ${FROM[pricey.channel]}.`,
        tone: "neutral",
      };
    }
  }
  if (priced.length >= 1 && priced[0].channel === top.channel) {
    return {
      text: `${lead} - jedno zamówienie kosztuje tam ok. ${aboutPln(priced[0].cpa ?? 0)} reklam.`,
      tone: "neutral",
    };
  }
  return { text: `${lead}.`, tone: "neutral" };
}

/**
 * Which channels actually make money: GA4 last-click revenue per platform next
 * to that platform's ad spend - return per 1 zł, cost per order, purchases per
 * 100 visits and, with a margin set, whether each channel clears break-even.
 * Also catches paid traffic GA4 can't see (missing UTMs), a measurement gap
 * that silently undersells the agency's work.
 */
export function ChannelEfficiency({
  data,
  settings,
}: {
  data: ChannelEfficiencyData;
  settings: EcomSettings;
}) {
  const breakEven = computeProfit(1, 1, settings)?.breakEvenRoas ?? null;
  const paid = data.rows.filter((r) => r.spend !== null);
  const unpaid = data.rows.filter((r) => r.spend === null && r.revenue > 0);
  const rows = [...paid, ...unpaid];
  const takeaway = channelTakeaway(data, paid);
  const orders = data.rows.reduce((a, r) => a + r.transactions, 0);
  const endsYesterday = data.windowEnd === dayBefore(todayWarsawIso());

  const clears = (r: ChannelRow) =>
    breakEven !== null && r.roas !== null ? r.roas >= breakEven : null;
  const roasBadge = (r: ChannelRow) =>
    r.roas !== null ? (
      <span
        className={cn(
          "rounded px-1.5 py-0.5 font-semibold",
          clears(r) === true && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          clears(r) === false && "bg-rose-500/10 text-rose-700 dark:text-rose-400"
        )}
      >
        {zlPerZl(r.roas)}
      </span>
    ) : (
      "—"
    );

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Radio className="h-4 w-4 shrink-0 text-emerald-500" />
        Które kanały sprzedają i ile to kosztuje
      </h3>
      {/* This card always shows a fixed 30-day window (GA4's per-channel
          snapshot), not the range picked at the top - say so, or its order
          total looks like it contradicts the KPI tiles above. */}
      <p className="mt-1 text-xs text-muted-foreground">
        Okres:{" "}
        <span className="font-medium text-foreground">
          ostatnie 30 dni do {endsYesterday ? "wczoraj" : dayLabelPl(data.windowEnd)}
        </span>
        {endsYesterday ? ` (${dayLabelPl(data.windowEnd)})` : ""} - niezależnie od
        zakresu wybranego u góry, więc sumy mogą się różnić od kafelków powyżej.
      </p>

      <Takeaway tone={takeaway.tone} className="mt-3">
        {takeaway.text}
      </Takeaway>

      {data.revenuePending ? null : (
        <>
          {/* Explanations live outside the scrolling table: an ⓘ bubble
              inside an overflow container would be clipped. */}
          {/* Phones: one term per line - wrapped inline, the labels and their
              ⓘ broke into a ragged mix of half-lines. */}
          <div className="mt-4 flex flex-col items-start gap-1.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
            <span className="text-muted-foreground">Jak czytać:</span>
            <MetricLabel
              name={ECOM_TERMS.roas.name}
              tag={ECOM_TERMS.roas.tag}
              explain={ECOM_TERMS.roas.explain}
            />
            <MetricLabel name={ECOM_TERMS.cpa.name} explain={ECOM_TERMS.cpa.explain} />
            <MetricLabel
              name="Zakupy na 100 wizyt"
              tag={ECOM_TERMS.cr.tag}
              explain={ECOM_TERMS.cr.explain}
            />
          </div>

          {/* Phones: one card per channel instead of a 7-column table. */}
          <ul className="mt-4 space-y-3 sm:hidden">
            {rows.map((r) => (
              <li
                key={r.channel}
                className={cn(
                  "rounded-lg border border-border/70 p-3",
                  r.spend === null && "bg-muted/30"
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium">{NAME[r.channel]}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatPlnWhole(r.revenue)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", BAR[r.channel])}
                      style={{ width: `${Math.max(r.share * 100, 1.5)}%` }}
                    />
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                    {pctOf(r.share)} sprzedaży
                  </span>
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  {r.spend !== null ? (
                    <>
                      <div>
                        <dt className="text-muted-foreground">Wydano na reklamy</dt>
                        <dd className="font-medium tabular-nums">{formatPlnWhole(r.spend)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{ECOM_TERMS.roas.name}</dt>
                        <dd className="font-medium tabular-nums">{roasBadge(r)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{ECOM_TERMS.cpa.name}</dt>
                        <dd className="font-medium tabular-nums">
                          {r.cpa !== null ? formatPlnWhole(r.cpa) : "—"}
                        </dd>
                      </div>
                    </>
                  ) : null}
                  <div>
                    <dt className="text-muted-foreground">Zakupy na 100 wizyt</dt>
                    <dd className="font-medium tabular-nums">
                      {r.conversionRate !== null ? perHundred(r.conversionRate) : "—"}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          <div className="mt-4 hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Kanał</th>
                  <th className="pb-2 pr-4 text-right font-medium">Wydano na reklamy</th>
                  <th className="pb-2 pr-4 text-right font-medium">Sprzedaż</th>
                  <th className="pb-2 pr-4 text-right font-medium">{ECOM_TERMS.roas.name}</th>
                  <th className="pb-2 pr-4 text-right font-medium">Koszt zamówienia</th>
                  <th className="pb-2 pr-4 text-right font-medium">Zakupy na 100 wizyt</th>
                  <th className="pb-2 text-right font-medium">Część sprzedaży</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isPaid = r.spend !== null;
                  return (
                    <tr
                      key={r.channel}
                      className={cn(
                        "border-b border-border/50",
                        !isPaid && "text-muted-foreground"
                      )}
                    >
                      <td className={cn("py-2.5 pr-4", isPaid && "font-medium")}>
                        {NAME[r.channel]}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {isPaid ? formatPlnWhole(r.spend ?? 0) : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-2.5 pr-4 text-right tabular-nums",
                          isPaid && "font-semibold"
                        )}
                      >
                        {formatPlnWhole(r.revenue)}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {isPaid ? roasBadge(r) : "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {r.cpa !== null ? formatPlnWhole(r.cpa) : "—"}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-4 text-right tabular-nums">
                        {r.conversionRate !== null ? perHundred(r.conversionRate) : "—"}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{pctOf(r.share)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data.untrackedPaid.length ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <b>{data.untrackedPaid.map((c) => NAME[c]).join(", ")}</b>: budżet jest wydawany,
            ale Google Analytics nie widzi z tych reklam ani wizyt, ani sprzedaży -
            najpewniej linki w reklamach nie mają oznaczeń śledzących (UTM). Ta
            sprzedaż trafia wtedy do „Pozostałych” i zaniża wynik reklam.
          </p>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {breakEven !== null
          ? `Zielony zwrot z reklam = kanał zarabia (powyżej progu opłacalności ${zlPerZl(
              breakEven
            )}), czerwony = po odjęciu marży traci. `
          : ""}
        Zamówienie liczymy dla kanału, z którego klient przyszedł tuż przed zakupem
        (tak liczy Google Analytics). Panele Meta i Google doliczają też wcześniejsze
        kontakty z reklamą, więc zwykle pokazują więcej - to różnica metod, nie błąd.
        Łącznie {formatNumberPL(orders)}{" "}
        {plPlural(orders, "zamówienie", "zamówienia", "zamówień")}.
      </p>
    </section>
  );
}
