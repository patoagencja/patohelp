import { RefreshCw } from "lucide-react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import {
  fatigueHeadline,
  fatigueReason,
  plPlural,
  rankingChips,
  type CreativeItem,
  type Fatigue,
  type Lang,
  type RankingKind,
  type RankingTone,
} from "@/lib/dashboard/creatives";
import { cn, formatPlnWhole } from "@/lib/utils";

// Below-average is amber, not rose: it is Meta's relative diagnosis, a cue to
// look closer, not proof the ad is failing (the verdict chip owns red).
const RANKING_TONE: Record<RankingTone, string> = {
  good: "bg-positive-soft text-positive",
  neutral: "bg-muted text-muted-foreground",
  bad: "bg-warning-soft text-warning",
};

/** Meta's relevance diagnostics as chips. Renders nothing when none are known. */
export function RankingChipList({
  c,
  lang,
  kinds,
  compact = false,
  className,
}: {
  c: CreativeItem;
  lang: Lang;
  kinds?: RankingKind[];
  /** Short labels ("Jakość: ...") for narrow gallery cards. */
  compact?: boolean;
  className?: string;
}) {
  // On narrow cards an "average" chip is noise; only deviations earn space.
  const chips = rankingChips(c, lang, kinds).filter(
    (ch) => !compact || ch.tone !== "neutral"
  );
  if (chips.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {chips.map((ch) => (
        <span
          key={ch.kind}
          title={ch.hint}
          className={cn(
            "inline-flex max-w-full rounded-full px-2 py-0.5 font-medium leading-snug",
            compact ? "text-[10px] sm:text-[11px]" : "text-[11px]",
            RANKING_TONE[ch.tone]
          )}
        >
          {compact ? ch.short : ch.label}
        </span>
      ))}
    </div>
  );
}

/** Overlay badge for a thumbnail. */
export function FatigueBadge({ fatigue, lang }: { fatigue: Fatigue; lang: Lang }) {
  return (
    <span
      className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning shadow-md sm:text-[11px]"
      title={`${fatigueHeadline(lang)}. ${fatigueReason(fatigue, lang)}`}
    >
      <RefreshCw className="h-3 w-3" aria-hidden />
      {lang === "en" ? "Refresh" : "Do odświeżenia"}
    </span>
  );
}

const REFRESH_LIST_MAX = 5;

/**
 * "Do odświeżenia": ads people have seen too often AND stopped responding to.
 * Ordered by spend - that is where a refresh buys back the most budget.
 */
export function RefreshList({
  items,
  lang,
  onSelect,
}: {
  items: Array<{ c: CreativeItem; fatigue: Fatigue }>;
  lang: Lang;
  onSelect: (c: CreativeItem) => void;
}) {
  const en = lang === "en";
  if (items.length === 0) return null;
  const shown = items.slice(0, REFRESH_LIST_MAX);
  const rest = items.length - shown.length;
  return (
    <section className="surface space-y-3 p-5 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-section-title text-foreground">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </span>
          {en ? "Worth refreshing" : "Do odświeżenia"}{" "}
          <span className="font-normal tabular-nums text-muted-foreground">({items.length})</span>
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {en
            ? "People have seen these ads many times and respond less and less. A new image, video or headline usually helps."
            : "Te reklamy odbiorcy widzieli już wiele razy i reagują coraz słabiej. Zwykle pomaga nowa grafika, film lub nagłówek."}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {shown.map(({ c, fatigue }) => (
          <li key={c.adId}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              className="flex w-full min-w-0 items-center gap-3 rounded-xl py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CreativeThumb
                src={c.thumbnailUrl}
                name={c.name}
                lang={lang}
                compact
                className="h-11 w-11 rounded-lg"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={c.name}>
                  {c.name}
                </p>
                <p className="text-xs leading-snug text-muted-foreground">
                  {fatigueReason(fatigue, lang)}
                </p>
              </div>
              <span className="hidden shrink-0 tabular-nums text-xs text-muted-foreground sm:block">
                {formatPlnWhole(c.spend)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <p className="text-xs text-muted-foreground">
          {en
            ? `+${rest} more - marked "Refresh" in the gallery below.`
            : `+${rest} ${plPlural(rest, "kolejna", "kolejne", "kolejnych")} - ${plPlural(rest, "oznaczona", "oznaczone", "oznaczonych")} „Do odświeżenia” w galerii poniżej.`}
        </p>
      ) : null}
    </section>
  );
}
