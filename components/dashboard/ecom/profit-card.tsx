import Link from "next/link";
import { Coins } from "lucide-react";

import { InfoTip, MetricLabel } from "@/components/dashboard/info-tip";
import { computeProfit, type EcomSettings } from "@/lib/ecom/insights";
import { cn, formatPlnWhole } from "@/lib/utils";

import {
  aboutPln,
  CardEyebrow,
  ECOM_TERMS,
  Takeaway,
  zlPerZl,
  type TakeawayTone,
} from "./plain";

const PROFIT_EXPLAIN =
  "Marża ze sprzedaży (sprzedaż bez VAT minus koszt towaru) pomniejszona o wydatki na reklamy w Meta i Google. Nie obejmuje innych kosztów firmy, np. wysyłki czy wynagrodzeń.";

/**
 * Profit after ads - the number a shop owner actually cares about. A return
 * of 4 zł per 1 zł on ads is a loss at a 20% margin and excellent at 60%, so
 * with the margin set we show what the ads earned after paying for themselves
 * and where the break-even point sits.
 */
export function ProfitCard({
  revenue,
  spend,
  settings,
  rangeLabel,
  clientSlug,
  isAgency,
}: {
  revenue: number;
  spend: number;
  settings: EcomSettings;
  rangeLabel: string;
  clientSlug: string;
  isAgency: boolean;
}) {
  const p = computeProfit(revenue, spend, settings);

  if (!p) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-card p-5">
        <CardEyebrow icon={<Coins className="h-4 w-4 shrink-0 text-emerald-500" />}>
          Zysk po reklamach
        </CardEyebrow>
        <Takeaway className="mt-3">
          Wiemy, ile sprzedaży przyniosły reklamy - ale żeby powiedzieć, czy na
          nich zarabiacie, potrzebujemy Waszej marży.
        </Takeaway>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Po jej podaniu pokażemy tu zysk po odjęciu kosztu towaru i reklam, próg
          opłacalności reklam oraz to, które kanały faktycznie zarabiają.
        </p>
        {isAgency ? (
          <Link
            href={`/${clientSlug}/settings#ecommerce`}
            className="mt-3 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Podaj marżę w Ustawieniach
          </Link>
        ) : null}
      </section>
    );
  }

  const profitable = p.profitAfterAds >= 0;
  const roas = p.roas ?? 0;
  // Gauge: return position against break-even, capped at 2x break-even.
  const max = p.breakEvenRoas * 2;
  const pos = (v: number) => `${Math.min(100, (v / max) * 100)}%`;

  let takeaway: { text: string; tone: TakeawayTone };
  if (spend <= 0) {
    takeaway = {
      text:
        revenue > 0
          ? `W tym okresie nie było wydatków na reklamy - marża ze sprzedaży to ok. ${aboutPln(
              p.grossProfit
            )}.`
          : "W tym okresie nie było ani sprzedaży, ani wydatków na reklamy.",
      tone: "neutral",
    };
  } else if (revenue <= 0) {
    takeaway = {
      text: `Google Analytics nie zanotował w tym okresie sprzedaży, a reklamy kosztowały ${aboutPln(
        spend
      )}.`,
      tone: "bad",
    };
  } else if (profitable) {
    takeaway = {
      text: `Po odjęciu kosztu towaru i reklam zostaje ok. ${aboutPln(
        p.profitAfterAds
      )} zysku - reklamy na siebie zarabiają.`,
      tone: "good",
    };
  } else {
    takeaway = {
      text: `Marża ze sprzedaży nie pokryła kosztu reklam - po ich odjęciu wychodzi ok. ${aboutPln(
        p.profitAfterAds
      )} na minusie.`,
      tone: "bad",
    };
  }

  const netPerZl = p.poas !== null ? p.poas - 1 : null;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <CardEyebrow icon={<Coins className="h-4 w-4 shrink-0 text-emerald-500" />}>
        Zysk po reklamach · {rangeLabel}
      </CardEyebrow>
      <Takeaway tone={takeaway.tone} className="mt-3">
        {takeaway.text}
      </Takeaway>

      <div className="mt-5 grid gap-x-8 gap-y-5 lg:grid-cols-2">
        <div className="min-w-0">
          <MetricLabel name="Zysk po reklamach" explain={PROFIT_EXPLAIN} />
          <p
            className={cn(
              "mt-1 text-3xl font-bold tabular-nums tracking-tight",
              profitable
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            )}
          >
            {profitable ? "" : "−"}
            {formatPlnWhole(Math.abs(p.profitAfterAds))}
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            marża ze sprzedaży {formatPlnWhole(p.grossProfit)} − reklamy{" "}
            {formatPlnWhole(spend)}
          </p>

          {p.roas !== null ? (
            <div className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  {ECOM_TERMS.roas.name} a {ECOM_TERMS.breakEven.name.toLowerCase()}
                  <InfoTip
                    label={ECOM_TERMS.breakEven.name}
                    text={ECOM_TERMS.breakEven.explain}
                  />
                </span>
                <span className="font-semibold tabular-nums">
                  {zlPerZl(p.roas)}
                  <span className="ml-1 font-normal text-muted-foreground">
                    / próg {zlPerZl(p.breakEvenRoas)}
                  </span>
                </span>
              </div>
              <div
                className="relative mt-2 h-2.5 rounded-full bg-gradient-to-r from-rose-500/25 via-amber-400/25 to-emerald-500/30"
                role="img"
                aria-label={`Zwrot z reklam ${zlPerZl(p.roas)} przy progu opłacalności ${zlPerZl(
                  p.breakEvenRoas
                )}`}
              >
                <div
                  className="absolute h-[18px] w-0.5 bg-foreground/60"
                  style={{ left: "50%", top: "-4px" }}
                  title="Próg opłacalności"
                />
                <div
                  className={cn(
                    "absolute h-[18px] w-[18px] -translate-x-1/2 rounded-full border-2 border-card shadow",
                    roas >= p.breakEvenRoas ? "bg-emerald-500" : "bg-rose-500"
                  )}
                  style={{ left: pos(roas), top: "-4px" }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                <span>traci</span>
                <span>wychodzi na zero</span>
                <span>zarabia</span>
              </div>
            </div>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-4 text-sm">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <dt>
              <MetricLabel
                name={ECOM_TERMS.poas.name}
                tag={ECOM_TERMS.poas.tag}
                explain={ECOM_TERMS.poas.explain}
              />
            </dt>
            <dd className="mt-0.5 font-semibold tabular-nums">
              {p.poas !== null ? `${zlPerZl(p.poas)} marży` : "—"}
            </dd>
          </div>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <dt className="text-sm font-medium">Na czysto z każdej 1 zł reklam</dt>
            <dd
              className={cn(
                "mt-0.5 font-semibold tabular-nums",
                netPerZl !== null && netPerZl < 0 && "text-rose-600 dark:text-rose-400"
              )}
            >
              {netPerZl !== null
                ? `${netPerZl >= 0 ? "+" : "−"}${zlPerZl(Math.abs(netPerZl))}`
                : "—"}
            </dd>
          </div>
          <p className="col-span-2 text-[11px] leading-relaxed text-muted-foreground">
            Liczone przy marży {p.marginPct.toLocaleString("pl-PL")}% od całej
            sprzedaży sklepu
            {settings.revenueIncludesVat ? " (po odjęciu 23% VAT)" : ""}. Nie
            obejmuje innych kosztów firmy, np. wysyłki czy wynagrodzeń.
          </p>
        </dl>
      </div>
    </section>
  );
}
