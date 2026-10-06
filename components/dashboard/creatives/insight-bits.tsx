import { RefreshCw } from "lucide-react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import { Ping } from "@/components/ui/primitives";
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
  neutral: "bg-chip text-ink-2",
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
            // Pill on one line, soft tag when a narrow card wraps it.
            "inline-flex max-w-full rounded-[10px] px-2 py-0.5 font-medium leading-snug",
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
      className="glass-tip absolute left-2 top-2 z-[1] inline-flex h-7 items-center gap-2 rounded-full pl-2.5 pr-3 text-[11px] font-semibold sm:left-3 sm:top-3 sm:text-[12px]"
      title={`${fatigueHeadline(lang)}. ${fatigueReason(fatigue, lang)}`}
    >
      <Ping tone="amber" still />
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
    <section aria-labelledby="refresh-list-heading" className="glass min-w-0 space-y-4 rounded-glass p-6 sm:p-7">
      <div>
        <p className="kick flex items-center gap-2">
          <Ping tone="amber" />
          {en ? "Ad fatigue" : "Zmęczenie reklam"}
        </p>
        <h2 id="refresh-list-heading" className="mt-2 flex items-center gap-2 text-[22px] font-medium tracking-[-0.03em] text-foreground">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
            <RefreshCw className="h-4 w-4" aria-hidden />
          </span>
          {en ? "Worth refreshing" : "Do odświeżenia"}{" "}
          <span className="font-light tabular-nums text-ink-3">({items.length})</span>
        </h2>
        <p className="mt-1.5 max-w-3xl text-sm text-ink-3">
          {en
            ? "People have seen these ads many times and respond less and less. A new image, video or headline usually helps."
            : "Te reklamy odbiorcy widzieli już wiele razy i reagują coraz słabiej. Zwykle pomaga nowa grafika, film lub nagłówek."}
        </p>
      </div>
      <ul className="divide-y divide-line">
        {shown.map(({ c, fatigue }) => (
          <li key={c.adId}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-[16px] px-1 py-2.5 text-left transition-colors hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CreativeThumb
                src={c.thumbnailUrl}
                name={c.name}
                lang={lang}
                compact
                className="h-12 w-12 rounded-[14px]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium" title={c.name}>
                  {c.name}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-ink-3">
                  {fatigueReason(fatigue, lang)}
                </p>
              </div>
              <span className="hidden shrink-0 text-sm font-medium tabular-nums sm:block">
                {formatPlnWhole(c.spend)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <p className="text-xs text-ink-3">
          {en
            ? `+${rest} more - marked "Refresh" in the gallery below.`
            : `+${rest} ${plPlural(rest, "kolejna", "kolejne", "kolejnych")} - ${plPlural(rest, "oznaczona", "oznaczone", "oznaczonych")} „Do odświeżenia” w galerii poniżej.`}
        </p>
      ) : null}
    </section>
  );
}
