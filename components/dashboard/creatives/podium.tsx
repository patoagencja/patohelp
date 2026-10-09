import { Eye, Hand, MousePointerClick, PiggyBank, TrendingUp } from "lucide-react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import { RankingChipList } from "@/components/dashboard/creatives/insight-bits";
import {
  AWARD_LABEL,
  awardSentence,
  cpcOf,
  ctrOf,
  MIN_CLICKS,
  MIN_IMPRESSIONS,
  videoRatesOf,
  type AwardKind,
  type Benchmarks,
  type CreativeItem,
  type Lang,
  type PodiumEntry,
} from "@/lib/dashboard/creatives";
import { cn, formatMoneyPLN,
  formatPlnWhole, formatNumberPL, formatPercent } from "@/lib/utils";

const AWARD_ICON: Record<AwardKind, typeof Eye> = {
  ctr: MousePointerClick,
  cpc: PiggyBank,
  hook: Hand,
  impressions: Eye,
  clicks: TrendingUp,
};

// Awards are categories, not judgements: the icon + words tell them apart.
// The headline award rides on the thumbnail as a glass medal (board
// `.medal`); extra awards stay quiet chips under the text.
const EXTRA_AWARD = "bg-chip text-ink-2";

// Place 1 is the one highlighted thing (signature lime); 2 and 3 are chip
// circles. The digit carries the place either way.
const RANK = ["bg-lime text-lime-foreground", "bg-chip text-ink-2", "bg-chip text-ink-2"];

// Board layout: #2 · #1 · #3 on wide screens, the winner raised in the
// middle on the ink surface with the tallest thumbnail.
const PLACE_ORDER = ["lg:order-2 lg:flex-[1.2_1_0]", "lg:order-1 lg:flex-[1_1_0]", "lg:order-3 lg:flex-[1_1_0]"];
const THUMB_H = ["lg:h-[360px]", "lg:h-[280px]", "lg:h-[240px]"];

// Inside the ink winner card the raw pastel vars (chip, ink-2/3, line) are
// re-pointed to the anchor palette, so the shared bits below just work.
const ANCHOR_VARS =
  "surface-anchor [--chip:hsl(var(--anchor-foreground)/0.09)] [--ink-2:hsl(var(--anchor-muted))] [--ink-3:hsl(var(--anchor-muted))] [--line:hsl(var(--anchor-foreground)/0.12)]";

function AwardChip({ kind, lang }: { kind: AwardKind; lang: Lang }) {
  const Icon = AWARD_ICON[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        EXTRA_AWARD
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {AWARD_LABEL[lang][kind]}
    </span>
  );
}

function MiniStat({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  // A label that wraps (two columns on a phone) pushes its figure to the
  // bottom, level with its neighbours', instead of being cut to "Oglądane …".
  return (
    <div className="flex min-w-0 flex-col justify-between">
      <dt className="break-words text-xs leading-tight text-ink-3">{label}</dt>
      <dd className="mt-0.5 whitespace-nowrap text-[15px] font-semibold tabular-nums">
        {/* The stat the award is about sits on a lime pill: readable on the
            ink card and on glass, in both themes (lime text would not be). */}
        <span className={cn(hot && "-mx-1.5 rounded-full bg-lime px-1.5 text-lime-foreground")}>
          {value}
        </span>
      </dd>
    </div>
  );
}

export function CreativesPodium({
  entries,
  bench,
  lang,
  onSelect,
}: {
  entries: PodiumEntry[];
  bench: Benchmarks;
  lang: Lang;
  onSelect: (c: CreativeItem) => void;
}) {
  const en = lang === "en";

  if (entries.length === 0) {
    return (
      <p className="rounded-[22px] border border-dashed border-line p-5 text-sm text-ink-3">
        {en
          ? `Not enough data to name the best ads yet - each ad needs at least ${formatNumberPL(MIN_IMPRESSIONS)} views.`
          : `Za mało danych, by wskazać najlepsze reklamy - każda potrzebuje min. ${formatNumberPL(MIN_IMPRESSIONS)} wyświetleń.`}
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-5">
      {entries.map((e, i) => {
        const c = e.creative;
        const [primary, ...extra] = e.awards;
        const ctr = ctrOf(c);
        const cpc = cpcOf(c);
        const hook = videoRatesOf(c)?.hook ?? null;
        const Icon = AWARD_ICON[primary];
        const winner = i === 0;
        return (
          <li key={c.adId} className={cn("min-w-0", PLACE_ORDER[i])}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              className={cn(
                "group flex w-full min-w-0 gap-3.5 rounded-[30px] p-3 text-left transition-[transform,background-color] duration-500 [transition-timing-function:cubic-bezier(.34,1.56,.64,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:hover:-translate-y-1 lg:flex-col lg:p-3.5",
                winner ? cn("glass flex-col shadow-glass", ANCHOR_VARS) : "hover:bg-chip"
              )}
            >
              <CreativeThumb
                src={c.thumbnailUrl}
                name={c.name}
                lang={lang}
                className={cn(
                  "rounded-[20px] lg:w-full",
                  // Glass chips on the thumbnail sit on the light/dark tip
                  // glass, not on the ink card: give them back the page ink.
                  winner && "[--foreground:var(--anchor)]",
                  winner
                    ? "aspect-[16/10] w-full lg:aspect-auto"
                    : // Small phone thumbs: icon only; place + award go in the text.
                      "aspect-square w-24 self-start max-lg:[&_.thumb-label]:hidden sm:w-28 lg:aspect-auto",
                  THUMB_H[i]
                )}
              >
                {/* Glass medal: place + the headline award (board `.medal`).
                    Small phone thumbs have no room; their text line says it. */}
                <span
                  aria-hidden
                  className={cn(
                    "glass-tip absolute left-2 top-2 z-[1] h-7 items-center gap-1.5 rounded-full pl-1 pr-2.5 text-[12.5px] font-semibold lg:left-3 lg:top-3",
                    winner ? "inline-flex" : "hidden lg:inline-flex"
                  )}
                >
                  <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold", RANK[i])}>
                    {i + 1}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Icon className="h-3.5 w-3.5" />
                    {AWARD_LABEL[lang][primary]}
                  </span>
                </span>
              </CreativeThumb>

              <div className="flex min-w-0 flex-1 flex-col gap-2 lg:px-1.5">
                <span className="sr-only">
                  {en ? `Place ${i + 1}` : `Miejsce ${i + 1}`}: {AWARD_LABEL[lang][primary]}.
                </span>
                {/* Phones: the award in words, since the small medal can't
                    carry it. */}
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-medium text-ink-2 lg:hidden",
                    winner && "hidden"
                  )}
                >
                  <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold", RANK[i])}>
                    {i + 1}
                  </span>
                  <Icon className="h-3.5 w-3.5" />
                  {AWARD_LABEL[lang][primary]}
                </span>
                <p
                  className={cn(
                    "line-clamp-2 break-words font-semibold leading-snug tracking-[-0.01em]",
                    winner ? "text-[17px] sm:text-lg" : "text-[15px] sm:text-base"
                  )}
                  title={c.name}
                >
                  {c.name}
                </p>
                <p className="text-[13.5px] leading-snug text-ink-2">
                  {awardSentence(primary, c, bench, lang)}
                </p>
                {extra.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {extra.map((k) => (
                      <AwardChip key={k} kind={k} lang={lang} />
                    ))}
                  </div>
                ) : null}
                <RankingChipList c={c} lang={lang} />
                <dl className="mt-auto grid grid-cols-[repeat(auto-fit,minmax(4.25rem,1fr))] gap-2 rounded-[18px] bg-chip px-4 py-3.5">
                  <MiniStat label={en ? "Spend" : "Wydatki"} value={formatPlnWhole(c.spend)} />
                  <MiniStat
                    label={en ? "Click rate" : "Klikalność"}
                    value={ctr != null ? formatPercent(ctr, 1) : "-"}
                    hot={primary === "ctr"}
                  />
                  <MiniStat
                    label={en ? "Per click" : "Za klik"}
                    value={cpc != null ? formatMoneyPLN(Math.round(cpc)) : "-"}
                    hot={primary === "cpc"}
                  />
                  {hook != null ? (
                    <MiniStat
                      label={en ? "Watched 3s+" : "Oglądane 3 s+"}
                      value={formatPercent(hook * 100, 0)}
                      hot={primary === "hook"}
                    />
                  ) : null}
                </dl>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function PodiumFootnote({
  lang,
  entries = [],
}: {
  lang: Lang;
  entries?: PodiumEntry[];
}) {
  const hasHook = entries.some((e) => e.awards.includes("hook"));
  return (
    <p className="text-xs leading-relaxed text-ink-3">
      {lang === "en"
        ? `Only ads with at least ${formatNumberPL(MIN_IMPRESSIONS)} views (and ${MIN_CLICKS} clicks for the price award) take part, so small tests don't skew the ranking.`
        : `Biorą udział tylko reklamy z min. ${formatNumberPL(MIN_IMPRESSIONS)} wyświetleń (i ${MIN_CLICKS} kliknięć w kategorii ceny), żeby małe testy nie zaburzały wyników.`}
      {hasHook
        ? lang === "en"
          ? " The attention award compares videos only: the share of views watched for more than 3 seconds."
          : " Nagroda za zatrzymanie uwagi porównuje tylko filmy: jaka część wyświetleń trwała dłużej niż 3 sekundy."
        : ""}
    </p>
  );
}
