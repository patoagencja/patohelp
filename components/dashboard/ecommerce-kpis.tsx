import { ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";

import { ECOM_TERMS, withoutToday } from "@/components/dashboard/ecom/plain";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Card } from "@/components/ui/card";
import {
  GLOSSARY,
  describeChange,
  type ChangeTone,
  type GlossaryKey,
} from "@/lib/dashboard/glossary";
import type {
  EcommerceKpis as EcommerceKpisData,
  Kpi,
  TrendPoint,
} from "@/lib/dashboard/metrics";
import {
  cn,
  formatNumberPL,
  formatPlnWhole,
  formatSignedPct,
} from "@/lib/utils";

// Matches the "podobnie jak wcześniej" cut-off in describeChange so the
// number and the sentence next to it agree.
const FLAT_THRESHOLD = 3;

// Every e-commerce KPI here is "higher is better": up = green, down = red,
// tiny moves stay neutral. The arrow follows the number either way.
function delta(kpi: Kpi) {
  if (kpi.deltaPercent === null || !Number.isFinite(kpi.deltaPercent)) return null;
  const rounded = Math.round(kpi.deltaPercent * 10) / 10;
  return {
    tone:
      Math.abs(rounded) < FLAT_THRESHOLD
        ? ("flat" as const)
        : rounded > 0
          ? ("good" as const)
          : ("bad" as const),
    direction: rounded > 0 ? ("up" as const) : rounded < 0 ? ("down" as const) : null,
    text: `${Math.abs(rounded).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%`,
  };
}

function KpiTile({
  metric,
  name,
  tone,
  value,
  kpi,
  yoyRatio,
  thinBase = false,
  series,
  index,
  highlight = false,
}: {
  /** The tile the chart below draws (Sprzedaż page). */
  highlight?: boolean;
  /** Daily values (finished days, oldest -> newest) for the sparkline. */
  series?: number[];
  metric: GlossaryKey;
  /** Shorter label than the glossary's, where that one wraps in a tile. */
  name?: string;
  tone: ChangeTone;
  value: string;
  kpi: Kpi;
  yoyRatio?: number | null;
  /** Previous period too small for a meaningful % - hide it. */
  thinBase?: boolean;
  index: number;
}) {
  const g = GLOSSARY[metric];
  // Zero this period against a real baseline means missing data here, so no
  // "-100%"; the sentence still explains it.
  const d = thinBase || kpi.value === 0 ? null : delta(kpi);
  const sentence =
    kpi.value === 0 && kpi.previous > 0
      ? "brak danych w tym okresie"
      : describeChange(kpi.deltaPercent, tone, { thinBase });
  return (
    <StatTile
      // No "ROAS"/"AOV" tag here: the friendly name + ⓘ say it without jargon.
      label={name ?? g.name}
      explain={g.explain}
      value={value}
      delta={d}
      spark={series}
      index={index}
      highlight={highlight}
      // The number on the right already carries the %; the words carry direction.
      sub={d ? sentence.replace(/^o \d+% /, "") : sentence}
      foot={
        yoyRatio != null ? (
          <span className="tabular-nums" title="Ten sam okres rok temu (wyrównany do dni tygodnia)">
            <span
              className={cn("font-semibold", yoyRatio >= 0 ? "text-positive" : "text-negative")}
            >
              {formatSignedPct(yoyRatio)}
            </span>{" "}
            vs rok temu
          </span>
        ) : undefined
      }
      // Phones: a swipeable row (overview pattern), a grid from sm.
      className="w-[15rem] shrink-0 snap-start sm:w-auto"
    />
  );
}

// Fewer orders than this last period and every e-commerce % (revenue, ROAS,
// AOV) swings on one or two baskets - say "not enough data" instead.
// Exported so every card that shows a revenue change (SalesOverview, the
// story hero) applies the same cut-off.
export const MIN_PREV_TRANSACTIONS = 10;

/** Same window last year, used for the r/r line under each tile. */
export interface EcommerceYoY {
  revenue: number;
  transactions: number;
  spend: number;
}

const ratio = (cur: number, prev: number) => (prev > 0 ? cur / prev - 1 : null);

// Revenue-first KPI row for e-commerce clients: revenue, orders, return on
// ads, average basket. Sourced from GA4 purchases + ad spend. Plain numbers
// with one comparison each; the trend lives in the one chart below the row.
export function EcommerceKpis({
  data,
  trend,
  yoy,
  spend,
  heading = "Wyniki sklepu w wybranym okresie",
}: {
  data: EcommerceKpisData;
  /** Daily trend of the same window: drawn as each tile's sparkline. */
  trend?: TrendPoint[];
  /** Last year's same window; omit when last year's data is too thin. */
  yoy?: EcommerceYoY | null;
  /** Current-window ad spend (grosze), needed for the ROAS r/r line. */
  spend?: number;
  /** Small heading above the row; null where the page header already says it. */
  heading?: ReactNode | null;
}) {
  const roas = data.roas.value / 100; // stored ×100
  const curRevenue = data.revenueMinorUnits.value;
  const curTx = data.transactions.value;
  // "-100% r/r" on a period with no sales yet is a tracking gap, not news.
  const yoyRevenue = yoy && curRevenue > 0 ? ratio(curRevenue, yoy.revenue) : null;
  const yoyTx = yoy && curTx > 0 ? ratio(curTx, yoy.transactions) : null;
  const yoyRoas =
    yoy && spend && spend > 0 && yoy.spend > 0
      ? ratio(curRevenue / spend, yoy.revenue / yoy.spend)
      : null;
  const yoyAov =
    yoy && curTx > 0 && yoy.transactions > 0
      ? ratio(curRevenue / curTx, yoy.revenue / yoy.transactions)
      : null;
  const thinBase = data.transactions.previous < MIN_PREV_TRANSACTIONS;
  // A shop with no purchase events at all (tracking not set up, or the first
  // sync still running): four tiles of "0 zł / 0× / 0" look like a dead shop.
  const noSalesData =
    curRevenue === 0 &&
    curTx === 0 &&
    data.revenueMinorUnits.previous === 0 &&
    data.transactions.previous === 0;
  const hasSpend = (spend ?? 0) > 0;
  // Sparklines from finished days only: a half-synced today would end every
  // line in a cliff. Ratios skip days without a denominator.
  const days = trend ? withoutToday(trend) : [];
  const series = {
    revenue: days.map((p) => p.revenueMinorUnits),
    transactions: days.map((p) => p.transactions),
    roas: days
      .filter((p) => p.spendMinorUnits > 0)
      .map((p) => p.revenueMinorUnits / p.spendMinorUnits),
    aov: days
      .filter((p) => p.transactions > 0)
      .map((p) => p.revenueMinorUnits / p.transactions),
  };
  return (
    <section aria-label={heading ? undefined : "Wyniki sklepu"}>
      {heading ? <h2 className="kick mb-3">{heading}</h2> : null}
      {noSalesData ? (
        <Card className="flex items-start gap-3 p-6">
          <ShoppingBag className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <p className="text-sm text-ink-2">
            Sprzedaż pojawi się tutaj, gdy Google Analytics zarejestruje pierwsze
            zamówienia - wymaga to włączonego śledzenia zakupów w sklepie.
          </p>
        </Card>
      ) : (
        <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 pt-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:snap-none sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
          <KpiTile
            metric="revenue"
            index={0}
            // The page's chart below draws revenue: the board marks that tile.
            highlight={Boolean(trend)}
            series={series.revenue}
            tone="amount"
            value={formatPlnWhole(data.revenueMinorUnits.value)}
            kpi={data.revenueMinorUnits}
            thinBase={thinBase}
            yoyRatio={yoyRevenue}
          />
          <KpiTile
            metric="transactions"
            index={1}
            series={series.transactions}
            tone="amount"
            value={formatNumberPL(data.transactions.value)}
            kpi={data.transactions}
            thinBase={thinBase}
            yoyRatio={yoyTx}
          />
          <KpiTile
            metric="roas"
            index={2}
            series={series.roas}
            tone="rate"
            // Return on zero spend is undefined, not "0×" (overview passes no
            // spend - there the stored ROAS of 0 means the same thing).
            value={
              (spend !== undefined && !hasSpend) || (spend === undefined && roas === 0)
                ? "-"
                : `${roas.toLocaleString("pl-PL", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}×`
            }
            kpi={data.roas}
            thinBase={thinBase}
            yoyRatio={yoyRoas}
          />
          <KpiTile
            metric="aov"
            index={3}
            series={series.aov}
            name={ECOM_TERMS.aov.name}
            tone="amount"
            // Whole złoty: grosze in a headline number are false precision.
            value={curTx > 0 ? formatPlnWhole(data.aovMinorUnits.value) : "-"}
            kpi={data.aovMinorUnits}
            thinBase={thinBase}
            yoyRatio={yoyAov}
          />
        </div>
      )}
    </section>
  );
}
