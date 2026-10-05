import Link from "next/link";
import { Target, TrendingDown, TrendingUp } from "lucide-react";

import type { MonthPacing } from "@/lib/ecom/insights";
import { cn, formatMultiple, formatPlnWhole, formatSignedPct } from "@/lib/utils";

const STATUS: Record<
  MonthPacing["status"],
  { label: string; className: string } | null
> = {
  ahead: {
    label: "Wyprzedzacie cel",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  on_track: {
    label: "Na kursie do celu",
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  behind: {
    label: "Poniżej tempa",
    className: "bg-amber-500/10 text-amber-800 dark:text-amber-400",
  },
  no_goal: null,
};

/**
 * "Where will this month land?" - month-to-date revenue against the goal, with
 * an end-of-month forecast that borrows last year's shape of the month (so a
 * November forecast expects the Black Friday spike instead of extrapolating
 * October). Always about the CURRENT month, whatever range the page shows.
 */
export function MonthPacingCard({
  pacing,
  clientSlug,
  isAgency,
}: {
  pacing: MonthPacing;
  clientSlug: string;
  isAgency: boolean;
}) {
  const p = pacing;
  const status = STATUS[p.status];
  const scale = Math.max(p.goal ?? 0, p.forecastReliable ? p.forecast : 0, p.mtdRevenue, 1);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const vsLastYear =
    p.forecastReliable && p.lastYearMonthRevenue
      ? p.forecast / p.lastYearMonthRevenue - 1
      : null;
  const seasonalNote =
    p.forecastReliable && p.seasonalFactor && Math.abs(p.seasonalFactor - 1) >= 0.15
      ? p.seasonalFactor > 1
        ? `Prognoza uwzględnia zeszłoroczny rozkład - końcówka miesiąca była ok. ${formatMultiple(p.seasonalFactor, 1)} mocniejsza.`
        : `Prognoza uwzględnia zeszłoroczny rozkład - końcówka miesiąca była słabsza (${formatMultiple(p.seasonalFactor, 1)}).`
      : null;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Target className="h-4 w-4 text-primary" />
            {p.goal ? "Cel sprzedaży" : "Prognoza sprzedaży"} - {p.monthLabel}
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight">
            {formatPlnWhole(p.mtdRevenue)}
            {p.goal ? (
              <span className="ml-2 text-base font-medium text-muted-foreground">
                z {formatPlnWhole(p.goal)}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.completeDays} z {p.daysInMonth} dni zamkniętych
            {p.todayRevenue > 0 ? ` · dziś do tej pory ${formatPlnWhole(p.todayRevenue)}` : ""}
          </p>
        </div>
        {status ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
              status.className
            )}
          >
            {status.label}
          </span>
        ) : null}
      </div>

      {/* Actual (solid) vs forecast (ghost) against the goal marker. */}
      <div className="relative mt-4 h-3 overflow-hidden rounded-full bg-muted">
        {p.forecastReliable ? (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary/25"
            style={{ width: pct(p.forecast) }}
          />
        ) : null}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-700"
          style={{ width: pct(p.mtdRevenue) }}
        />
        {p.goal ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/70"
            style={{ left: `calc(${pct(p.goal)} - 1px)` }}
            title="Cel"
          />
        ) : null}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-primary" />
          zrobione
          {p.forecastReliable ? (
            <>
              <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-primary/25" />
              prognoza
            </>
          ) : null}
        </span>
        {p.goal ? <span>| cel</span> : null}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Prognoza na koniec miesiąca</dt>
          <dd className="font-semibold">
            {p.forecastReliable ? (
              <>
                {formatPlnWhole(p.forecast)}
                {p.forecastPct !== null ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {Math.round(p.forecastPct * 100)}% celu
                  </span>
                ) : null}
              </>
            ) : (
              <span className="font-normal text-muted-foreground">
                brak danych z ostatnich dni
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {p.requiredDaily !== null ? "Potrzeba dziennie do celu" : "Średnio dziennie (14 dni)"}
          </dt>
          <dd className="font-semibold">
            {p.requiredDaily !== null
              ? formatPlnWhole(p.requiredDaily)
              : formatPlnWhole(p.recentDailyAvg)}
            {p.requiredDaily !== null ? (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                teraz {formatPlnWhole(p.recentDailyAvg)}/dzień
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Ten sam miesiąc rok temu</dt>
          <dd className="font-semibold">
            {p.lastYearMonthRevenue !== null ? (
              <>
                {formatPlnWhole(p.lastYearMonthRevenue)}
                {vsLastYear !== null ? (
                  <span
                    className={cn(
                      "ml-1.5 inline-flex items-center gap-0.5 text-xs font-medium",
                      vsLastYear >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    )}
                  >
                    {vsLastYear >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {formatSignedPct(vsLastYear)} r/r
                  </span>
                ) : null}
              </>
            ) : (
              <span className="font-normal text-muted-foreground">brak danych</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">ROAS w tym miesiącu</dt>
          <dd className="font-semibold">
            {p.mtdRoas !== null ? formatMultiple(p.mtdRoas) : "—"}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              wydano {formatPlnWhole(p.mtdSpend)}
            </span>
          </dd>
        </div>
      </dl>

      {seasonalNote ? (
        <p className="mt-3 text-xs text-muted-foreground">{seasonalNote}</p>
      ) : null}
      {p.missingDays > 0 ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Brak danych GA4 z {p.missingDays} dni tego miesiąca - liczby są zaniżone.
        </p>
      ) : null}
      {!p.goal && isAgency ? (
        <p className="mt-3 text-xs">
          <Link
            href={`/${clientSlug}/settings#ecommerce`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Ustaw cel miesięczny
          </Link>{" "}
          <span className="text-muted-foreground">
            - pokażemy postęp i ile trzeba dziennie, żeby go dowieźć.
          </span>
        </p>
      ) : null}
    </section>
  );
}
