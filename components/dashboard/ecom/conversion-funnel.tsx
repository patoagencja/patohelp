import { InfoTip, MetricLabel } from "@/components/dashboard/info-tip";
import { Card } from "@/components/ui/card";
import { GLOSSARY } from "@/lib/dashboard/glossary";
import { cn, formatNumberPL } from "@/lib/utils";

import { ECOM_TERMS, perHundred, SECTION_PAD, SECTION_TITLE, Takeaway, type TakeawayTone } from "./plain";

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

// Fill opacity per step: one chart-1 green, lighter as the funnel narrows
// (benchmark 2's stepped area).
const STEP_OPACITY = [0.82, 0.48, 0.22];

// From visit to purchase, with the data we track daily: visits -> engaged
// visits (engagement rate applied) -> orders. Drawn as a stepped area
// (benchmark 2): each column's top edge runs from its own step to the next.
// Heights are linear shares of all visits - a log scale made 1,6% of visits
// look like two thirds of the bar. Tiny steps get a minimum sliver plus the
// printed % so they stay readable.
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

  // Geometry in a 0..300 x 0..100 box, stretched to the card width. The
  // last column tapers a little so the shape reads as "flowing on".
  const MIN_H = 0.05;
  const hOf = (v: number) => (v > 0 ? Math.max(MIN_H, share(v)) : 0);
  const tops = steps.map((st) => 100 - hOf(st.value) * 92);
  const ends = [tops[1], tops[2], 100 - hOf(steps[2].value) * 92 * 0.7];
  const colW = 300 / steps.length;

  return (
    <Card className={cn("flex flex-col", SECTION_PAD)}>
      <p className="kick">Droga do zakupu</p>
      <h2 className={cn(SECTION_TITLE, "mt-2")}>Od wizyty do zakupu</h2>
      <Takeaway tone={takeaway.tone} className="mt-3">
        {takeaway.text}
      </Takeaway>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <MetricLabel
          name={ECOM_TERMS.cr.name}
          tag={ECOM_TERMS.cr.tag}
          explain={ECOM_TERMS.cr.explain}
        />
        <span className="text-[22px] font-light tracking-[-0.03em] tabular-nums">
          {rate !== null ? perHundred(rate) : "—"}
        </span>
      </div>

      <div className="mt-6">
        <div className="grid grid-cols-3">
          {steps.map((s, i) => {
            const prev = i > 0 ? steps[i - 1].value : 0;
            return (
              <div
                key={s.label}
                className={cn(
                  "flex min-w-0 flex-col pb-3",
                  i > 0 && "border-l border-line pl-2.5 sm:pl-3.5",
                  i < steps.length - 1 && "pr-2"
                )}
              >
                {/* Fixed label height so the three numbers share one baseline
                    even when a label wraps. */}
                <span className="min-h-[3.5rem] text-[13px] leading-snug text-muted-foreground sm:min-h-[2.5rem]">
                  <LabelWithTip label={s.label} explain={s.explain} />
                </span>
                <div className="pt-2">
                  <p className="text-2xl font-light leading-none tracking-[-0.045em] tabular-nums text-foreground sm:text-[30px]">
                    {formatNumberPL(s.value)}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px font-semibold",
                        i === steps.length - 1 ? "bg-lime text-lime-foreground" : "bg-chip text-foreground"
                      )}
                    >
                      {pctText(share(s.value))}
                    </span>
                    {/* Step 2's "of previous" equals its share of visits,
                        already in the chip - only later steps need it. */}
                    {i > 1 && prev > 0 ? (
                      <span>{pctText(s.value / prev)} z poprzedniego kroku</span>
                    ) : null}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        {/* The numbers above carry the meaning; the shape repeats them. */}
        <svg
          viewBox="0 0 300 100"
          preserveAspectRatio="none"
          aria-hidden
          className="block h-28 w-full text-[hsl(var(--lime-line))] sm:h-36"
        >
          {steps.map((s, i) => {
            const x0 = i * colW;
            const x1 = (i + 1) * colW;
            return s.value > 0 ? (
              <path
                key={s.label}
                d={`M${x0},100 L${x0},${tops[i]} L${x1},${ends[i]} L${x1},100 Z`}
                fill="currentColor"
                fillOpacity={STEP_OPACITY[i]}
              />
            ) : null;
          })}
          <path
            d={steps
              .map((_, i) => `${i ? "L" : "M"}${i * colW},${tops[i]}`)
              .concat(`L300,${ends[steps.length - 1]}`)
              .join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {steps.slice(1).map((_, i) => (
            <line
              key={i}
              x1={(i + 1) * colW}
              x2={(i + 1) * colW}
              y1={0}
              y2={100}
              className="stroke-card"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <p className="mt-4 text-xs text-ink-3">
        Procent pod liczbą to część wszystkich wizyt w sklepie.
      </p>
    </Card>
  );
}
