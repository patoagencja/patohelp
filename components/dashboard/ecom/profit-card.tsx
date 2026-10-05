import Link from "next/link";
import { Coins } from "lucide-react";

import { computeProfit, type EcomSettings } from "@/lib/ecom/insights";
import { cn, formatMultiple, formatPlnWhole } from "@/lib/utils";

/**
 * Profit after ads - the number a shop owner actually cares about. ROAS on its
 * own is misleading: 4x is a loss at a 20% margin and excellent at 60%. With
 * the margin set, we show what the ads earned after paying for themselves and
 * where the break-even ROAS sits.
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
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Coins className="h-4 w-4 text-emerald-500" />
          Zysk po reklamie
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          ROAS mówi, ile przychodu przyniosła reklama - ale nie, czy na niej
          zarobiliście. Po podaniu marży pokażemy realny zysk po odjęciu
          wydatków, próg rentowności i to, które kanały faktycznie zarabiają.
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
  // Gauge: ROAS position against break-even, capped at 2x break-even.
  const max = p.breakEvenRoas * 2;
  const pos = (v: number) => `${Math.min(100, (v / max) * 100)}%`;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Coins className="h-4 w-4 text-emerald-500" />
        Zysk po reklamie · {rangeLabel}
      </p>
      <p
        className={cn(
          "mt-1 text-3xl font-bold tracking-tight",
          profitable
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-rose-600 dark:text-rose-400"
        )}
      >
        {profitable ? "" : "−"}
        {formatPlnWhole(Math.abs(p.profitAfterAds))}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        marża brutto {formatPlnWhole(p.grossProfit)} − reklamy {formatPlnWhole(spend)}
      </p>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">ROAS vs próg rentowności</span>
          <span className="font-semibold">
            {p.roas !== null ? formatMultiple(p.roas) : "—"}
            <span className="ml-1 font-normal text-muted-foreground">
              / próg {formatMultiple(p.breakEvenRoas)}
            </span>
          </span>
        </div>
        <div className="relative mt-1.5 h-2.5 rounded-full bg-gradient-to-r from-rose-500/25 via-amber-400/25 to-emerald-500/30">
          <div
            className="absolute h-[18px] w-0.5 bg-foreground/60"
            style={{ left: "50%", top: "-4px" }}
            title="Próg rentowności"
          />
          {p.roas !== null ? (
            <div
              className={cn(
                "absolute h-[18px] w-[18px] -translate-x-1/2 rounded-full border-2 border-card shadow",
                roas >= p.breakEvenRoas ? "bg-emerald-500" : "bg-rose-500"
              )}
              style={{ left: pos(roas), top: "-4px" }}
            />
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">POAS (zysk na 1 zł reklamy)</dt>
          <dd className="font-semibold">
            {p.poas !== null ? formatMultiple(p.poas) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Każda złotówka w reklamie</dt>
          <dd className="font-semibold">
            {p.poas !== null
              ? `${p.poas - 1 >= 0 ? "+" : "−"}${Math.abs(p.poas - 1).toLocaleString("pl-PL", {
                  maximumFractionDigits: 2,
                  minimumFractionDigits: 2,
                })} zł zysku`
              : "—"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Marża {p.marginPct.toLocaleString("pl-PL")}%
        {settings.revenueIncludesVat ? " · przychód z GA4 pomniejszony o 23% VAT" : ""} ·
        liczone od całej sprzedaży sklepu.
      </p>
    </section>
  );
}
