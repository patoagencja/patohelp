import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, Title } from "@tremor/react";

import {
  PositionsFilter,
  type PositionFilter,
} from "@/components/dashboard/positions-filter";
import type { CampaignRow, CampaignStatus } from "@/lib/dashboard/metrics";
import { cn, formatMoneyPLN, formatPercent } from "@/lib/utils";

// Lightweight inline-SVG sparkline. Deliberately NOT Tremor's SparkAreaChart —
// rendering dozens of Recharts instances in an interactive table blocks clicks
// and is slow. This is pure SVG: no deps, no re-render cost, can't throw.
function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  const w = 96;
  const h = 32;
  const color = up ? "#10b981" : "#ef4444";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n > 1 ? (i / (n - 1)) * w : w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="ml-auto block"
      aria-hidden
    >
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Momentum of a position = recent-half spend vs earlier-half spend (from the
// 7-day spark). It's the "P&L %" tag that drives the LONG/SHORT colouring.
function momentum(spark: number[]): number | null {
  if (spark.length < 4) return null;
  const half = Math.floor(spark.length / 2);
  const prior = spark.slice(0, half).reduce((a, b) => a + b, 0);
  const recent = spark.slice(half).reduce((a, b) => a + b, 0);
  if (prior <= 0) return null;
  return ((recent - prior) / prior) * 100;
}

const STATUS_DOT: Record<CampaignStatus, string> = {
  active: "bg-emerald-500",
  attention: "bg-amber-500",
  critical: "bg-red-500",
  off: "bg-slate-400",
};

function Position({
  c,
  maxSpend,
}: {
  c: CampaignRow;
  maxSpend: number;
}) {
  const mom = momentum(c.spark);
  const up = (mom ?? 0) >= 0;
  const long = up; // rising spend = LONG, falling = SHORT (trading metaphor)
  const sizePct = maxSpend > 0 ? (c.spendMinorUnits / maxSpend) * 100 : 0;
  const hasSpark = c.spark.some((v) => v > 0);

  return (
    <tr className="group border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
      {/* Direction */}
      <td className="py-2.5 pr-3">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold",
            long
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          )}
        >
          {long ? "LONG" : "SHORT"}
        </span>
      </td>

      {/* Symbol: platform + name + status */}
      <td className="max-w-[18rem] py-2.5 pr-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              STATUS_DOT[c.status]
            )}
            title={c.statusReason ?? undefined}
          />
          <span className="font-mono text-[11px] font-semibold text-muted-foreground">
            {c.provider === "meta_ads" ? "META" : "GOOG"}
          </span>
          <span className="truncate text-sm" title={c.name}>
            {c.name}
          </span>
        </div>
      </td>

      {/* Size (spend) with exposure bar */}
      <td className="py-2.5 pr-3">
        <div className="flex flex-col items-end gap-1">
          <span className="font-mono text-sm tabular-nums">
            {formatMoneyPLN(c.spendMinorUnits)}
          </span>
          <span className="h-1 w-24 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                "block h-full rounded-full",
                long ? "bg-emerald-500/70" : "bg-red-500/70"
              )}
              style={{ width: `${Math.max(sizePct, 3)}%` }}
            />
          </span>
        </div>
      </td>

      {/* CTR */}
      <td className="py-2.5 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
        {formatPercent(c.ctr)}
      </td>

      {/* CPC */}
      <td className="py-2.5 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
        {c.cpcMinorUnits != null ? formatMoneyPLN(Math.round(c.cpcMinorUnits)) : "—"}
      </td>

      {/* Change (momentum) */}
      <td className="py-2.5 pr-3 text-right">
        {mom !== null ? (
          <span
            className={cn(
              "inline-flex items-center justify-end gap-0.5 font-mono text-sm font-semibold tabular-nums",
              up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            )}
          >
            {up ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {up ? "+" : ""}
            {mom.toFixed(1)}%
          </span>
        ) : (
          <span className="font-mono text-sm text-muted-foreground">—</span>
        )}
      </td>

      {/* 7d chart */}
      <td className="py-2.5 pl-1">
        {hasSpark ? (
          <Sparkline values={c.spark} up={up} />
        ) : (
          <span className="block text-right font-mono text-xs text-muted-foreground">
            —
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Campaigns rendered as open trading positions — LONG/SHORT by spend momentum,
 * exposure (spend) with a size bar, % change and a 7-day chart. Header shows
 * aggregate exposure and net momentum like a portfolio summary.
 */
export function CampaignPositions({
  campaigns,
  filter = "all",
}: {
  campaigns: CampaignRow[];
  filter?: PositionFilter;
}) {
  const base =
    filter === "active"
      ? campaigns.filter((c) => c.status !== "off")
      : filter === "attention"
        ? campaigns.filter(
            (c) => c.status === "attention" || c.status === "critical"
          )
        : campaigns;
  const filtered = [...base].sort(
    (a, b) => b.spendMinorUnits - a.spendMinorUnits
  );

  const maxSpend = filtered.reduce(
    (m, c) => Math.max(m, c.spendMinorUnits),
    0
  );
  const totalExposure = filtered.reduce((s, c) => s + c.spendMinorUnits, 0);

  // Net momentum: exposure-weighted average of per-position momentum.
  let weight = 0;
  let acc = 0;
  for (const c of filtered) {
    const m = momentum(c.spark);
    if (m === null) continue;
    weight += c.spendMinorUnits;
    acc += m * c.spendMinorUnits;
  }
  const netMomentum = weight > 0 ? acc / weight : null;
  const netUp = (netMomentum ?? 0) >= 0;

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-4">
          <Title>Pozycje</Title>
          <span className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
            <span>
              Ekspozycja{" "}
              <span className="font-semibold text-foreground">
                {formatMoneyPLN(totalExposure)}
              </span>
            </span>
            <span>
              {filtered.length} otwart{filtered.length === 1 ? "a" : "ych"}
            </span>
            {netMomentum !== null ? (
              <span
                className={cn(
                  "font-semibold",
                  netUp
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                )}
              >
                {netUp ? "▲ +" : "▼ "}
                {netMomentum.toFixed(1)}%
              </span>
            ) : null}
          </span>
        </div>

        <PositionsFilter value={filter} />
      </div>

      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Brak pozycji w tym widoku.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Kier.</th>
                <th className="py-2 pr-3 font-medium">Symbol</th>
                <th className="py-2 pr-3 text-right font-medium">Rozmiar</th>
                <th className="py-2 pr-3 text-right font-medium">CTR</th>
                <th className="py-2 pr-3 text-right font-medium">CPC</th>
                <th className="py-2 pr-3 text-right font-medium">Zmiana</th>
                <th className="py-2 pl-1 text-right font-medium">7 dni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <Position
                  key={`${c.provider}:${c.campaignId}`}
                  c={c}
                  maxSpend={maxSpend}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
