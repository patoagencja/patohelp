import { Card, Title } from "@tremor/react";
import { format } from "date-fns";
import { enUS, pl } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BudgetStatus } from "@/lib/dashboard/overview";
import { cn } from "@/lib/utils";

type Lang = "pl" | "en";

const PACE_BAR: Record<BudgetStatus["pace"], string> = {
  ok: "bg-emerald-500",
  slow: "bg-amber-500",
  fast: "bg-red-500",
  none: "bg-emerald-500",
};

const PACE_DOT: Record<BudgetStatus["pace"], string> = {
  ok: "bg-emerald-500",
  slow: "bg-amber-500",
  fast: "bg-red-500",
  none: "bg-muted-foreground",
};

// Always group thousands ("7 581 zł"): pl-PL Intl skips grouping for 4-digit
// numbers, which looks inconsistent next to "50 000 zł" in the same headline.
function wholePln(minorUnits: number): string {
  const n = Math.round(minorUnits / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n} zł`;
}

/**
 * One plain sentence about pace. Projection is a straight line from the
 * average daily spend so far - simple enough to explain to anyone, and the
 * same assumption the "dzisiaj" marker on the bar makes.
 */
function paceSentence(budget: BudgetStatus, lang: Lang): string {
  const en = lang === "en";
  const { spentMinorUnits: spent, budgetMinorUnits: total, dayOfMonth, daysInMonth } =
    budget;

  if (spent >= total) {
    return en
      ? "This month's budget has already been fully used."
      : "Budżet na ten miesiąc został już w całości wykorzystany.";
  }

  // Nothing spent yet (new client, or the first sync of the month hasn't run):
  // "w tym tempie wykorzystamy ok. 0 zł" would read as an alarm.
  if (spent <= 0) {
    return en
      ? "No spend recorded this month yet - it appears after the next ad account sync."
      : "W tym miesiącu nie ma jeszcze wydatków - pojawią się po najbliższej synchronizacji kont reklamowych.";
  }

  const perDay = dayOfMonth > 0 ? spent / dayOfMonth : 0;

  if (budget.pace === "fast" && perDay > 0) {
    const runOutDay = Math.floor(dayOfMonth + (total - spent) / perDay);
    if (runOutDay < daysInMonth) {
      const [y, m] = budget.month.split("-").map(Number);
      const date = new Date(y, m - 1, Math.max(runOutDay, dayOfMonth));
      return en
        ? `We're spending faster than planned - at this pace the budget runs out around ${format(date, "MMMM d", { locale: enUS })}.`
        : `Wydajemy szybciej niż plan - w tym tempie budżet skończy się ok. ${format(date, "d MMMM", { locale: pl })}.`;
    }
    return en
      ? "We're spending a little faster than planned, but the budget should last the month."
      : "Wydajemy trochę szybciej niż plan, ale budżet powinien wystarczyć do końca miesiąca.";
  }

  if (budget.pace === "slow") {
    const projected = Math.min(total, perDay * daysInMonth);
    return en
      ? `We're spending slower than planned - at this pace we'll use about ${wholePln(projected)} by the end of the month.`
      : `Wydajemy wolniej niż plan - w tym tempie do końca miesiąca wykorzystamy ok. ${wholePln(projected)}.`;
  }

  return en ? "We're spending in line with the plan." : "Wydajemy zgodnie z planem.";
}

export function BudgetProgress({
  budget,
  clientSlug,
  isAgency,
  setBudgetAction,
  lang = "pl",
}: {
  budget: BudgetStatus;
  clientSlug: string;
  isAgency: boolean;
  setBudgetAction: (formData: FormData) => Promise<void>;
  lang?: Lang;
}) {
  const en = lang === "en";
  const title = en ? "Monthly budget" : "Budżet miesięczny";

  if (!budget.hasBudget) {
    return (
      <Card className="p-5 sm:p-6">
        <Title>{title}</Title>
        <p className="mt-2 text-sm text-muted-foreground">
          {en ? "No budget has been set for this month." : "Nie ustawiono budżetu na ten miesiąc."}
        </p>
        {isAgency ? (
          <form action={setBudgetAction} className="mt-4 flex max-w-sm gap-2">
            <input type="hidden" name="client" value={clientSlug} />
            <Input
              name="amount"
              type="number"
              min="1"
              step="0.01"
              placeholder={en ? "e.g. 15000" : "np. 15000"}
              required
            />
            <Button type="submit" size="sm" className="shrink-0">
              {en ? "Set budget" : "Ustaw budżet"}
            </Button>
          </form>
        ) : null}
      </Card>
    );
  }

  const barPercent = Math.min(100, budget.spentPercent);
  const markerPercent = Math.min(100, Math.max(0, budget.monthPercent));
  const remaining = Math.max(0, budget.budgetMinorUnits - budget.spentMinorUnits);
  const expectedByToday = (budget.budgetMinorUnits * budget.monthPercent) / 100;
  // Keep the "dzisiaj" label inside the card when the marker sits near an edge.
  const labelAlign =
    markerPercent < 10 ? "translate-x-0" : markerPercent > 90 ? "-translate-x-full" : "-translate-x-1/2";

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Title>{title}</Title>
        {isAgency ? (
          <form action={setBudgetAction} className="flex items-center gap-2">
            <input type="hidden" name="client" value={clientSlug} />
            <Input
              name="amount"
              type="number"
              min="1"
              step="0.01"
              defaultValue={(budget.budgetMinorUnits / 100).toString()}
              className="h-8 w-28 text-sm"
              aria-label={en ? "Monthly budget in PLN" : "Budżet miesięczny w zł"}
            />
            <Button type="submit" variant="outline" size="sm">
              {en ? "Change" : "Zmień"}
            </Button>
          </form>
        ) : null}
      </div>

      {/* Headline amount */}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
            {wholePln(budget.spentMinorUnits)}
          </span>
          <span className="text-lg text-muted-foreground tabular-nums">
            {en ? "of" : "z"} {wholePln(budget.budgetMinorUnits)}
          </span>
        </p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {en
            ? `${Math.round(budget.spentPercent)}% used · ${wholePln(remaining)} left`
            : `Wykorzystano ${Math.round(budget.spentPercent)}% · zostało ${wholePln(remaining)}`}
        </p>
      </div>

      {/* Progress bar + "today" marker for the planned pace */}
      <div className="relative mt-5 pb-6">
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", PACE_BAR[budget.pace])}
            style={{ width: `${barPercent}%` }}
          />
        </div>
        <div
          className="absolute -top-1 h-5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
          style={{ left: `${markerPercent}%` }}
          aria-hidden
        />
        <span
          className={cn(
            "absolute top-5 whitespace-nowrap text-xs font-medium text-muted-foreground",
            labelAlign
          )}
          style={{ left: `${markerPercent}%` }}
        >
          {en ? "today" : "dzisiaj"}
        </span>
      </div>

      {/* Status in one sentence */}
      <p className="mt-2 flex items-start gap-2 text-sm font-medium leading-snug">
        <span
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", PACE_DOT[budget.pace])}
          aria-hidden
        />
        {paceSentence(budget, lang)}
      </p>
      <p className="mt-1 pl-4 text-xs text-muted-foreground tabular-nums">
        {en
          ? `Day ${budget.dayOfMonth} of ${budget.daysInMonth} - by plan, about ${wholePln(expectedByToday)} would be spent by today.`
          : `Dzień ${budget.dayOfMonth} z ${budget.daysInMonth} - według planu do dziś wydalibyśmy ok. ${wholePln(expectedByToday)}.`}
      </p>
    </Card>
  );
}
