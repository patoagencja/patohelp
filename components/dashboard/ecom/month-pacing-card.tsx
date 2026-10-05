import Link from "next/link";
import { Target, TrendingDown, TrendingUp } from "lucide-react";

import { InfoTip, MetricLabel } from "@/components/dashboard/info-tip";
import type { MonthPacing } from "@/lib/ecom/insights";
import { cn, formatPlnWhole, formatSignedPct } from "@/lib/utils";

import {
  aboutPln,
  CardEyebrow,
  ECOM_TERMS,
  pctOf,
  Takeaway,
  zlPerZl,
  type TakeawayTone,
} from "./plain";

const STATUS: Record<
  MonthPacing["status"],
  { label: string; className: string } | null
> = {
  ahead: {
    label: "Przed planem",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  on_track: {
    label: "Zgodnie z planem",
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  behind: {
    label: "Poniżej tempa",
    className: "bg-amber-500/10 text-amber-800 dark:text-amber-400",
  },
  no_goal: null,
};

/**
 * One honest sentence about where the month will land. Only states a forecast
 * when the last 14 days actually have data - otherwise we'd confidently
 * predict "0 zł" from a broken integration.
 */
function pacingTakeaway(p: MonthPacing): { text: string; tone: TakeawayTone } {
  if (p.completeDays === 0) {
    return {
      text: "Miesiąc dopiero się zaczął - pierwsze pełne dane i prognozę pokażemy jutro.",
      tone: "neutral",
    };
  }
  if (!p.forecastReliable) {
    return {
      text: `Od początku miesiąca sklep sprzedał za ok. ${aboutPln(
        p.mtdRevenue
      )}. Z ostatnich dni brakuje danych, więc na razie nie podajemy prognozy.`,
      tone: "warn",
    };
  }
  const landing = `w tym tempie miesiąc skończy się ok. ${aboutPln(p.forecast)}`;
  if (p.goal && p.forecastPct !== null) {
    const diff = p.forecastPct - 1;
    const diffPct = Math.round(Math.abs(diff) * 100);
    if (diffPct === 0) {
      return {
        text: `Jesteśmy na dobrej drodze - ${landing}, czyli mniej więcej równo z celem.`,
        tone: "good",
      };
    }
    if (diff > 0) {
      return {
        text: `${
          p.status === "ahead" ? "Jesteśmy przed planem" : "Jesteśmy na dobrej drodze"
        } - ${landing}, ${diffPct}% ponad cel.`,
        tone: "good",
      };
    }
    if (p.status === "on_track") {
      return {
        text: `Jesteśmy blisko celu - ${landing}, ${diffPct}% poniżej. Kilka mocniejszych dni wystarczy.`,
        tone: "neutral",
      };
    }
    return {
      text: `W obecnym tempie zabraknie ok. ${aboutPln(
        (p.goal ?? 0) - p.forecast
      )} do celu - miesiąc skończy się ok. ${aboutPln(p.forecast)} (${pctOf(
        p.forecastPct
      )} celu).`,
      tone: "warn",
    };
  }
  if (p.lastYearMonthRevenue) {
    const vsLy = p.forecast / p.lastYearMonthRevenue - 1;
    const r = Math.round(Math.abs(vsLy) * 100);
    const cmp =
      r < 3
        ? "podobnie jak rok temu"
        : `o ${r}% ${vsLy > 0 ? "więcej" : "mniej"} niż w tym samym miesiącu rok temu`;
    return {
      text: `${landing.charAt(0).toUpperCase()}${landing.slice(1)} - ${cmp}.`,
      tone: r < 3 ? "neutral" : vsLy > 0 ? "good" : "warn",
    };
  }
  return {
    text: `${landing.charAt(0).toUpperCase()}${landing.slice(1)}.`,
    tone: "neutral",
  };
}

/**
 * "Where will this month land?" - revenue so far against the goal, with an
 * end-of-month forecast that borrows last year's shape of the month (so a
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
  const takeaway = pacingTakeaway(p);
  const scale = Math.max(p.goal ?? 0, p.forecastReliable ? p.forecast : 0, p.mtdRevenue, 1);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const vsLastYear =
    p.forecastReliable && p.lastYearMonthRevenue
      ? p.forecast / p.lastYearMonthRevenue - 1
      : null;
  // The forecast leans on last year's shape; say so in words when that shape
  // moves the number noticeably, so a jump in the forecast isn't a mystery.
  const seasonalNote =
    p.forecastReliable && p.seasonalFactor && Math.abs(p.seasonalFactor - 1) >= 0.15
      ? `Prognoza uwzględnia, że rok temu ta część miesiąca sprzedawała dziennie ok. ${pctOf(
          Math.abs(p.seasonalFactor - 1)
        )} ${p.seasonalFactor > 1 ? "więcej" : "mniej"} niż dwa tygodnie przed nią.`
      : null;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardEyebrow icon={<Target className="h-4 w-4 shrink-0 text-primary" />}>
          {p.goal ? "Cel sprzedaży" : "Prognoza sprzedaży"} · {p.monthLabel}
        </CardEyebrow>
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

      <Takeaway tone={takeaway.tone} className="mt-3">
        {takeaway.text}
      </Takeaway>

      <div className="mt-5 grid gap-x-8 gap-y-5 lg:grid-cols-2">
        <div className="min-w-0">
          <MetricLabel
            name={ECOM_TERMS.mtd.name}
            explain={ECOM_TERMS.mtd.explain}
          />
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">
            {formatPlnWhole(p.mtdRevenue)}
            {p.goal ? (
              <span className="ml-2 text-base font-medium text-muted-foreground">
                z {formatPlnWhole(p.goal)}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {p.completeDays} z {p.daysInMonth} dni za nami
            {p.todayRevenue > 0 ? ` · dziś do tej pory ${formatPlnWhole(p.todayRevenue)}` : ""}
          </p>

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
          <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11px] text-muted-foreground">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-primary" />
              sprzedane
              {p.forecastReliable ? (
                <>
                  <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-primary/25" />
                  prognoza
                </>
              ) : null}
            </span>
            {p.goal ? <span>| cel</span> : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Prognoza na koniec miesiąca</dt>
            <dd className="font-semibold tabular-nums">
              {p.forecastReliable ? (
                <>
                  {formatPlnWhole(p.forecast)}
                  {p.forecastPct !== null ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {pctOf(p.forecastPct)} celu
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="font-normal text-muted-foreground">
                  za mało danych z ostatnich dni
                </span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              {p.requiredDaily !== null
                ? "Potrzeba dziennie, żeby dowieźć cel"
                : "Sprzedaż dziennie (śr. z 2 tygodni)"}
            </dt>
            <dd className="font-semibold tabular-nums">
              {p.requiredDaily !== null
                ? formatPlnWhole(p.requiredDaily)
                : formatPlnWhole(p.recentDailyAvg)}
              {p.requiredDaily !== null ? (
                <span className="block text-xs font-normal text-muted-foreground">
                  ostatnio {formatPlnWhole(p.recentDailyAvg)} dziennie
                </span>
              ) : null}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Ten sam miesiąc rok temu</dt>
            <dd className="font-semibold tabular-nums">
              {p.lastYearMonthRevenue !== null ? (
                <>
                  {formatPlnWhole(p.lastYearMonthRevenue)}
                  {vsLastYear !== null ? (
                    <span
                      className={cn(
                        "flex items-center gap-0.5 text-xs font-medium",
                        vsLastYear >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {vsLastYear >= 0 ? (
                        <TrendingUp className="h-3 w-3" aria-hidden />
                      ) : (
                        <TrendingDown className="h-3 w-3" aria-hidden />
                      )}
                      prognoza {formatSignedPct(vsLastYear)} r/r
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="font-normal text-muted-foreground">brak danych</span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
              {ECOM_TERMS.roas.name}
              <InfoTip label={ECOM_TERMS.roas.tag} text={ECOM_TERMS.roas.explain} />
            </dt>
            <dd className="font-semibold tabular-nums">
              {p.mtdRoas !== null ? (
                <>
                  {zlPerZl(p.mtdRoas)}
                  <span className="block text-xs font-normal text-muted-foreground">
                    sprzedaży z każdej 1 zł · wydano {formatPlnWhole(p.mtdSpend)}
                  </span>
                </>
              ) : (
                <span className="font-normal text-muted-foreground">
                  brak wydatków na reklamy
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {seasonalNote ? (
        <p className="mt-4 text-xs text-muted-foreground">{seasonalNote}</p>
      ) : null}
      {p.missingDays > 0 ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Google Analytics nie przekazał danych z {p.missingDays}{" "}
          {p.missingDays === 1 ? "dnia" : "dni"} tego miesiąca - liczby są przez to
          zaniżone.
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
