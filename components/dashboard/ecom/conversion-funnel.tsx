import { Card } from "@tremor/react";

import { InfoTip, MetricLabel } from "@/components/dashboard/info-tip";
import { GLOSSARY } from "@/lib/dashboard/glossary";
import { cn, formatNumberPL } from "@/lib/utils";

import { ECOM_TERMS, perHundred, Takeaway, type TakeawayTone } from "./plain";

interface Step {
  label: string;
  explain?: string;
  value: number;
}

const pctText = (ratio: number) =>
  `${(ratio * 100).toLocaleString("pl-PL", {
    maximumFractionDigits: ratio < 0.01 ? 2 : 1,
  })}%`;

// From visit to purchase, with the data we track daily: visits -> engaged
// visits (engagement rate applied) -> orders. Widths are on a log scale so the
// orders bar stays visible next to thousands of visits.
export function ConversionFunnel({
  sessions,
  engagementRate, // percent 0-100
  transactions,
}: {
  sessions: number;
  engagementRate: number;
  transactions: number;
}) {
  const engaged = Math.round((sessions * engagementRate) / 100);
  const steps: Step[] = [
    { label: "Wizyty w sklepie", value: sessions },
    {
      label: "Wizyty z prawdziwym zainteresowaniem",
      explain: GLOSSARY.engagementRate.explain,
      value: engaged,
    },
    { label: "Zamówienia", value: transactions },
  ];
  const max = Math.max(...steps.map((s) => s.value), 1);
  const width = (v: number) =>
    v <= 0 ? 4 : Math.max(8, Math.round((Math.log10(v + 1) / Math.log10(max + 1)) * 100));

  const rate = sessions > 0 ? transactions / sessions : null;
  let takeaway: { text: string; tone: TakeawayTone };
  if (sessions <= 0) {
    takeaway = { text: "Brak danych o wizytach w tym okresie.", tone: "neutral" };
  } else if (transactions <= 0) {
    takeaway = {
      text: "W tym okresie żadna wizyta nie zakończyła się zamówieniem zarejestrowanym przez Google Analytics.",
      tone: "warn",
    };
  } else {
    // "co 55. wizyta" is easier to picture than "1,82%".
    const every = Math.max(1, Math.round(sessions / transactions));
    takeaway = {
      text:
        every <= 1
          ? "Praktycznie każda wizyta kończy się zakupem."
          : `Zakupem kończy się mniej więcej co ${formatNumberPL(every)}. wizyta w sklepie.`,
      tone: "neutral",
    };
  }

  const colors = ["bg-indigo-300/70", "bg-indigo-500/80", "bg-emerald-500"];

  return (
    <Card className="flex flex-col">
      <h3 className="text-base font-semibold">Od wizyty do zakupu</h3>
      <Takeaway tone={takeaway.tone} className="mt-3">
        {takeaway.text}
      </Takeaway>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <MetricLabel
          name={ECOM_TERMS.cr.name}
          tag={ECOM_TERMS.cr.tag}
          explain={ECOM_TERMS.cr.explain}
        />
        <span className="text-sm font-semibold tabular-nums">
          {rate !== null ? `${perHundred(rate)} (${pctText(rate)})` : "—"}
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].value : 0;
          return (
            <div key={s.label}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                  {s.label}
                  {s.explain ? <InfoTip label={s.label} text={s.explain} /> : null}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                  {formatNumberPL(s.value)}
                </span>
              </div>
              <div className="h-7 w-full overflow-hidden rounded-lg bg-muted">
                <div
                  className={cn("h-full rounded-lg transition-all duration-700", colors[i])}
                  style={{ width: `${width(s.value)}%` }}
                />
              </div>
              {i > 0 && prev > 0 ? (
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {pctText(s.value / prev)} z poprzedniego kroku
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
