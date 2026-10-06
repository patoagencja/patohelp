import {
  roughCount,
  toOutOf100,
  type ImpressionShareCampaign,
  type ImpressionShareSummary,
} from "@/lib/dashboard/impression-share";
import { cn, formatNumberPL, formatPlnWhole } from "@/lib/utils";

type Lang = "pl" | "en";

const TOP_CAMPAIGNS = 5;
// Below this many "out of 100" a cause isn't worth a sentence of its own.
const MENTION_FROM = 5;
// An estimate under ~10 clicks a month is noise, not a budget argument.
const MIN_CLICKS_TO_MENTION = 10;

// Shared by the big bar, the legend and the per-campaign bars so one colour
// always means one thing: lime = where you showed (the good part, striped
// like the benchmarks' highlighted bar), amber = lost to budget (the
// actionable warning), olive = lost to ad rank (quiet).
const SEGMENTS = {
  shown: "bg-lime",
  budget: "bg-warning-fill",
  rank: "bg-olive",
} as const;
const LEGEND_CHIP = "inline-flex items-center gap-1.5 rounded-full bg-chip px-2.5 py-1";

function labels(en: boolean) {
  return {
    shown: en ? "Your ads" : "Twoje reklamy",
    budget: en ? "Lost to budget" : "Przepadło przez budżet",
    rank: en ? "Lost to ad rank (bids and quality)" : "Przepadło przez pozycję (stawki i jakość)",
  };
}

function headline(s: ImpressionShareSummary, parts: number[], en: boolean): string[] {
  const [shown, budget, rank] = parts;
  const out: string[] = [];

  const anyBelow10 = s.campaigns.some((c) => c.shownBelow10);
  if (shown <= 10 && anyBelow10) {
    out.push(
      en
        ? "Your ads show up in fewer than 10 out of 100 searches."
        : "Pokazujesz się w mniej niż 10 na 100 wyszukiwań."
    );
  } else {
    out.push(
      en
        ? `Your ads show up in ${shown} out of 100 searches.`
        : `Pokazujesz się w ${shown} na 100 wyszukiwań.`
    );
  }

  const clicks = roughCount(s.missedClicksBudget);
  if (budget >= MENTION_FROM) {
    const base = en
      ? `In ${budget} out of 100 the ad didn't appear because the daily budget ran out`
      : `W ${budget} na 100 reklama nie pojawiła się, bo skończył się dzienny budżet`;
    out.push(
      clicks >= MIN_CLICKS_TO_MENTION
        ? en
          ? `${base} - that's about ${formatNumberPL(clicks)} extra clicks a month (estimate).`
          : `${base} - to ok. ${formatNumberPL(clicks)} dodatkowych kliknięć miesięcznie (szacunek).`
        : `${base}.`
    );
  } else {
    out.push(
      budget > 0
        ? en
          ? `Budget barely limited your visibility (only ${budget} out of 100).`
          : `Budżet prawie nie ograniczał widoczności (tylko ${budget} na 100).`
        : en
          ? "Budget didn't limit your visibility."
          : "Budżet nie ograniczał widoczności."
    );
  }

  if (rank >= MENTION_FROM) {
    out.push(
      en
        ? `In ${rank} out of 100 a competitor's ad ranked higher - better bids and ad quality help here, more budget alone won't.`
        : `W ${rank} na 100 wyżej była reklama konkurencji - tu pomagają stawki i jakość reklamy, sam budżet nie wystarczy.`
    );
  }
  return out;
}

function StackedBar({
  parts,
  className,
  showValues = false,
}: {
  parts: number[];
  className?: string;
  showValues?: boolean;
}) {
  const keys = ["shown", "budget", "rank"] as const;
  return (
    // Values are repeated in the legend/row text, so the bar is visual only.
    <div
      className={cn("flex w-full gap-0.5 overflow-hidden rounded-full bg-chip", className)}
      aria-hidden
    >
      {keys.map((k, i) =>
        parts[i] > 0 ? (
          <div
            key={k}
            // Plain string, not cn(): tailwind-merge reads bg-stripes as a
            // background colour and would drop the fill next to it.
            className={`flex h-full items-center justify-center first:rounded-l-full last:rounded-r-full ${SEGMENTS[k]}${
              k === "shown" && showValues ? " bg-stripes" : ""
            }`}
            style={{ width: `${parts[i]}%` }}
          >
            {/* Values as small white chips (benchmark's floating pill):
                readable on any fill in both themes. Narrow segments can't
                fit one; the legend carries it. */}
            {showValues && parts[i] >= 8 ? (
              <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground shadow-sm">
                {parts[i]}
              </span>
            ) : null}
          </div>
        ) : null
      )}
    </div>
  );
}

function CampaignRow({ c, en }: { c: ImpressionShareCampaign; en: boolean }) {
  const parts = toOutOf100([c.shown, c.budgetLost, c.rankLost]);
  const clicks = roughCount(c.missedClicksBudget);
  return (
    <li className="border-b border-line py-3.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[15px] font-medium" title={c.name}>
          {c.name}
        </p>
        <p className="shrink-0 text-[15px] font-medium tabular-nums">
          {c.shownBelow10 && parts[0] <= 10 ? "<10" : parts[0]}
          <span className="ml-1 text-xs font-normal text-ink-3">
            {en ? "of 100" : "na 100"}
          </span>
        </p>
      </div>
      <StackedBar parts={parts} className="mt-2 h-2" />
      <p className="mt-1.5 text-xs tabular-nums text-ink-3">
        {en ? "budget" : "budżet"}: {c.budgetAbove90 ? ">90" : parts[1]}
        {" · "}
        {en ? "ad rank" : "pozycja"}: {c.rankAbove90 ? ">90" : parts[2]}
        {parts[1] >= MENTION_FROM && clicks >= MIN_CLICKS_TO_MENTION
          ? en
            ? ` · ~${formatNumberPL(clicks)} clicks missed`
            : ` · ok. ${formatNumberPL(clicks)} kliknięć mniej`
          : null}
      </p>
    </li>
  );
}

/**
 * "Jak bardzo jesteś widoczny w Google" - Search impression share told as
 * "out of 100 searches", with the lost part split into budget vs ad rank.
 * The budget slice is the fact-based way to talk about budget; the rank slice
 * shows when more money alone wouldn't help. Renders nothing without data.
 */
export function ImpressionShare({
  data,
  lang = "pl",
}: {
  data: ImpressionShareSummary | null;
  lang?: Lang;
}) {
  if (!data || data.campaigns.length === 0) return null;
  const en = lang === "en";
  const parts = toOutOf100([data.shown, data.budgetLost, data.rankLost]);
  const l = labels(en);
  const sentences = headline(data, parts, en);
  const extraClicks = roughCount(data.missedClicksBudget);
  const extraCost = roughCount(data.missedCostBudgetMinorUnits / 100) * 100;
  const top = data.campaigns.slice(0, TOP_CAMPAIGNS);

  return (
    <section aria-labelledby="impression-share-heading" className="glass min-w-0 rounded-glass p-6 sm:p-7">
      <p className="kick">{en ? "Visibility on Google · last 30 days" : "Widoczność w Google · ostatnie 30 dni"}</p>
      <h2 id="impression-share-heading" className="mt-2 text-[22px] font-medium tracking-[-0.03em] text-foreground">
        {en ? "How visible you are on Google" : "Jak dobrze widać Twoje reklamy w Google"}
      </h2>
      <p className="mt-1.5 text-sm text-ink-3">
        {en
          ? "Out of 100 Google searches where your ad could have shown - Search campaigns, last 30 days"
          : "Na 100 wyszukiwań w Google, przy których Twoja reklama mogła się pojawić - kampanie w wyszukiwarce, ostatnie 30 dni"}
      </p>

      <StackedBar parts={parts} showValues className="mt-5 h-10 sm:h-11" />
      <ul className="mt-3 flex flex-wrap items-start gap-1.5 text-xs text-ink-2">
        {(["shown", "budget", "rank"] as const).map((k, i) => (
          <li key={k} className={LEGEND_CHIP}>
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${SEGMENTS[k]}${k === "shown" ? " bg-stripes" : ""}`}
              aria-hidden
            />
            {/* One text node so the number wraps with the label on phones
                instead of drifting to the far edge. */}
            <span>
              {l[k]}{" "}
              <span className="font-semibold tabular-nums text-foreground">{parts[i]}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 max-w-3xl space-y-1 text-[15px] leading-relaxed text-ink-2">
        {sentences.map((s) => (
          <p key={s}>{s}</p>
        ))}
        {parts[1] >= MENTION_FROM &&
        extraClicks >= MIN_CLICKS_TO_MENTION &&
        extraCost > 0 ? (
          <p className="text-ink-3">
            {en
              ? `At today's cost per click, that would mean roughly ${formatPlnWhole(extraCost)} more ad spend a month.`
              : `Przy obecnej cenie kliknięcia oznaczałoby to ok. ${formatPlnWhole(extraCost)} więcej wydatków na reklamy miesięcznie.`}
          </p>
        ) : null}
      </div>

      {top.length > 1 ? (
        <>
          <h3 className="kick mt-7 text-[11px]">
            {en ? "By campaign" : "Według kampanii"}
          </h3>
          <ul className="mt-2">
            {top.map((c) => (
              <CampaignRow key={c.key} c={c} en={en} />
            ))}
          </ul>
        </>
      ) : null}

      <div className="mt-5 space-y-1 border-t border-line pt-4 text-xs leading-relaxed text-ink-3">
        <p>
          {en
            ? `"Searches where you could have shown" is Google's own estimate, based on your keywords, locations and schedule. Based on ${formatNumberPL(data.impressions)} impressions.`
            : `„Wyszukiwania, przy których Twoja reklama mogła się pojawić” to szacunek Google na podstawie słów kluczowych, lokalizacji i harmonogramu kampanii. Podstawa: ${formatNumberPL(data.impressions)} wyświetleń.`}
        </p>
        <p>
          {en
            ? "Extra clicks assume today's click rate and price - the real number is likely lower, because extra exposure often lands at weaker times and in pricier auctions."
            : "Dodatkowe kliknięcia liczymy przy obecnym współczynniku klikalności i cenie - realnie może ich być mniej, bo dodatkowe wyświetlenia często trafiają na słabsze godziny i droższe aukcje."}
        </p>
        {data.approximate ? (
          <p>
            {en
              ? "Google reports some values only as \"below 10%\" or \"above 90%\", so a few numbers are approximate."
              : "Google podaje część wartości tylko jako „poniżej 10%” lub „powyżej 90%”, więc niektóre liczby są przybliżone."}
          </p>
        ) : null}
        {data.campaignsWithoutData > 0 ? (
          <p>
            {en
              ? `${formatNumberPL(data.campaignsWithoutData)} campaign(s) skipped - Google doesn't have enough data yet.`
              : `Pominięto kampanie bez wystarczających danych w Google: ${formatNumberPL(data.campaignsWithoutData)}.`}
          </p>
        ) : null}
      </div>
    </section>
  );
}
