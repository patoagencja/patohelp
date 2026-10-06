import Link from "next/link";

import { Button } from "@/components/ui/button";
import { HalfGauge } from "@/components/ui/gauge";
import { Input } from "@/components/ui/input";
import type { PacingFlight } from "@/lib/alerts/pacing";
import type { EngagementGoal, GoalMetric } from "@/lib/dashboard/goals";
import type { BudgetStatus } from "@/lib/dashboard/overview";
import type { MonthPacing } from "@/lib/ecom/insights";
import { cn, formatNumberPL } from "@/lib/utils";

/**
 * "Plan miesiąca": everything that answers "are we on plan?" in one card -
 * the monthly budget, the client's goals (engagement), the shop's revenue
 * goal and campaign flight targets (DRE). Before, four widgets in four visual
 * languages (cards, bars, rings) asked the same question. Now: at most three
 * bullet-style bars, each with a tick where we should be today.
 */

type RowTone = "good" | "warn" | "bad" | "neutral";

export interface PlanRow {
  key: string;
  label: string;
  /** "12 400 zł z 20 000 zł" */
  value: string;
  /** Filled share of the bar, 0-100. */
  pct: number;
  /** Where we should be today (linear plan), 0-100; null hides the tick. */
  marker: number | null;
  tone: RowTone;
  /** One short plain sentence: on plan, behind, ahead. */
  note: string;
}

const MAX_ROWS = 3;

const MONTHS_PL = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
];

const GOAL_NAME: Record<GoalMetric, string> = {
  sessions: "Wizyty na stronie",
  clicks: "Kliknięcia w reklamy",
  impressions: "Wyświetlenia reklam",
  conversions: "Działania na stronie",
};

const FLIGHT_METRIC: Record<PacingFlight["metric"], string> = {
  clicks: "kliknięcia",
  impressions: "wyświetlenia",
  spend: "wydatki",
  conversions: "działania",
};

// Always group thousands ("7 581 zł"); pl-PL Intl skips 4-digit grouping.
function wholePln(minorUnits: number): string {
  const n = Math.round(minorUnits / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n} zł`;
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/** Build the (at most three) rows; empty when nothing is planned. */
export function buildPlanRows({
  budget,
  goals = [],
  monthPacing = null,
  flights = [],
}: {
  budget?: BudgetStatus | null;
  goals?: EngagementGoal[];
  monthPacing?: MonthPacing | null;
  flights?: PacingFlight[];
}): PlanRow[] {
  const rows: PlanRow[] = [];

  if (budget?.hasBudget) {
    const idx = Number(budget.month.slice(5, 7)) - 1;
    const pace = budget.pace;
    rows.push({
      key: "budget",
      label: idx >= 0 && idx < 12 ? `Budżet na ${MONTHS_PL[idx]}` : "Budżet miesięczny",
      value: `${wholePln(budget.spentMinorUnits)} z ${wholePln(budget.budgetMinorUnits)}`,
      pct: clamp(budget.spentPercent),
      marker: clamp(budget.monthPercent),
      tone: pace === "fast" ? "bad" : pace === "slow" ? "warn" : "good",
      note:
        budget.spentMinorUnits >= budget.budgetMinorUnits
          ? "Budżet na ten miesiąc jest już wykorzystany."
          : budget.spentMinorUnits <= 0
            ? "Wydatki pojawią się po najbliższej synchronizacji."
            : pace === "fast"
              ? "Wydajemy szybciej niż plan."
              : pace === "slow"
                ? "Wydajemy wolniej niż plan."
                : "Wydajemy zgodnie z planem.",
    });
  }

  if (monthPacing?.goal && monthPacing.progressPct !== null) {
    const p = monthPacing;
    rows.push({
      key: "revenue",
      label: "Sprzedaż - cel na miesiąc",
      value: `${wholePln(p.mtdRevenue)} z ${wholePln(p.goal ?? 0)}`,
      pct: clamp((p.progressPct ?? 0) * 100),
      marker: p.daysInMonth > 0 ? clamp((p.completeDays / p.daysInMonth) * 100) : null,
      tone: p.status === "behind" ? "warn" : p.status === "no_goal" ? "neutral" : "good",
      note: !p.forecastReliable
        ? "Brakuje danych z ostatnich dni - prognozę pokażemy później."
        : p.status === "ahead"
          ? "Idziemy przed planem."
          : p.status === "behind"
            ? "Sprzedaż poniżej tempa potrzebnego do celu."
            : "Idziemy zgodnie z planem.",
    });
  }

  for (const g of goals) {
    const done = g.achievedOn !== null;
    rows.push({
      key: `goal-${g.metric}`,
      label: `${GOAL_NAME[g.metric]} - cel`,
      value: `${formatNumberPL(g.actual)} z ${formatNumberPL(g.target)}`,
      pct: clamp(g.target > 0 ? (g.actual / g.target) * 100 : 0),
      marker: done || g.daysInMonth <= 0 ? null : clamp((g.completeDays / g.daysInMonth) * 100),
      tone: done || g.status === "ahead" || g.status === "on_track" ? "good" : g.status === "behind" ? "warn" : "neutral",
      note: done
        ? "Cel osiągnięty."
        : g.status === "ahead"
          ? "Idziemy przed planem."
          : g.status === "on_track"
            ? "Idziemy zgodnie z planem."
            : g.status === "behind"
              ? "Poniżej tempa potrzebnego do celu."
              : "Za mało danych, by uczciwie ocenić tempo.",
    });
  }

  for (const f of flights) {
    if (f.status === "upcoming" || f.status === "ended") continue;
    const money = f.metric === "spend";
    const fmt = (v: number) => (money ? wholePln(v) : formatNumberPL(v));
    rows.push({
      key: `flight-${f.id}`,
      label: `${f.campaignName} - ${FLIGHT_METRIC[f.metric]}`,
      value: `${fmt(f.realized)} z ${fmt(f.target)}`,
      pct: clamp(f.realizedPct * 100),
      marker: f.realizedPct >= 1 ? null : clamp(f.expectedPct * 100),
      tone:
        f.realizedPct >= 1 || f.status === "ahead" || f.status === "on_track"
          ? "good"
          : "warn",
      note:
        f.realizedPct >= 1
          ? "Cel kampanii osiągnięty."
          : f.status === "behind"
            ? `Poniżej planu · ${f.daysLeft} ${f.daysLeft === 1 ? "dzień" : "dni"} do końca.`
            : `Zgodnie z planem · ${f.daysLeft} ${f.daysLeft === 1 ? "dzień" : "dni"} do końca.`,
    });
  }

  return rows.slice(0, MAX_ROWS);
}

// Striped fills (benchmark 4 "Sales Goals"): lime when on plan, amber when
// behind, red when overspending. The percent and the note say it in words.
const FILL: Record<RowTone, string> = {
  good: "bg-lime",
  neutral: "bg-olive",
  warn: "bg-warning-fill",
  bad: "bg-negative",
};

const PCT_TEXT: Record<RowTone, string> = {
  good: "text-positive",
  neutral: "text-foreground",
  warn: "text-warning",
  bad: "text-negative",
};

const DOT: Record<RowTone, string> = {
  good: "bg-lime",
  neutral: "bg-muted-foreground",
  warn: "bg-warning-fill",
  bad: "bg-negative",
};

function valueText(row: PlanRow) {
  return `${row.value}${
    row.marker !== null ? `, według planu dziś ok. ${Math.round(row.marker)}%` : ""
  }`;
}

function Note({ row }: { row: PlanRow }) {
  return (
    <p className="mt-2 flex items-start gap-2 text-[13px] leading-snug text-muted-foreground">
      <span aria-hidden className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", DOT[row.tone])} />
      {row.note}
    </p>
  );
}

/** The main goal as a half-donut gauge with the big percent inside. */
function GaugeRow({ row }: { row: PlanRow }) {
  return (
    <li className="min-w-0">
      <p className="truncate text-sm font-medium text-muted-foreground" title={row.label}>
        {row.label}
      </p>
      <div
        role="progressbar"
        aria-label={row.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(row.pct)}
        aria-valuetext={valueText(row)}
        className="mt-3"
      >
        <HalfGauge pct={row.pct} marker={row.marker} tone={row.tone}>
          <span
            className={cn(
              "text-[2.25rem] font-medium leading-none tracking-[-0.035em] tabular-nums",
              PCT_TEXT[row.tone]
            )}
          >
            {Math.round(row.pct)}
            <span className="ml-0.5 text-xl">%</span>
          </span>
          <span className="mt-1.5 text-[13px] tabular-nums text-muted-foreground">{row.value}</span>
        </HalfGauge>
      </div>
      <Note row={row} />
    </li>
  );
}

/** Secondary goals: label + big percent, a thick striped bar, the note. */
function Row({ row }: { row: PlanRow }) {
  return (
    <li className="min-w-0">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={row.label}>
            {row.label}
          </p>
          <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">{row.value}</p>
        </div>
        <p
          className={cn(
            "shrink-0 text-2xl font-medium leading-none tracking-[-0.03em] tabular-nums",
            PCT_TEXT[row.tone]
          )}
        >
          {Math.round(row.pct)}
          <span className="ml-0.5 text-base">%</span>
        </p>
      </div>
      <div className="relative mt-2.5">
        <div
          className="h-3.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={row.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(row.pct)}
          aria-valuetext={valueText(row)}
        >
          <div
            className={cn("bg-stripes h-full rounded-full", FILL[row.tone])}
            style={{ width: `${Math.max(row.pct, row.pct > 0 ? 4 : 0)}%` }}
          />
        </div>
        {row.marker !== null ? (
          <span
            aria-hidden
            className="absolute -top-1 h-[1.375rem] w-[3px] -translate-x-1/2 rounded-full bg-foreground ring-2 ring-card"
            style={{ left: `${row.marker}%` }}
          />
        ) : null}
      </div>
      <Note row={row} />
    </li>
  );
}

export function PlanCard({
  rows,
  budget,
  clientSlug,
  isAgency,
  setBudgetAction,
  showGoalsLink = true,
  className,
}: {
  rows: PlanRow[];
  /** For the agency's budget form (current amount, or none set). */
  budget?: BudgetStatus | null;
  clientSlug: string;
  isAgency: boolean;
  setBudgetAction?: (formData: FormData) => Promise<void>;
  /** Engagement clients set goals in settings; shops pace on Sprzedaż. */
  showGoalsLink?: boolean;
  className?: string;
}) {
  if (rows.length === 0 && !isAgency) return null;
  const hasMarker = rows.some((r) => r.marker !== null);

  return (
    // #budzet: the agency to-do list deep-links here ("ustaw budżet").
    <section
      id="budzet"
      aria-labelledby="plan-heading"
      className={cn("surface scroll-mt-24 p-5 sm:p-6", className)}
    >
      <h2 id="plan-heading" className="text-section-title">
        Plan miesiąca
      </h2>
      {rows.length > 0 ? (
        <>
          {/* md..xl the card spans the full column under the chart: gauge
              left, goal bars right, instead of one tall sparse stack. */}
          <ul
            className={cn(
              "mt-4 space-y-6",
              rows.length > 1 &&
                "md:grid md:grid-cols-2 md:items-start md:gap-x-10 md:gap-y-6 md:space-y-0 md:[&>li:first-child]:row-span-3 xl:block xl:space-y-6"
            )}
          >
            {rows.map((r, i) =>
              // The first row is the month's main question (usually the
              // budget): a gauge. The rest: Sales-Goals style bars.
              i === 0 ? <GaugeRow key={r.key} row={r} /> : <Row key={r.key} row={r} />
            )}
          </ul>
          {hasMarker ? (
            <p className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-foreground" />
              tu powinniśmy być dzisiaj według planu
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Nie ustawiono budżetu ani celów na ten miesiąc.
        </p>
      )}

      {isAgency ? (
        <div
          data-print-hide
          data-present-hide
          className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border pt-4"
        >
          {setBudgetAction ? (
            <form action={setBudgetAction} className="flex items-center gap-2">
              <input type="hidden" name="client" value={clientSlug} />
              <Input
                name="amount"
                type="number"
                min="1"
                step="0.01"
                required
                defaultValue={
                  budget?.hasBudget ? (budget.budgetMinorUnits / 100).toString() : undefined
                }
                placeholder="np. 15000"
                className="h-8 w-28 text-sm"
                aria-label="Budżet miesięczny w zł"
              />
              <Button type="submit" variant="outline" size="sm">
                {budget?.hasBudget ? "Zmień budżet" : "Ustaw budżet"}
              </Button>
            </form>
          ) : null}
          {showGoalsLink ? (
            <Link
              href={`/${clientSlug}/settings#cele`}
              className="rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ustaw cele
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
