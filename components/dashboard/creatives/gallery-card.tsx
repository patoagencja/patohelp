import { Info, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import { FatigueBadge, RankingChipList } from "@/components/dashboard/creatives/insight-bits";
import {
  cpcOf,
  ctrOf,
  fatigueOf,
  hasEnoughData,
  videoRatesOf,
  verdictLabel,
  verdictReason,
  type Benchmarks,
  type CreativeItem,
  type CreativeScore,
  type Lang,
  type Verdict,
} from "@/lib/dashboard/creatives";
import { cn, formatMoneyPLN,
  formatPlnWhole, formatPercent } from "@/lib/utils";

const VERDICT_TONE: Record<Verdict, string> = {
  better: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  average: "bg-muted text-muted-foreground",
  worse: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  unknown: "bg-muted text-muted-foreground",
};

const VERDICT_ICON: Record<Verdict, typeof Info> = {
  better: TrendingUp,
  average: Minus,
  worse: TrendingDown,
  unknown: Info,
};

// A stat only gets colour when it alone deviates >=15% from the average -
// the colour then points at the "why" behind the verdict chip.
function tone(ratio: number | null): string {
  if (ratio == null) return "";
  if (ratio >= 1.15) return "text-emerald-700 dark:text-emerald-400";
  if (ratio <= 1 / 1.15) return "text-rose-700 dark:text-rose-400";
  return "";
}

export function VerdictChip({
  score,
  lang,
}: {
  score: CreativeScore;
  lang: Lang;
}) {
  const Icon = VERDICT_ICON[score.verdict];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        VERDICT_TONE[score.verdict]
      )}
      title={verdictReason(score, lang)}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{verdictLabel(score, lang)}</span>
    </span>
  );
}

export function GalleryCard({
  c,
  score,
  bench,
  lang,
  onSelect,
  wide = false,
}: {
  c: CreativeItem;
  score: CreativeScore;
  bench: Benchmarks;
  lang: Lang;
  onSelect: (c: CreativeItem) => void;
  /** 4:3 thumbnail for three-up rows, where squares get very tall. */
  wide?: boolean;
}) {
  const en = lang === "en";
  const ctr = ctrOf(c);
  const cpc = cpcOf(c);
  // Thin-data ads keep the explanation in the chip tooltip only - a line of
  // "too early" text on many cards would drown the ones that matter.
  const reason = score.verdict === "unknown" ? "" : verdictReason(score, lang);
  const video = videoRatesOf(c);
  const fatigue = fatigueOf(c, bench);
  // Colour the hook only when it can be fairly compared (enough views, and
  // an average built from more than this one video).
  const hookRatio =
    video?.hook != null && bench.hookRate && bench.videoCount >= 2 && hasEnoughData(c)
      ? video.hook / bench.hookRate
      : null;

  const stats: Array<{ label: string; value: string; cls: string; hint?: string }> = [
    { label: en ? "Spend" : "Wydatki", value: formatPlnWhole(c.spend), cls: "" },
    {
      label: en ? "Click rate" : "Klikalność",
      value: ctr != null ? formatPercent(ctr, 1) : "-",
      cls: tone(score.ctrRatio),
    },
    {
      label: en ? "Cost per click" : "Koszt kliknięcia",
      value: cpc != null ? formatMoneyPLN(Math.round(cpc)) : "-",
      cls: tone(score.cpcRatio),
    },
    ...(video?.hook != null
      ? [
          {
            label: en ? "Stops the scroll" : "Zatrzymuje uwagę",
            value: formatPercent(video.hook * 100, 0),
            cls: tone(hookRatio),
            hint: en
              ? "Share of views watched for more than 3 seconds"
              : "Część wyświetleń, w których ktoś oglądał dłużej niż 3 sekundy",
          },
        ]
      : []),
    ...(video?.completion != null
      ? [
          {
            label: en ? "Watched to the end" : "Do końca",
            value: formatPercent(video.completion * 100, 0),
            cls: "",
            hint: en
              ? "Of those who watched 3+ seconds"
              : "Spośród osób, które oglądały dłużej niż 3 sekundy",
          },
        ]
      : []),
  ];

  return (
    <button
      type="button"
      onClick={() => onSelect(c)}
      className="surface group flex min-w-0 flex-col overflow-hidden text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
    >
      <CreativeThumb
        src={c.thumbnailUrl}
        name={c.name}
        lang={lang}
        className={cn("w-full rounded-none", wide ? "aspect-square sm:aspect-[4/3]" : "aspect-square")}
      >
        {fatigue ? <FatigueBadge fatigue={fatigue} lang={lang} /> : null}
      </CreativeThumb>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5 sm:p-3">
        <p
          className="line-clamp-2 min-h-[2.5rem] break-words text-sm font-medium leading-5"
          title={c.name}
        >
          {c.name}
        </p>
        <div className="min-w-0">
          <VerdictChip score={score} lang={lang} />
          {reason ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {reason}
            </p>
          ) : null}
          <RankingChipList c={c} lang={lang} compact className="mt-1.5" />
        </div>
        <dl className="mt-auto space-y-1 border-t border-border pt-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex items-baseline justify-between gap-2"
              title={s.hint}
            >
              <dt className="truncate text-[11px] text-muted-foreground sm:text-xs">
                {s.label}
              </dt>
              <dd
                className={cn(
                  "shrink-0 tabular-nums text-xs font-semibold",
                  s.cls
                )}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </button>
  );
}
