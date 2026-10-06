import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";

import { InfoTip, MetricLabel } from "@/components/dashboard/info-tip";
import { Card } from "@/components/ui/card";
import { Pill, type PillProps } from "@/components/ui/pill";
import { plPlural } from "@/lib/dashboard/story";
import type { MonthPacing } from "@/lib/ecom/insights";
import { cn, formatPlnWhole, formatSignedPct } from "@/lib/utils";

import { aboutPln, ECOM_TERMS, pctOf, zlPerZl, type TakeawayTone } from "./plain";

// Colour only says "fine / look at this"; the words say how fine.
const STATUS: Record<
  MonthPacing["status"],
  { label: string; tone: PillProps["tone"] } | null
> = {
  ahead: { label: "Przed planem", tone: "positive" },
  on_track: { label: "Zgodnie z planem", tone: "positive" },
  behind: { label: "Poniżej tempa", tone: "warning" },
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
  // Share of the goal sold so far (finished days), and whether the month is
  // behind its pace - only the colour of the bar and percent follows it.
  const goalPct = p.goal ? (p.mtdRevenue / p.goal) * 100 : null;
  const behind = p.status === "behind";
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
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-section-title text-foreground">Plan miesiąca</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {p.goal ? "Sprzedaż na tle celu" : "Prognoza sprzedaży"} · {p.monthLabel}
          </p>
        </div>
        {status ? <Pill tone={status.tone}>{status.label}</Pill> : null}
      </div>

      <p className="mt-4 text-[15px] leading-snug text-foreground">{takeaway.text}</p>

      <div className="mt-5 min-w-0">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <MetricLabel name={ECOM_TERMS.mtd.name} explain={ECOM_TERMS.mtd.explain} />
            <p className="mt-1.5 text-[1.75rem] font-medium leading-none tracking-[-0.03em] tabular-nums sm:text-metric">
              {formatPlnWhole(p.mtdRevenue)}
              {p.goal ? (
                <span className="ml-2 text-base font-medium tracking-normal text-muted-foreground">
                  z {formatPlnWhole(p.goal)}
                </span>
              ) : null}
            </p>
          </div>
          {/* Sales Goals (benchmark 4): the share of the goal as the big
              coloured percent; the pill and the sentence say it in words. */}
          {goalPct !== null ? (
            <p
              className={cn(
                "shrink-0 text-[1.75rem] font-medium leading-none tracking-[-0.03em] tabular-nums sm:text-metric",
                behind ? "text-warning" : "text-positive"
              )}
            >
              {Math.round(goalPct)}
              <span className="ml-0.5 text-lg sm:text-xl">%</span>
            </p>
          ) : null}
        </div>
        {/* "Pełne" on purpose: the count is finished days only (the same
            days summed above), so day 6 of the month reads "5 pełnych dni",
            with today's running total shown separately. */}
        <p className="mt-2 text-xs tabular-nums text-muted-foreground">
          {p.completeDays}{" "}
          {plPlural(p.completeDays, "pełny dzień", "pełne dni", "pełnych dni")} z{" "}
          {p.daysInMonth} za nami
          {p.todayRevenue > 0
            ? ` · dziś do tej pory ${formatPlnWhole(p.todayRevenue)} (doliczymy jutro)`
            : ""}
        </p>

        {/* Thick striped bar: sold (striped lime, amber when behind) over the
            forecast (soft ghost), with the goal as a dark tick. */}
        <div className="relative mt-4">
          <div className="relative h-3.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            {p.forecastReliable ? (
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  behind ? "bg-warning-fill/25" : "bg-lime/30"
                )}
                style={{ width: pct(p.forecast) }}
              />
            ) : null}
            <div
              // bg-stripes outside cn(): tailwind-merge would drop the colour.
              className={`${cn(
                "absolute inset-y-0 left-0 rounded-full transition-all duration-700 motion-reduce:transition-none",
                behind ? "bg-warning-fill" : "bg-lime"
              )} bg-stripes`}
              style={{ width: `max(${pct(p.mtdRevenue)}, ${p.mtdRevenue > 0 ? "0.875rem" : "0px"})` }}
            />
          </div>
          {p.goal ? (
            <span
              aria-hidden
              className="absolute -top-1 h-[1.375rem] w-[3px] -translate-x-1/2 rounded-full bg-foreground ring-2 ring-card"
              style={{ left: pct(p.goal) }}
            />
          ) : null}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={`${cn("h-2.5 w-2.5 rounded-full", behind ? "bg-warning-fill" : "bg-lime")} bg-stripes`}
            />
            sprzedane
          </span>
          {p.forecastReliable ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn("h-2.5 w-2.5 rounded-full", behind ? "bg-warning-fill/30" : "bg-lime/35")}
              />
              prognoza
            </span>
          ) : null}
          {p.goal ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-[3px] rounded-full bg-foreground" />
              cel
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <div className="min-w-0 rounded-2xl bg-muted/50 px-4 py-3">
            <dt className="text-xs text-muted-foreground">Prognoza na koniec miesiąca</dt>
            <dd className="mt-1 text-[15px] font-semibold tabular-nums tracking-[-0.01em]">
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
          <div className="min-w-0 rounded-2xl bg-muted/50 px-4 py-3">
            <dt className="text-xs text-muted-foreground">
              {p.requiredDaily !== null
                ? "Potrzeba dziennie, żeby osiągnąć cel"
                : "Sprzedaż dziennie (śr. z 2 tygodni)"}
            </dt>
            <dd className="mt-1 text-[15px] font-semibold tabular-nums tracking-[-0.01em]">
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
          <div className="min-w-0 rounded-2xl bg-muted/50 px-4 py-3">
            <dt className="text-xs text-muted-foreground">Ten sam miesiąc rok temu</dt>
            <dd className="mt-1 text-[15px] font-semibold tabular-nums tracking-[-0.01em]">
              {p.lastYearMonthRevenue !== null ? (
                <>
                  {formatPlnWhole(p.lastYearMonthRevenue)}
                  {vsLastYear !== null ? (
                    <span
                      className={cn(
                        "flex items-start gap-1 text-xs font-medium",
                        vsLastYear >= 0 ? "text-positive" : "text-negative"
                      )}
                    >
                      {vsLastYear >= 0 ? (
                        <TrendingUp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      ) : (
                        <TrendingDown className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
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
          <div className="min-w-0 rounded-2xl bg-muted/50 px-4 py-3">
            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
              {ECOM_TERMS.roas.name}
              <InfoTip label={ECOM_TERMS.roas.tag} text={ECOM_TERMS.roas.explain} />
            </dt>
            <dd className="mt-1 text-[15px] font-semibold tabular-nums tracking-[-0.01em]">
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

      {seasonalNote ? (
        <p className="mt-4 text-xs text-muted-foreground">{seasonalNote}</p>
      ) : null}
      {p.missingDays > 0 ? (
        <p className="mt-2 text-xs text-warning">
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
            - pokażemy postęp i ile trzeba dziennie, żeby go osiągnąć.
          </span>
        </p>
      ) : null}
    </Card>
  );
}
