import Link from "next/link";
import type React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { InfoTip, MetricLabel } from "@/components/dashboard/info-tip";
import { Card } from "@/components/ui/card";
import { CountUp } from "@/components/ui/count-up";
import type { PillProps } from "@/components/ui/pill";
import { StatusChip } from "@/components/ui/primitives";
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

  const statTile = "min-w-0 rounded-[22px] bg-chip px-[18px] py-4";
  const statLabel = "text-[13px] leading-snug text-ink-3";
  const statValue = "mt-1.5 text-[22px] font-light leading-none tracking-[-0.03em] tabular-nums";
  const statNote = "mt-1.5 block text-[13px] leading-snug text-ink-3";

  return (
    <Card className="rounded-glass p-6 sm:p-[28px_30px]">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3">
        <div className="min-w-0">
          <p className="kick">Plan miesiąca · {p.monthLabel}</p>
          <h2 className="mt-2 text-[22px] font-medium tracking-[-0.03em]">
            {p.goal ? "Sprzedaż na tle celu" : "Prognoza sprzedaży"}
          </h2>
        </div>
        {status ? (
          <StatusChip tone={status.tone === "warning" ? "amber" : "lime"}>{status.label}</StatusChip>
        ) : null}
      </div>

      <p className="mt-4 max-w-3xl text-base leading-relaxed text-foreground">{takeaway.text}</p>

      <div className="mt-6 min-w-0">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <MetricLabel name={ECOM_TERMS.mtd.name} explain={ECOM_TERMS.mtd.explain} />
            <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="text-[2.25rem] font-light leading-none tracking-[-0.055em] tabular-nums sm:text-[2.875rem]">
                <CountUp text={formatPlnWhole(p.mtdRevenue).replace(/\s?zł$/, "")} />
                <small className="ml-[3px] text-[0.48em] tracking-[-0.02em]">zł</small>
              </span>
              {p.goal ? (
                <span className="text-[17px] tabular-nums text-ink-3">z {formatPlnWhole(p.goal)}</span>
              ) : null}
            </p>
          </div>
          {/* The share of the goal as the big percent; the chip and the
              sentence say it in words. */}
          {goalPct !== null ? (
            <p
              className={cn(
                "shrink-0 text-[2.25rem] font-light leading-none tracking-[-0.05em] tabular-nums sm:text-[2.875rem]",
                behind ? "text-warning" : "text-positive"
              )}
            >
              {Math.round(goalPct)}
              <span className="ml-0.5 text-[0.5em]">%</span>
            </p>
          ) : null}
        </div>
        {/* "Pełne" on purpose: the count is finished days only (the same
            days summed above), so day 6 of the month reads "5 pełnych dni",
            with today's running total shown separately. */}
        <p className="mt-2.5 text-[13px] tabular-nums text-ink-3">
          {p.completeDays}{" "}
          {plPlural(p.completeDays, "pełny dzień", "pełne dni", "pełnych dni")} z{" "}
          {p.daysInMonth} za nami
          {p.todayRevenue > 0
            ? ` · dziś do tej pory ${formatPlnWhole(p.todayRevenue)} (doliczymy jutro)`
            : ""}
        </p>

        {/* Sold (lime gradient, amber when behind) over the forecast (soft
            ghost), with the goal as an ink tick. */}
        <div className="relative mt-5">
          <div className="relative h-4 overflow-hidden rounded-full bg-chip" aria-hidden>
            {p.forecastReliable ? (
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  behind ? "bg-amber/20" : "bg-lime/25"
                )}
                style={{ width: pct(p.forecast) }}
              />
            ) : null}
            <div
              className={cn(
                "absolute inset-y-0 left-0 origin-left rounded-full animate-grow",
                behind ? "share-fill-warn" : "share-fill"
              )}
              style={{
                width: `max(${pct(p.mtdRevenue)}, ${p.mtdRevenue > 0 ? "1rem" : "0px"})`,
                "--d": ".3s",
              } as React.CSSProperties}
            />
          </div>
          {p.goal ? (
            <span
              aria-hidden
              className="absolute -top-1.5 h-7 w-[3px] -translate-x-1/2 rounded-full bg-foreground"
              style={{ left: `min(${pct(p.goal)}, calc(100% - 2px))` }}
            />
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className={cn("h-2.5 w-2.5 rounded-full", behind ? "bg-amber" : "bg-lime")}
            />
            sprzedane
          </span>
          {p.forecastReliable ? (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "h-2.5 w-2.5 rounded-full ring-1 ring-inset",
                  behind ? "bg-amber/25 ring-amber" : "bg-lime/30 ring-lime"
                )}
              />
              prognoza
            </span>
          ) : null}
          {p.goal ? (
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-foreground" />
              cel
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
          <div className={statTile}>
            <dt className={statLabel}>Prognoza na koniec miesiąca</dt>
            <dd>
              {p.forecastReliable ? (
                <>
                  <span className={cn(statValue, "block")}>{formatPlnWhole(p.forecast)}</span>
                  {p.forecastPct !== null ? (
                    <span className={statNote}>{pctOf(p.forecastPct)} celu</span>
                  ) : null}
                </>
              ) : (
                <span className={statNote}>za mało danych z ostatnich dni</span>
              )}
            </dd>
          </div>
          <div className={statTile}>
            <dt className={statLabel}>
              {p.requiredDaily !== null
                ? "Potrzeba dziennie, żeby osiągnąć cel"
                : "Sprzedaż dziennie (śr. z 2 tygodni)"}
            </dt>
            <dd>
              <span className={cn(statValue, "block")}>
                {p.requiredDaily !== null
                  ? formatPlnWhole(p.requiredDaily)
                  : formatPlnWhole(p.recentDailyAvg)}
              </span>
              {p.requiredDaily !== null ? (
                <span className={statNote}>ostatnio {formatPlnWhole(p.recentDailyAvg)} dziennie</span>
              ) : null}
            </dd>
          </div>
          <div className={statTile}>
            <dt className={statLabel}>Ten sam miesiąc rok temu</dt>
            <dd>
              {p.lastYearMonthRevenue !== null ? (
                <>
                  <span className={cn(statValue, "block")}>{formatPlnWhole(p.lastYearMonthRevenue)}</span>
                  {vsLastYear !== null ? (
                    <span
                      className={cn(
                        "mt-1.5 flex items-start gap-1 text-[13px] font-medium",
                        vsLastYear >= 0 ? "text-positive" : "text-negative"
                      )}
                    >
                      {vsLastYear >= 0 ? (
                        <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      ) : (
                        <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      )}
                      prognoza {formatSignedPct(vsLastYear)} r/r
                    </span>
                  ) : null}
                </>
              ) : (
                <span className={statNote}>brak danych</span>
              )}
            </dd>
          </div>
          <div className={statTile}>
            <dt className={cn(statLabel, "flex items-center gap-1")}>
              {ECOM_TERMS.roas.name}
              <InfoTip label={ECOM_TERMS.roas.tag} text={ECOM_TERMS.roas.explain} />
            </dt>
            <dd>
              {p.mtdRoas !== null ? (
                <>
                  <span className={cn(statValue, "block")}>{zlPerZl(p.mtdRoas)}</span>
                  <span className={statNote}>
                    sprzedaży z każdej 1 zł · wydano {formatPlnWhole(p.mtdSpend)}
                  </span>
                </>
              ) : (
                <span className={statNote}>brak wydatków na reklamy</span>
              )}
            </dd>
          </div>
      </dl>

      {seasonalNote ? (
        <p className="mt-4 text-[13px] text-ink-3">{seasonalNote}</p>
      ) : null}
      {p.missingDays > 0 ? (
        <p className="mt-2 text-[13px] text-warning">
          Google Analytics nie przekazał danych z {p.missingDays}{" "}
          {p.missingDays === 1 ? "dnia" : "dni"} tego miesiąca - liczby są przez to
          zaniżone.
        </p>
      ) : null}
      {!p.goal && isAgency ? (
        <p className="mt-3 text-[13px]">
          <Link
            href={`/${clientSlug}/settings#ecommerce`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Ustaw cel miesięczny
          </Link>{" "}
          <span className="text-ink-3">
            - pokażemy postęp i ile trzeba dziennie, żeby go osiągnąć.
          </span>
        </p>
      ) : null}
    </Card>
  );
}
