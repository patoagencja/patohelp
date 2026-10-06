import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import {
  GOAL_METRICS,
  getGoalTargets,
  getMonthTotals,
  shiftMonth,
  type GoalMetric,
} from "@/lib/dashboard/goals";
import { monthLabelPl, todayWarsaw } from "@/lib/ecom/insights";
import { formatDateWarsaw, formatNumberPL } from "@/lib/utils";

import { saveEngagementGoals } from "./goals-actions";

const LABELS: Record<GoalMetric, { name: string; hint: string }> = {
  sessions: { name: "Wizyty na stronie", hint: "GA4, wszystkie źródła" },
  clicks: { name: "Kliknięcia w reklamy", hint: "Meta + Google Ads" },
  impressions: { name: "Wyświetlenia reklam", hint: "Meta + Google Ads" },
  conversions: { name: "Działania na stronie", hint: "konwersje z reklam" },
};

/**
 * Monthly goals for engagement clients (current month + next two). They drive
 * the "Cele na ..." card on the overview. Last month's actuals sit next to the
 * inputs so a target is set against reality, not a guess.
 */
export async function GoalsSettingsSection({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const current = `${todayWarsaw().slice(0, 7)}-01`;
  const months = [0, 1, 2].map((i) => shiftMonth(current, i));
  const lastMonth = shiftMonth(current, -1);
  const [targets, lastTotals] = await Promise.all([
    getGoalTargets(clientId, months),
    getMonthTotals(clientId, lastMonth),
  ]);
  const lastMonthName = monthLabelPl(lastMonth).split(" ")[0];

  return (
    <div id="cele" className="scroll-mt-32 space-y-4">
      <SectionHeader
        title="Cele miesięczne"
        description="Klient zobaczy na przeglądzie postęp każdego celu, prognozę na koniec miesiąca i ile trzeba dziennie, żeby go osiągnąć. Puste pole = brak celu."
      />

      {!targets.available ? (
        <Card className="max-w-3xl">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Uruchom w Supabase migrację{" "}
            <code className="rounded bg-muted px-1">0030_engagement_goals.sql</code>, żeby
            włączyć cele.
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-3xl">
          <CardContent className="pt-6">
            {/* Remount on save so inputs show what was actually stored (an
                unparseable entry is skipped, not saved). */}
            <form
              key={targets.updatedAt ?? "new"}
              action={saveEngagementGoals}
              className="flex flex-col gap-5"
            >
              <input type="hidden" name="client" value={clientSlug} />
              {months.map((m) => (
                <input key={m} type="hidden" name="goal_month" value={m} />
              ))}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Cel</th>
                      {months.map((m) => (
                        <th key={m} className="pb-2 pr-3 font-medium capitalize">
                          {monthLabelPl(m)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {GOAL_METRICS.map((metric) => {
                      const last = lastTotals[metric];
                      return (
                        <tr key={metric} className="align-top">
                          <td className="py-1.5 pr-3">
                            <span className="font-medium">{LABELS[metric].name}</span>
                            <span className="block text-xs tabular-nums text-muted-foreground">
                              {LABELS[metric].hint}
                              {last !== null
                                ? ` · ${lastMonthName}: ${formatNumberPL(last)}`
                                : ""}
                            </span>
                          </td>
                          {months.map((m) => {
                            const v = targets.byMonth.get(m)?.get(metric);
                            return (
                              <td key={m} className="py-1.5 pr-3">
                                <input
                                  name={`target_${m}_${metric}`}
                                  inputMode="numeric"
                                  aria-label={`${LABELS[metric].name} - ${monthLabelPl(m)}`}
                                  placeholder="brak celu"
                                  defaultValue={v !== undefined ? formatNumberPL(v) : ""}
                                  className="h-9 w-full rounded-xl border border-transparent bg-muted transition-shadow hover:bg-secondary focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-muted px-3 text-sm tabular-nums"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="sm" className="w-fit">
                  Zapisz cele
                </Button>
                {targets.updatedAt ? (
                  <span className="text-xs text-muted-foreground">
                    Ostatnio zapisano{" "}
                    {formatDateWarsaw(targets.updatedAt, "d MMMM, HH:mm")}
                  </span>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
