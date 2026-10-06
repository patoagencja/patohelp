import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PacingFlight } from "@/lib/alerts/pacing";
import type { EngagementGoal, GoalMetric } from "@/lib/dashboard/goals";
import type { BudgetStatus } from "@/lib/dashboard/overview";
import type { MonthPacing } from "@/lib/ecom/insights";
import { cn, formatNumberPL } from "@/lib/utils";

/**
 * "Plan miesiąca": everything that answers "are we on plan?" in one card -
 * the monthly budget, the client's goals (engagement), the shop's revenue
 * goal and campaign flight targets (DRE). 2026 (Przeglad-pastel): at most
 * three concentric rings, each with a dot where we should be today, and a
 * legend that says it in words ("w planie" / "poniżej tempa").
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
  /** Two-word status for the legend: "w planie", "poniżej tempa"... */
  short?: string;
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
      short:
        budget.spentMinorUnits >= budget.budgetMinorUnits
          ? "wykorzystany"
          : pace === "fast"
            ? "szybciej niż plan"
            : pace === "slow"
              ? "wolniej niż plan"
              : "w planie",
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
      short: p.status === "ahead" ? "przed planem" : p.status === "behind" ? "poniżej tempa" : "w planie",
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
      short: done
        ? "cel osiągnięty"
        : g.status === "ahead"
          ? "przed planem"
          : g.status === "on_track"
            ? "w planie"
            : g.status === "behind"
              ? "poniżej tempa"
              : "za mało danych",
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
      label: `${f.adsetName ?? f.campaignName} - ${FLIGHT_METRIC[f.metric]}`,
      value: `${fmt(f.realized)} z ${fmt(f.target)}`,
      pct: clamp(f.realizedPct * 100),
      marker: f.realizedPct >= 1 ? null : clamp(f.expectedPct * 100),
      tone:
        f.realizedPct >= 1 || f.status === "ahead" || f.status === "on_track"
          ? "good"
          : "warn",
      short: f.realizedPct >= 1 ? "cel osiągnięty" : f.status === "behind" ? "poniżej planu" : "w planie",
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

// Ring colours: the pastel series by position, overridden by meaning
// (amber = behind, coral = overspending). The legend says it in words.
const SERIES = ["stroke-lime", "stroke-mint", "stroke-violet"];
const SERIES_DOT = ["bg-lime", "bg-mint", "bg-violet"];
const TONE_STROKE: Partial<Record<RowTone, string>> = { warn: "stroke-amber", bad: "stroke-coral" };
const TONE_DOT: Partial<Record<RowTone, string>> = { warn: "bg-amber", bad: "bg-coral" };
const PCT_TEXT: Record<RowTone, string> = {
  good: "text-foreground",
  neutral: "text-foreground",
  warn: "text-warning",
  bad: "text-negative",
};

const RADII = [110, 84, 58];
const C = 130;

function valueText(row: PlanRow) {
  return `${row.value}${
    row.marker !== null ? `, według planu dziś ok. ${Math.round(row.marker)}%` : ""
  }. ${row.note}`;
}

/** Concentric progress rings, one per plan row, with "today" dots. */
function Rings({ rows, day, days }: { rows: PlanRow[]; day: number; days: number }) {
  return (
    <svg
      viewBox="0 0 260 260"
      aria-hidden
      className="h-[200px] w-[200px] shrink-0 sm:h-[232px] sm:w-[232px]"
    >
      <g transform={`rotate(-90 ${C} ${C})`}>
        {rows.map((r, i) => (
          <circle key={`t-${r.key}`} cx={C} cy={C} r={RADII[i]} fill="none" strokeWidth={22} className="stroke-chip" />
        ))}
        {rows.map((r, i) => (
          <circle
            key={r.key}
            cx={C}
            cy={C}
            r={RADII[i]}
            fill="none"
            strokeWidth={22}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100 100"
            className={cn("animate-ring-fill", TONE_STROKE[r.tone] ?? SERIES[i])}
            style={
              {
                strokeDashoffset: 100 - Math.max(r.pct, r.pct > 0 ? 1 : 0),
                "--d": `${0.9 + i * 0.15}s`,
                filter: i === 0 ? "drop-shadow(0 0 6px var(--lime-glow))" : undefined,
              } as React.CSSProperties
            }
          />
        ))}
      </g>
      {/* Where we should be today (linear plan). */}
      {rows.map((r, i) => {
        if (r.marker === null) return null;
        const a = (r.marker / 100) * 2 * Math.PI - Math.PI / 2;
        return (
          <circle
            key={`m-${r.key}`}
            cx={C + RADII[i] * Math.cos(a)}
            cy={C + RADII[i] * Math.sin(a)}
            r={3.5}
            className="fill-foreground"
          />
        );
      })}
      {days > 0 ? (
        <>
          <text x={C} y={128} textAnchor="middle" className="fill-foreground text-[30px] font-light tracking-[-0.04em]">
            {day}/{days}
          </text>
          <text x={C} y={150} textAnchor="middle" className="fill-[var(--ink-3)] font-mono text-[11px] tracking-[0.14em]">
            MIESIĄCA
          </text>
        </>
      ) : null}
    </svg>
  );
}

function LegendRow({ row, index }: { row: PlanRow; index: number }) {
  const name = row.label.replace(/\s*-\s*cel$/, "");
  return (
    <li
      className="flex items-start gap-3"
      role="progressbar"
      aria-label={row.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(row.pct)}
      aria-valuetext={valueText(row)}
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 h-3 w-3 shrink-0 rounded-full",
          TONE_DOT[row.tone] ?? SERIES_DOT[index],
          index === 0 && !TONE_DOT[row.tone] && "shadow-[0_0_10px_var(--lime-glow)]"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium" title={row.label}>
            {name}
          </span>
          <span className={cn("shrink-0 font-medium tabular-nums", PCT_TEXT[row.tone])}>
            {Math.round(row.pct)}%
          </span>
        </div>
        <p className="mt-0.5 text-[13px] tabular-nums text-ink-3" title={row.note}>
          {row.value} · {row.short ?? row.note}
        </p>
      </div>
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
  const shown = rows.slice(0, RADII.length);
  const hasMarker = shown.some((r) => r.marker !== null);
  // Day of the month in Warsaw: the rings' "where we should be" frame.
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const [y, m, d] = today.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();

  return (
    // #budzet: the agency to-do list deep-links here ("ustaw budżet").
    <section
      id="budzet"
      aria-labelledby="plan-heading"
      className={cn("glass flex scroll-mt-24 flex-col gap-5 rounded-glass p-6 sm:p-7", className)}
    >
      <div>
        <p className="kick">Plan miesiąca</p>
        <h2 id="plan-heading" className="mt-2 text-[22px] font-medium tracking-[-0.03em]">
          Dzień {d} z {days}
        </h2>
      </div>
      {shown.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-7 gap-y-5">
          <Rings rows={shown} day={d} days={days} />
          <div className="flex min-w-[12rem] flex-1 flex-col gap-4">
            <ul className="flex flex-col gap-4">
              {shown.map((r, i) => (
                <LegendRow key={r.key} row={r} index={i} />
              ))}
            </ul>
            {hasMarker ? (
              <p className="flex items-center gap-2 border-t border-line pt-3 text-xs text-ink-3">
                <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-foreground" />
                kropka = gdzie powinniśmy być dziś
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nie ustawiono budżetu ani celów na ten miesiąc.
        </p>
      )}

      {isAgency ? (
        <div
          data-print-hide
          data-present-hide
          className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-4"
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
