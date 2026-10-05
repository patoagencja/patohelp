import { Eye, MousePointerClick, PiggyBank, TrendingUp } from "lucide-react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import {
  AWARD_LABEL,
  awardSentence,
  cpcOf,
  ctrOf,
  MIN_CLICKS,
  MIN_IMPRESSIONS,
  type AwardKind,
  type Benchmarks,
  type CreativeItem,
  type Lang,
  type PodiumEntry,
} from "@/lib/dashboard/creatives";
import { cn, formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

const AWARD_ICON: Record<AwardKind, typeof Eye> = {
  ctr: MousePointerClick,
  cpc: PiggyBank,
  impressions: Eye,
  clicks: TrendingUp,
};

// Each award keeps its own hue so the same category reads the same everywhere.
const AWARD_TONE: Record<AwardKind, string> = {
  ctr: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  cpc: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  impressions: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  clicks: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

const MEDAL = [
  "bg-amber-500 text-white",
  "bg-slate-400 text-white",
  "bg-orange-700 text-white",
];

function AwardBadge({
  kind,
  lang,
  size = "md",
}: {
  kind: AwardKind;
  lang: Lang;
  size?: "md" | "sm";
}) {
  const Icon = AWARD_ICON[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold",
        AWARD_TONE[kind],
        size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]"
      )}
    >
      <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} aria-hidden />
      {AWARD_LABEL[lang][kind]}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="whitespace-nowrap tabular-nums text-xs font-semibold sm:text-sm">{value}</p>
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
      <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        {en
          ? `Not enough data to name the best ads yet - each ad needs at least ${formatNumberPL(MIN_IMPRESSIONS)} views.`
          : `Za mało danych, by wskazać najlepsze reklamy - każda potrzebuje min. ${formatNumberPL(MIN_IMPRESSIONS)} wyświetleń.`}
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {entries.map((e, i) => {
        const c = e.creative;
        const [primary, ...extra] = e.awards;
        const ctr = ctrOf(c);
        const cpc = cpcOf(c);
        return (
          <button
            key={c.adId}
            type="button"
            onClick={() => onSelect(c)}
            className={cn(
              "group flex min-w-0 gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex-col lg:p-0",
              i === 0 && "ring-1 ring-amber-400/50"
            )}
          >
            <CreativeThumb
              src={c.thumbnailUrl}
              name={c.name}
              lang={lang}
              className="aspect-square w-24 self-start sm:w-28 lg:aspect-[4/3] lg:w-full lg:rounded-b-none lg:rounded-t-2xl"
            >
              <span
                className={cn(
                  "absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shadow lg:left-3 lg:top-3 lg:h-8 lg:w-8 lg:text-sm",
                  MEDAL[i]
                )}
                aria-label={en ? `Place ${i + 1}` : `Miejsce ${i + 1}`}
              >
                {i + 1}
              </span>
            </CreativeThumb>

            <div className="flex min-w-0 flex-1 flex-col gap-2 lg:p-4 lg:pt-1">
              <div>
                <AwardBadge kind={primary} lang={lang} />
              </div>
              <p
                className="line-clamp-2 break-words text-sm font-semibold leading-snug"
                title={c.name}
              >
                {c.name}
              </p>
              <p className="text-sm leading-snug text-muted-foreground">
                {awardSentence(primary, c, bench, lang)}
              </p>
              {extra.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {extra.map((k) => (
                    <AwardBadge key={k} kind={k} lang={lang} size="sm" />
                  ))}
                </div>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-2">
                <MiniStat label={en ? "Spend" : "Wydatki"} value={formatMoneyPLN(c.spend)} />
                <MiniStat
                  label={en ? "Click rate" : "Klikalność"}
                  value={ctr != null ? formatPercent(ctr, 1) : "-"}
                />
                <MiniStat
                  label={en ? "Per click" : "Za klik"}
                  value={cpc != null ? formatMoneyPLN(Math.round(cpc)) : "-"}
                />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function PodiumFootnote({ lang }: { lang: Lang }) {
  return (
    <p className="text-xs text-muted-foreground">
      {lang === "en"
        ? `Only ads with at least ${formatNumberPL(MIN_IMPRESSIONS)} views (and ${MIN_CLICKS} clicks for the price award) take part, so small tests don't skew the ranking.`
        : `Biorą udział tylko reklamy z min. ${formatNumberPL(MIN_IMPRESSIONS)} wyświetleń (i ${MIN_CLICKS} kliknięć w kategorii ceny), żeby małe testy nie zaburzały wyników.`}
    </p>
  );
}
