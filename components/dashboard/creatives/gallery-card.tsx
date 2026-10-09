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
import { Ping, type PingTone } from "@/components/ui/primitives";
import { cn, formatMoneyPLN,
  formatPlnWhole, formatPercent } from "@/lib/utils";

// Verdict = a ping dot + the words (board `.st`), like campaign statuses:
// lime better, amber/coral worse, grey average or too early to tell.
const VERDICT_PING: Record<Verdict, PingTone> = {
  better: "lime",
  average: "muted",
  worse: "coral",
  unknown: "muted",
};

// A stat only gets colour when it alone deviates >=15% from the average -
// the colour then points at the "why" behind the verdict chip.
function tone(ratio: number | null): string {
  if (ratio == null) return "";
  if (ratio >= 1.15) return "text-positive";
  if (ratio <= 1 / 1.15) return "text-negative";
  return "";
}

export function VerdictChip({
  score,
  lang,
}: {
  score: CreativeScore;
  lang: Lang;
}) {
  return (
    <span
      // Wraps rather than truncates: the label is never cut to "Nieco lepsza n…".
      className="inline-flex max-w-full items-start gap-2 text-[12.5px] font-medium leading-4 text-ink-2"
      title={verdictReason(score, lang)}
    >
      <Ping
        tone={VERDICT_PING[score.verdict]}
        still={score.verdict !== "worse"}
        className="mt-1 shrink-0"
      />
      <span className="min-w-0">{verdictLabel(score, lang)}</span>
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

  // `top`: shown at the card's top right from sm, so the list skips it there.
  // Short labels: on a phone two cards share the width and the panel has
  // room for ~10 characters next to the figure ("Koszt kliknięcia" and
  // "Zatrzymuje uwagę" were cut to "Koszt klik…"). The same words as the
  // podium's figures.
  const stats: Array<{ label: string; value: string; cls: string; hint?: string; top?: boolean }> = [
    { label: en ? "Spend" : "Wydatki", value: formatPlnWhole(c.spend), cls: "" },
    {
      label: en ? "Click rate" : "Klikalność",
      value: ctr != null ? formatPercent(ctr, 1) : "-",
      cls: tone(score.ctrRatio),
    },
    {
      label: en ? "Per click" : "Za klik",
      value: cpc != null ? formatMoneyPLN(Math.round(cpc)) : "-",
      cls: tone(score.cpcRatio),
      hint: en ? "Cost per click" : "Koszt kliknięcia",
      top: true,
    },
    ...(video?.hook != null
      ? [
          {
            label: en ? "Watched 3s+" : "Oglądane 3 s+",
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
      // Board "Pozostałe reklamy": plain tiles on the section's glass card -
      // a rounded thumbnail, the name and a quiet chip panel of numbers.
      className="group flex min-w-0 flex-col gap-3 rounded-[24px] p-1.5 text-left transition-[transform,background-color] duration-500 [transition-timing-function:cubic-bezier(.34,1.56,.64,1)] hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:hover:-translate-y-1 sm:p-2"
    >
      <CreativeThumb
        src={c.thumbnailUrl}
        name={c.name}
        lang={lang}
        className={cn("w-full rounded-[18px]", wide ? "aspect-square sm:aspect-[16/10]" : "aspect-square")}
      >
        {fatigue ? <FatigueBadge fatigue={fatigue} lang={lang} /> : null}
      </CreativeThumb>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-1">
        <div className="flex min-w-0 items-start justify-between gap-3">
          {/* Three lines on phones: half a screen fits ~15 characters a
              line, so two cut most real ad names mid-word. */}
          <p
            className="line-clamp-3 min-h-[2.5rem] min-w-0 break-words text-[15px] font-medium leading-5 sm:line-clamp-2"
            title={c.name}
          >
            {c.name}
          </p>
          {/* Board: the price per click, right-aligned, is the card's number. */}
          <p className="hidden shrink-0 text-right sm:block">
            <b className={cn("block text-[15px] font-semibold tabular-nums", tone(score.cpcRatio))}>
              {cpc != null ? formatMoneyPLN(Math.round(cpc)) : "-"}
            </b>
            <span className="block text-[11.5px] text-ink-3">{en ? "per click" : "za kliknięcie"}</span>
          </p>
        </div>
        <div className="min-w-0">
          <VerdictChip score={score} lang={lang} />
          {reason ? (
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-ink-3">
              {reason}
            </p>
          ) : null}
          <RankingChipList c={c} lang={lang} compact className="mt-2" />
        </div>
        <dl className="mt-auto space-y-1 rounded-[16px] bg-chip px-3 py-2.5">
          {stats.map((s) => (
            <div
              key={s.label}
              className={cn("flex items-baseline justify-between gap-2", s.top && "sm:hidden")}
              title={s.hint}
            >
              {/* Wraps rather than truncates if a label still doesn't fit. */}
              <dt className="min-w-0 break-words text-[11px] leading-tight text-ink-3 sm:text-xs">
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
