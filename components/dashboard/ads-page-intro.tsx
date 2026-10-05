import { describeChange } from "@/lib/dashboard/glossary";
import type { DashboardKpis } from "@/lib/dashboard/metrics";
import { plPlural } from "@/lib/dashboard/story";
import { formatMoneyPLN, formatNumberPL } from "@/lib/utils";

type Lang = "pl" | "en";

// Below this many clicks last period a "% cheaper" claim is noise (same
// threshold the overview story uses).
const MIN_CLICKS_BASE = 50;

// Always group thousands ("7 581 zł"): pl-PL Intl skips grouping for 4-digit
// numbers, which looks inconsistent next to 5-digit figures.
function wholePln(minorUnits: number): string {
  const n = Math.round(minorUnits / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n} zł`;
}

/**
 * Header of the Reklamy tab. States the question the page answers and gives
 * the answer in one sentence before any chart, so a manager can stop reading
 * here if that's all the board asked.
 */
export function AdsPageIntro({
  kpis,
  rangeLabel,
  lang = "pl",
  children,
}: {
  kpis: DashboardKpis;
  rangeLabel: string;
  lang?: Lang;
  /** Right-hand slot, e.g. the date range picker. */
  children?: React.ReactNode;
}) {
  const en = lang === "en";
  const spend = kpis.spendMinorUnits.value;
  const clicks = kpis.clicks.value;
  const cpc = kpis.cpcMinorUnits.value;
  const cpcChange = describeChange(kpis.cpcMinorUnits.deltaPercent, "cost", {
    lang,
    thinBase: kpis.clicks.previous < MIN_CLICKS_BASE,
  });

  let answer: string;
  if (spend <= 0) {
    answer = en
      ? "No ad spend in this period."
      : "W tym okresie nie było wydatków na reklamy.";
  } else if (clicks <= 0) {
    answer = en
      ? `We spent ${wholePln(spend)} on ads; no clicks were recorded yet.`
      : `Wydaliśmy ${wholePln(spend)} na reklamy; nie odnotowano jeszcze kliknięć.`;
  } else {
    answer = en
      ? `We spent ${wholePln(spend)} on ads and got ${formatNumberPL(clicks)} clicks - ${formatMoneyPLN(Math.round(cpc))} per click on average (${cpcChange}).`
      : `Wydaliśmy ${wholePln(spend)} na reklamy i dostaliśmy ${formatNumberPL(clicks)} ${plPlural(clicks, "kliknięcie", "kliknięcia", "kliknięć")} - średnio ${formatMoneyPLN(Math.round(cpc))} za jedno (${cpcChange}).`;
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{en ? "Ads" : "Reklamy"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {en
            ? `Where the money goes and what we get for it · ${rangeLabel}`
            : `Na co idą pieniądze i co z tego mamy · ${rangeLabel}`}
        </p>
        <p className="mt-3 max-w-2xl text-base font-medium leading-snug tabular-nums">
          {answer}
        </p>
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}
