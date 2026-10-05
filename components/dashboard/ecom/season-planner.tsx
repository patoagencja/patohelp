import Link from "next/link";
import { CalendarClock, Flame, Lightbulb } from "lucide-react";

import { dayLabelPl, type SeasonPlan } from "@/lib/ecom/insights";
import { formatMultiple, formatPlnWhole } from "@/lib/utils";

/**
 * Peak-season planner from the client's OWN last year: countdown to Black
 * Friday & co., what last November / BF week / December delivered and at what
 * ROAS, and the budget that implies for this year. Gives the agency a
 * data-backed reason to plan (and fund) Q4 early - with the client's numbers,
 * not industry averages.
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

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-amber-500/10 via-rose-500/5 to-transparent px-5 py-4">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-rose-500" />
          <div>
            <h2 className="text-base font-semibold">Sezon Q4 - plan na szczyt sprzedaży</h2>
            <p className="text-xs text-muted-foreground">
              Na podstawie Waszych własnych danych z {ly?.year ?? "zeszłego roku"}
            </p>
          </div>
        </div>
        {next ? (
          <div className="text-right">
            <p className="text-3xl font-bold leading-none tracking-tight">{next.daysTo}</p>
            <p className="text-xs text-muted-foreground">
              dni do: {next.label} ({dayLabelPl(next.date)})
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_1fr]">
        {/* Last year's season, in numbers. */}
        <div>
          {ly ? (
            <dl className="grid grid-cols-2 gap-3">
              <Stat
                label={`Listopad ${ly.year}`}
                value={ly.novRevenue !== null ? formatPlnWhole(ly.novRevenue) : "brak danych"}
                note={ly.novVsOct ? `${formatMultiple(ly.novVsOct, 1)} październik` : undefined}
              />
              <Stat
                label={`Tydzień Black Friday ${ly.year}`}
                value={ly.bfWeekRevenue !== null ? formatPlnWhole(ly.bfWeekRevenue) : "brak danych"}
                note={
                  ly.bfWeekShareOfNov !== null
                    ? `= ${Math.round(ly.bfWeekShareOfNov * 100)}% całego listopada w 5 dni`
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
              <Stat
                label={`Reklamy w listopadzie ${ly.year}`}
                value={formatPlnWhole(ly.novSpend)}
                note={ly.novRoas !== null ? `ROAS ${formatMultiple(ly.novRoas)}` : undefined}
              />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nie mamy jeszcze Waszych danych z zeszłorocznego sezonu - po roku
              synchronizacji pokażemy tu Waszą historię Black Friday i Świąt.
            </p>
          )}
        </div>

        {/* What it means for this year. */}
        <div className="space-y-4">
          {plan.events.length ? (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" /> Nadchodzące szczyty
              </p>
              <ul className="space-y-1.5">
                {plan.events.map((e) => (
                  <li key={e.key} className="flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">{e.label}</span>{" "}
                      <span className="text-muted-foreground">· {dayLabelPl(e.date)}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {e.lastYearRevenue !== null
                        ? `rok temu ${formatPlnWhole(e.lastYearRevenue)}`
                        : `za ${e.daysTo} dni`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-lg bg-primary/5 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <Lightbulb className="h-3.5 w-3.5" /> Co z tego wynika
            </p>
            <ul className="space-y-2 text-sm leading-relaxed">
              {plan.suggestedNovBudget !== null && ly?.novRoas ? (
                <li>
                  {plan.suggestedBudgetBasis === "goal" && plan.novemberGoal ? (
                    <>
                      Cel na listopad to <b>{formatPlnWhole(plan.novemberGoal)}</b>. Przy
                      zeszłorocznym ROAS {formatMultiple(ly.novRoas)} potrzeba ok.{" "}
                      <b>{formatPlnWhole(plan.suggestedNovBudget)}</b> budżetu reklamowego.
                    </>
                  ) : (
                    <>
                      Żeby powtórzyć zeszłoroczny listopad przy tym samym ROAS (
                      {formatMultiple(ly.novRoas)}), potrzeba ok.{" "}
                      <b>{formatPlnWhole(plan.suggestedNovBudget)}</b> budżetu reklamowego.
                    </>
                  )}
                </li>
              ) : null}
              {warmupDays > 0 ? (
                <li>
                  Kampanie rozgrzewające (budowa list remarketingowych) warto
                  wystartować do <b>{dayLabelPl(plan.warmupStart)}</b> - 3 tygodnie przed
                  Black Friday, czyli za {warmupDays} dni.
                </li>
              ) : null}
              {ly?.bfWeekShareOfNov && ly.bfWeekShareOfNov >= 0.25 ? (
                <li>
                  Rok temu tydzień Black Friday dał {Math.round(ly.bfWeekShareOfNov * 100)}%
                  listopada - budżet trzeba mocno dociążyć na te 5 dni, a nie rozkładać
                  równo na cały miesiąc.
                </li>
              ) : null}
              <li>
                Kreacje, rabaty i stany magazynowe pod BF ustalcie najpóźniej 2 tygodnie
                wcześniej - kampanie potrzebują kilku dni na przejście moderacji i naukę.
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
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tracking-tight">{value}</dd>
      {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}
