import Link from "next/link";

import { InfoTip, MetricLabel } from "@/components/dashboard/info-tip";
import { Card } from "@/components/ui/card";
import { computeProfit, type EcomSettings } from "@/lib/ecom/insights";
import { cn, formatPlnWhole } from "@/lib/utils";

import {
  aboutPln,
  BIG_NUM,
  CardHeading,
  ECOM_TERMS,
  SECTION_PAD,
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
      <Card className={SECTION_PAD}>
        <CardHeading note="Zysk">Zysk po reklamach</CardHeading>
        <Takeaway className="mt-3">
          Wiemy, ile sprzedaży przyniosły reklamy - ale żeby powiedzieć, czy na
          nich zarabiasz, potrzebujemy Twojej marży.
        </Takeaway>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Po jej podaniu pokażemy tu zysk po odjęciu kosztu towaru i reklam, próg
          opłacalności reklam oraz to, które kanały faktycznie zarabiają.
        </p>
        {isAgency ? (
          <Link
            href={`/${clientSlug}/settings#ecommerce`}
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-anchor px-5 text-sm font-medium text-anchor-foreground hover:bg-anchor/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Podaj marżę w Ustawieniach
          </Link>
        ) : null}
      </Card>
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
    <Card className={SECTION_PAD}>
      <CardHeading note={`Zysk · ${rangeLabel}`}>Zysk po reklamach</CardHeading>
      <Takeaway tone={takeaway.tone} className="mt-3">
        {takeaway.text}
      </Takeaway>

      <div className="mt-5 grid gap-x-8 gap-y-5 lg:grid-cols-2">
        <div className="min-w-0">
          <MetricLabel name="Zysk po reklamach" explain={PROFIT_EXPLAIN} />
          <p
            className={cn(
              "mt-2.5",
              BIG_NUM,
              profitable ? "text-positive" : "text-negative"
            )}
          >
            {profitable ? "" : "−"}
            {formatPlnWhole(Math.abs(p.profitAfterAds))}
          </p>
          <p className="mt-2 text-xs tabular-nums text-muted-foreground">
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
                className="relative mt-3 h-3 rounded-full bg-gradient-to-r from-coral/40 via-amber/35 to-lime/60"
                role="img"
                aria-label={`Zwrot z reklam ${zlPerZl(p.roas)} przy progu opłacalności ${zlPerZl(
                  p.breakEvenRoas
                )}`}
              >
                <div
                  className="absolute h-[22px] w-[3px] -translate-x-1/2 rounded-full bg-foreground"
                  style={{ left: "50%", top: "-5px" }}
                  title="Próg opłacalności"
                />
                <div
                  className={cn(
                    "absolute h-5 w-5 -translate-x-1/2 rounded-full border-[3px] border-card",
                    roas >= p.breakEvenRoas
                      ? "bg-[hsl(var(--lime-line))] shadow-[0_0_0_5px_var(--lime-glow)]"
                      : "bg-negative shadow-[0_0_0_5px_hsl(var(--coral)/0.3)]"
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

        <dl className="grid grid-cols-2 content-start gap-3 text-sm">
          <div className="col-span-2 min-w-0 rounded-[22px] bg-chip px-[18px] py-4 sm:col-span-1">
            <dt>
              <MetricLabel
                name={ECOM_TERMS.poas.name}
                tag={ECOM_TERMS.poas.tag}
                explain={ECOM_TERMS.poas.explain}
              />
            </dt>
            <dd className="mt-2 text-[22px] font-light tabular-nums tracking-[-0.03em]">
              {p.poas !== null ? `${zlPerZl(p.poas)} marży` : "—"}
            </dd>
          </div>
          <div className="col-span-2 min-w-0 rounded-[22px] bg-chip px-[18px] py-4 sm:col-span-1">
            <dt className="text-sm text-ink-2">Na czysto z każdej 1 zł reklam</dt>
            <dd
              className={cn(
                "mt-2 text-[22px] font-light tabular-nums tracking-[-0.03em]",
                netPerZl !== null && netPerZl < 0 && "text-negative"
              )}
            >
              {netPerZl !== null
                ? `${netPerZl >= 0 ? "+" : "−"}${zlPerZl(Math.abs(netPerZl))}`
                : "—"}
            </dd>
          </div>
          <p className="col-span-2 mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Liczone przy marży {p.marginPct.toLocaleString("pl-PL")}% od całej
            sprzedaży sklepu
            {settings.revenueIncludesVat ? " (po odjęciu 23% VAT)" : ""}. Nie
            obejmuje innych kosztów firmy, np. wysyłki czy wynagrodzeń.
          </p>
        </dl>
      </div>
    </Card>
  );
}
