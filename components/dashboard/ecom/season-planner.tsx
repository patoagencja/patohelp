import Link from "next/link";
import { CalendarClock, Lightbulb } from "lucide-react";

import { InfoTip } from "@/components/dashboard/info-tip";
import { Card } from "@/components/ui/card";
import { Ping } from "@/components/ui/primitives";
import { plPlural } from "@/lib/dashboard/story";
import { dayLabelPl, type SeasonPlan } from "@/lib/ecom/insights";
import { cn, formatMultiple, formatPlnWhole } from "@/lib/utils";

import { aboutPln, ECOM_TERMS, pctOf, SECTION_TITLE, Takeaway, zlPerZl } from "./plain";

/** "zostało 52 dni" / "został 1 dzień" / "zostały 3 dni". */
function daysLeft(n: number): string {
  return `${plPlural(n, "został", "zostały", "zostało")} ${n} ${plPlural(n, "dzień", "dni", "dni")}`;
}

// "Do ..." needs the genitive; the event labels are nominative.
const EVENT_GEN: Record<string, string> = {
  bf: "Black Friday",
  cm: "Cyber Monday",
  mikolajki: "Mikołajek",
  xmas: "ostatnich zamówień przed Świętami",
};

function seasonTakeaway(plan: SeasonPlan): string | null {
  const ly = plan.lastYear;
  const next = plan.events[0];
  const countdown = next
    ? next.daysTo === 0
      ? `Dziś ${next.label}`
      : `Do ${EVENT_GEN[next.key] ?? next.label} ${daysLeft(next.daysTo)}`
    : null;

  // Pick the single most decision-relevant fact from last year.
  let fact: string | null = null;
  if (ly?.bfWeekShareOfNov && ly.bfWeekShareOfNov >= 0.2) {
    fact = `rok temu same 5 dni wokół Black Friday dało ${pctOf(
      ly.bfWeekShareOfNov
    )} sprzedaży całego listopada`;
  } else if (ly?.novVsOct && Math.abs(ly.novVsOct - 1) >= 0.15) {
    fact =
      ly.novVsOct > 1
        ? `rok temu w listopadzie sklep sprzedał ${formatMultiple(ly.novVsOct, 1)} tyle co w październiku`
        : `rok temu w listopadzie sklep sprzedał mniej niż w październiku (${pctOf(ly.novVsOct)})`;
  } else if (ly?.novRevenue) {
    fact = `rok temu listopad przyniósł ok. ${aboutPln(ly.novRevenue)} sprzedaży`;
  } else if (!ly) {
    fact = "po roku zbierania danych pokażemy tu Twoją historię sezonu";
  }

  if (countdown && fact) return `${countdown} - ${fact}.`;
  if (countdown) return `${countdown}.`;
  if (fact) return `${fact.charAt(0).toUpperCase()}${fact.slice(1)}.`;
  return null;
}

/**
 * Peak-season planner from the client's OWN last year: countdown to Black
 * Friday & co., what last November / BF week / December delivered and at what
 * return on ads, and the budget that implies for this year. Gives the agency
 * a data-backed reason to plan (and fund) Q4 early - with the client's
 * numbers, not industry averages.
 */
export function SeasonPlanner({
  plan,
  clientSlug,
  isAgency,
}: {
  plan: SeasonPlan;
  clientSlug: string;
  isAgency: boolean;
}) {
  const ly = plan.lastYear;
  const next = plan.events[0];
  if (!next && !ly) return null;

  const warmupDays = Math.round(
    (Date.parse(`${plan.warmupStart}T00:00:00Z`) - Date.parse(`${plan.today}T00:00:00Z`)) /
      86_400_000
  );
  const takeaway = seasonTakeaway(plan);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-6 sm:px-[30px] sm:pt-7">
        <div className="min-w-0">
          <p className="kick">Sezon · wyniki z {ly?.year ?? "zeszłego roku"}</p>
          <h2 className={cn(SECTION_TITLE, "mt-2")}>Plan na Black Friday i Święta</h2>
        </div>
        {/* Phones: the countdown wraps under the title, so it reads as one
            left-aligned line ("52 dni do Black Friday") instead of a lone
            right-aligned number. */}
        {/* The countdown as a small anchor tile (dark in light mode, light
            in dark mode); .surface-anchor re-points the tokens and prints
            as a plain white card. */}
        {next ? (
          <div className="surface-anchor flex items-baseline gap-2 rounded-[22px] bg-card px-[18px] py-3.5 text-foreground sm:block sm:text-right">
            <p className="text-[34px] font-light leading-none tabular-nums tracking-[-0.05em]">
              {next.daysTo}
            </p>
            <p className="text-xs text-muted-foreground sm:mt-1.5">
              {next.daysTo === 0
                ? `dni - dziś ${next.label}`
                : `${plPlural(next.daysTo, "dzień", "dni", "dni")} do ${
                    EVENT_GEN[next.key] ?? next.label
                  }`}
            </p>
          </div>
        ) : null}
      </div>

      {takeaway ? (
        <div className="px-6 pt-6 sm:px-[30px]">
          <Takeaway>{takeaway}</Takeaway>
        </div>
      ) : null}

      <div className="grid gap-5 p-6 sm:p-[24px_30px_30px] lg:grid-cols-[1.1fr_1fr]">
        {/* Last year's season, in numbers. */}
        <div className="min-w-0">
          {ly ? (
            <dl className="grid grid-cols-2 gap-3">
              <Stat
                label={`Listopad ${ly.year}`}
                value={ly.novRevenue !== null ? formatPlnWhole(ly.novRevenue) : "brak danych"}
                note={
                  ly.novVsOct
                    ? `${formatMultiple(ly.novVsOct, 1)} tyle co w październiku`
                    : undefined
                }
              />
              <Stat
                label={`Black Friday ${ly.year} (5 dni)`}
                value={ly.bfWeekRevenue !== null ? formatPlnWhole(ly.bfWeekRevenue) : "brak danych"}
                note={
                  ly.bfWeekShareOfNov !== null
                    ? `${pctOf(ly.bfWeekShareOfNov)} całego listopada`
                    : `${dayLabelPl(ly.bfWeekStart)} - ${dayLabelPl(ly.bfWeekEnd)}`
                }
              />
              <Stat
                label={`Grudzień ${ly.year}`}
                value={ly.decRevenue !== null ? formatPlnWhole(ly.decRevenue) : "brak danych"}
              />
              <Stat
                label="Najlepszy dzień sezonu"
                value={ly.bestDay ? formatPlnWhole(ly.bestDay.revenue) : "—"}
                note={ly.bestDay ? dayLabelPl(ly.bestDay.date) : undefined}
              />
              {/* Five tiles in a 2-column grid: the last spans both columns
                  instead of leaving a hole next to it. */}
              <Stat
                className="col-span-2"
                label={`Reklamy w listopadzie ${ly.year}`}
                value={formatPlnWhole(ly.novSpend)}
                note={
                  ly.novRoas !== null
                    ? `${zlPerZl(ly.novRoas)} sprzedaży z każdej 1 zł`
                    : undefined
                }
                explain={ly.novRoas !== null ? ECOM_TERMS.roas.explain : undefined}
              />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nie mamy jeszcze Twoich danych z zeszłorocznego sezonu - po roku
              zbierania danych pokażemy tu Twoją historię Black Friday i Świąt.
            </p>
          )}
        </div>

        {/* What it means for this year. */}
        <div className="min-w-0 space-y-4">
          {plan.events.length ? (
            <div>
              <p className="kick mb-3 flex items-center gap-1.5 text-[11px]">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Nadchodzące szczyty
              </p>
              <ul className="space-y-2">
                {plan.events.map((e) => (
                  // Always two lines on phones, always one row from sm up -
                  // flex-wrap broke only the longest names, so rows differed.
                  <li
                    key={e.key}
                    className="flex flex-col gap-0.5 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                  >
                    <span className="min-w-0">
                      <Ping
                        tone={e.key === next?.key ? "lime" : "muted"}
                        still={e.key !== next?.key}
                        className="mr-2 align-middle"
                      />
                      <span className="font-medium">{e.label}</span>{" "}
                      <span className="whitespace-nowrap text-muted-foreground">
                        · {dayLabelPl(e.date)}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {e.lastYearRevenue !== null
                        ? `rok temu tego dnia ${formatPlnWhole(e.lastYearRevenue)}`
                        : `za ${e.daysTo} ${plPlural(e.daysTo, "dzień", "dni", "dni")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-[22px] bg-lime-soft/70 p-5">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Lightbulb className="h-4 w-4 text-positive" aria-hidden /> Co z tego wynika
            </p>
            <ul className="space-y-2 text-sm leading-relaxed">
              {plan.suggestedNovBudget !== null && ly?.novRoas ? (
                <li>
                  {plan.suggestedBudgetBasis === "goal" && plan.novemberGoal ? (
                    <>
                      Cel na listopad to <b>{formatPlnWhole(plan.novemberGoal)}</b>. Jeśli
                      reklamy zwrócą tyle co rok temu ({zlPerZl(ly.novRoas)} z każdej 1
                      zł), potrzeba ok. <b>{aboutPln(plan.suggestedNovBudget)}</b> budżetu
                      na reklamy.
                    </>
                  ) : (
                    <>
                      Żeby powtórzyć zeszłoroczny listopad przy podobnym zwrocie z reklam (
                      {zlPerZl(ly.novRoas)} z każdej 1 zł), potrzeba ok.{" "}
                      <b>{aboutPln(plan.suggestedNovBudget)}</b> budżetu na reklamy.
                    </>
                  )}
                </li>
              ) : null}
              {warmupDays > 0 ? (
                <li>
                  Kampanie „rozgrzewające” warto uruchomić do{" "}
                  <b>{dayLabelPl(plan.warmupStart)}</b> (za {warmupDays}{" "}
                  {plPlural(warmupDays, "dzień", "dni", "dni")}) - zbierają osoby
                  zainteresowane ofertą, którym w Black Friday przypomnimy o promocji.
                </li>
              ) : null}
              {ly?.bfWeekShareOfNov && ly.bfWeekShareOfNov >= 0.25 ? (
                <li>
                  Rok temu 5 dni Black Friday dało {pctOf(ly.bfWeekShareOfNov)} sprzedaży
                  listopada - budżet warto mocno skupić na tych dniach, zamiast
                  rozkładać go równo na cały miesiąc.
                </li>
              ) : null}
              <li>
                Grafiki, rabaty i stany magazynowe na Black Friday najlepiej ustalić
                najpóźniej 2 tygodnie wcześniej - reklamy potrzebują kilku dni na
                zatwierdzenie i rozkręcenie się.
              </li>
            </ul>
            {isAgency && !plan.novemberGoal ? (
              <Link
                href={`/${clientSlug}/settings#ecommerce`}
                className="mt-3 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                Ustaw cel na listopad, żeby policzyć budżet pod cel
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  note,
  explain,
  className,
}: {
  label: string;
  value: string;
  note?: string;
  explain?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-[22px] bg-chip px-[18px] py-4", className)}>
      <dt className="flex items-center gap-1 text-[13px] text-ink-3">
        {label}
        {explain ? <InfoTip label={label} text={explain} /> : null}
      </dt>
      <dd className="mt-1.5 text-[22px] font-light leading-tight tabular-nums tracking-[-0.03em]">{value}</dd>
      {note ? <p className="mt-1 text-xs text-ink-3">{note}</p> : null}
    </div>
  );
}
