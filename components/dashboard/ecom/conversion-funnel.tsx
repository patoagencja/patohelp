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

/**
 * Keeps the ⓘ glued to the label's last word: as a separate flex item it was
 * left floating beside a two-line label on phones.
 */
function LabelWithTip({ label, explain }: { label: string; explain?: string }) {
  if (!explain) return <>{label}</>;
  const cut = label.lastIndexOf(" ");
  const head = cut > 0 ? label.slice(0, cut + 1) : "";
  const last = cut > 0 ? label.slice(cut + 1) : label;
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {last}
        <InfoTip label={label} text={explain} className="ml-1 align-middle" />
      </span>
    </>
  );
}

// From visit to purchase, with the data we track daily: visits -> engaged
// visits (engagement rate applied) -> orders. Widths are linear shares of all
// visits - a log scale made 1,6% of visits look like two thirds of the bar.
// Tiny steps get a minimum sliver plus the printed % so they stay readable.
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
  const first = Math.max(steps[0].value, 1);
  const share = (v: number) => Math.min(1, Math.max(0, v / first));

  const rate = sessions > 0 ? transactions / sessions : null;
  let takeaway: { text: string; tone: TakeawayTone };
  if (sessions <= 0) {
    takeaway = {
      text: "Dane o wizytach z Google Analytics pojawią się po pierwszej synchronizacji.",
      tone: "neutral",
    };
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
          {rate !== null ? perHundred(rate) : "—"}
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].value : 0;
          return (
            <div key={s.label}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm text-muted-foreground">
                  <LabelWithTip label={s.label} explain={s.explain} />
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                  {formatNumberPL(s.value)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-lg bg-muted">
                  <div
                    className={cn("h-full rounded-lg transition-all duration-700", colors[i])}
                    style={{
                      width: s.value > 0 ? `max(${share(s.value) * 100}%, 0.375rem)` : 0,
                    }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                  {pctText(share(s.value))}
                </span>
              </div>
              {/* Step 2's "of previous" equals its share of visits, already
                  printed beside the bar - only later steps need it. */}
              {i > 1 && prev > 0 ? (
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {pctText(s.value / prev)} z poprzedniego kroku
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">
        Procent przy pasku to część wszystkich wizyt w sklepie.
      </p>
    </Card>
  );
}
