import { Card, Text, Title } from "@tremor/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BudgetStatus } from "@/lib/dashboard/overview";
import { cn, formatMoneyPLN } from "@/lib/utils";

const PACE_COLORS: Record<string, string> = {
  ok: "bg-emerald-500",
  slow: "bg-amber-500",
  fast: "bg-red-500",
};

export function BudgetProgress({
  budget,
  clientSlug,
  isAgency,
  setBudgetAction,
}: {
  budget: BudgetStatus;
  clientSlug: string;
  isAgency: boolean;
  setBudgetAction: (formData: FormData) => Promise<void>;
}) {
  if (!budget.hasBudget) {
    return (
      <Card>
        <Title>Budżet miesięczny</Title>
        <Text className="mt-2">
          Nie ustawiono budżetu na ten miesiąc.
        </Text>
        {isAgency ? (
          <form action={setBudgetAction} className="mt-4 flex max-w-sm gap-2">
            <input type="hidden" name="client" value={clientSlug} />
            <Input
              name="amount"
              type="number"
              min="1"
              step="0.01"
              placeholder="np. 15000"
              required
            />
            <Button type="submit" size="sm" className="shrink-0">
              Ustaw budżet
            </Button>
          </form>
        ) : null}
      </Card>
    );
  }

  const barPercent = Math.min(100, budget.spentPercent);
  const markerPercent = Math.min(100, budget.monthPercent);

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <Title>Budżet miesięczny</Title>
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
            />
            <Button type="submit" variant="outline" size="sm">
              Zmień
            </Button>
          </form>
        ) : null}
      </div>

      <div className="relative mt-4 h-3 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            PACE_COLORS[budget.pace] ?? "bg-emerald-500"
          )}
          style={{ width: `${barPercent}%` }}
        />
        {/* Where we *should* be by this day of the month */}
        <div
          className="absolute top-0 h-full w-0.5 bg-foreground/50"
          style={{ left: `${markerPercent}%` }}
          title="Proporcja miesiąca"
        />
      </div>

      <Text className="mt-3 text-sm">
        Wydane: {formatMoneyPLN(budget.spentMinorUnits)} z{" "}
        {formatMoneyPLN(budget.budgetMinorUnits)} (
        {Math.round(budget.spentPercent)}%). Dzień miesiąca:{" "}
        {budget.dayOfMonth}/{budget.daysInMonth} (
        {Math.round(budget.monthPercent)}%). Tempo: {budget.paceLabel}
      </Text>
    </Card>
  );
}
