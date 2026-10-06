"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Film, RefreshCw, X } from "lucide-react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import { RankingChipList } from "@/components/dashboard/creatives/insight-bits";
import { useModalFocus } from "@/components/dashboard/use-modal-focus";
import { SegmentedTrack, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import {
  completionSentence,
  computeBenchmarks,
  fatigueHeadline,
  fatigueOf,
  fatigueReason,
  frequencyOf,
  holdSentence,
  hookSentence,
  videoRatesOf,
  verdictLabel,
  verdictReason,
  type Benchmarks,
  type CreativeItem,
  type CreativeScore,
} from "@/lib/dashboard/creatives";
import { cn, formatMoneyPLN,
  formatPlnWhole, formatNumberPL, formatPercent } from "@/lib/utils";

// Re-exported so existing imports (demo data, pages) keep working.
export type { CreativeItem } from "@/lib/dashboard/creatives";

type SortKey = "spend" | "ctr" | "cpc" | "clicks";

const SORT_KEYS: SortKey[] = ["spend", "clicks", "ctr", "cpc"];

// Modal preview of a single creative - "click an ad, see it big".
export function CreativeModal({
  c,
  onClose,
  en = false,
  score,
  bench,
}: {
  c: CreativeItem;
  onClose: () => void;
  en?: boolean;
  /** Optional verdict vs the client's average, shown under the name. */
  score?: CreativeScore;
  /** Needed for the fatigue check (compares against the client's videos). */
  bench?: Benchmarks;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, true, onClose);

  useEffect(() => {
    // Lock scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const lang = en ? "en" : "pl";
  const reason = score ? verdictReason(score, lang) : "";
  const video = videoRatesOf(c);
  const freq = frequencyOf(c);
  const fatigue = bench ? fatigueOf(c, bench) : null;
  const videoLines = video
    ? [
        video.hook != null ? hookSentence(video.hook, lang) : null,
        video.hold != null ? holdSentence(video.hold, lang) : null,
        video.completion != null ? completionSentence(video.completion, lang) : null,
        video.avgWatchSeconds != null
          ? en
            ? `On average a view lasts ${video.avgWatchSeconds.toLocaleString("en-GB", { maximumFractionDigits: 1 })} s.`
            : `Średnio film jest oglądany przez ${video.avgWatchSeconds.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} s.`
          : null,
      ].filter((l): l is string => l != null)
    : [];

  return (
    // !m-0: callers render this inline, often as a direct child of a
    // `space-y-*` stack (<main>), whose sibling margin would push the fixed
    // overlay down and leave an undimmed strip at the top of the screen.
    <div
      className="fixed inset-0 z-50 !m-0 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={c.name}
    >
      <div
        ref={panelRef}
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-glass bg-background shadow-glass"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={en ? "Close" : "Zamknij"}
          className="glass-tip absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-full transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:active:scale-100"
        >
          <X className="h-[18px] w-[18px]" aria-hidden />
        </button>

        <CreativeThumb
          src={c.thumbnailUrl}
          name={c.name}
          lang={lang}
          fit="contain"
          className="h-[50vh] max-h-[28rem] min-h-48 w-full rounded-none bg-black/90"
        />

        <div className="space-y-3 overflow-y-auto p-5 sm:p-6">
          <div>
            <p className="break-words text-[17px] font-medium leading-snug tracking-[-0.01em]">{c.name}</p>
            {score ? (
              <p className="mt-1 text-xs text-ink-3">
                <span className="font-medium text-foreground">
                  {verdictLabel(score, lang)}
                </span>
                {reason ? ` · ${reason}` : ""}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label: en ? "Spend" : "Wydatki", value: formatPlnWhole(c.spend) },
              { label: en ? "Views" : "Wyświetlenia", value: formatNumberPL(c.impressions) },
              { label: en ? "Clicks" : "Kliknięcia", value: formatNumberPL(c.clicks) },
              {
                label: en ? "Click rate (CTR)" : "Klikalność (CTR)",
                value: c.ctr != null ? formatPercent(c.ctr) : "-",
              },
              {
                label: en ? "Cost per click" : "Koszt kliknięcia",
                value: c.cpc != null ? formatMoneyPLN(Math.round(c.cpc)) : "-",
              },
              ...(c.reach != null
                ? [{ label: en ? "People reached" : "Zasięg (osoby)", value: formatNumberPL(c.reach) }]
                : []),
              ...(freq != null
                ? [
                    {
                      label: en ? "Times seen per person" : "Ile razy 1 osoba widziała",
                      value: freq.toLocaleString(en ? "en-GB" : "pl-PL", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      }),
                    },
                  ]
                : []),
            ].map((s) => (
              <div key={s.label} className="rounded-[16px] bg-chip p-3">
                <p className="text-[11px] text-ink-3">{s.label}</p>
                <p className="mt-0.5 tabular-nums text-lg font-light tracking-[-0.03em]">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
          {fatigue ? (
            <div className="flex gap-2 rounded-[16px] bg-warning-soft p-3 text-xs leading-snug text-warning">
              <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <p>
                <span className="font-semibold">{fatigueHeadline(lang)}.</span>{" "}
                {fatigueReason(fatigue, lang)}
              </p>
            </div>
          ) : null}
          {videoLines.length > 0 ? (
            <div className="space-y-1 rounded-[16px] bg-chip p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
                <Film className="h-3.5 w-3.5" aria-hidden />
                {en ? "How the video is watched" : "Jak oglądany jest film"}
              </p>
              {videoLines.map((l) => (
                <p key={l} className="text-xs leading-snug tabular-nums">
                  {l}
                </p>
              ))}
            </div>
          ) : null}
          <RankingChipList c={c} lang={lang} kinds={["quality", "engagement", "conversion"]} />
          {c.thumbnailUrl ? (
            <a
              href={c.thumbnailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {en ? "Open full-size image" : "Otwórz grafikę w pełnym rozmiarze"}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Dense table for agency power users. Embedded under the gallery's "Tabela"
 * toggle, so it carries no card chrome of its own when `embedded`.
 */
export function CreativesTable({
  creatives,
  lang = "pl",
  embedded = false,
}: {
  creatives: CreativeItem[];
  lang?: "pl" | "en";
  embedded?: boolean;
}) {
  const en = lang === "en";
  const sortLabel: Record<SortKey, string> = en
    ? { spend: "Spend", clicks: "Clicks", ctr: "CTR", cpc: "CPC" }
    : { spend: "Wydatki", clicks: "Kliknięcia", ctr: "Klikalność", cpc: "Koszt kliknięcia" };
  const [sort, setSort] = useState<SortKey>("spend");
  const [selected, setSelected] = useState<CreativeItem | null>(null);
  const bench = useMemo(() => computeBenchmarks(creatives), [creatives]);

  const table = [...creatives]
    .sort((a, b) => {
      if (sort === "ctr") return (b.ctr ?? -1) - (a.ctr ?? -1);
      if (sort === "cpc") return (a.cpc ?? Infinity) - (b.cpc ?? Infinity);
      if (sort === "clicks") return b.clicks - a.clicks;
      return b.spend - a.spend;
    })
    .slice(0, 50);

  return (
    <section
      className={cn(
        "min-w-0",
        embedded ? "" : "surface p-4 sm:p-5"
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[15px] font-medium">
          {en ? "All creatives" : "Wszystkie reklamy"} ({Math.min(creatives.length, 50)}
          {creatives.length > 50 ? `${en ? " of " : " z "}${creatives.length}` : ""})
          <span className="ml-2 text-sm font-normal text-ink-3">
            {en ? "· click a row to view the creative" : "· kliknij wiersz, by zobaczyć reklamę"}
          </span>
        </h2>
        <SegmentedTrack
          role="group"
          aria-label={en ? "Sort" : "Sortowanie"}
          className={cn(segmentedTrack, "self-start sm:self-auto")}
        >
          {SORT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
              className={segmentedItem(sort === key, "min-h-10 px-3 text-[13px]")}
            >
              {sortLabel[key]}
            </button>
          ))}
        </SegmentedTrack>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[40rem]">
          <thead>
            <tr className="text-left [&>th]:kick [&>th]:text-[10.5px] [&>th]:font-normal">
              <th className="py-2 pr-3 font-medium">{en ? "Creative" : "Reklama"}</th>
              <th className="py-2 pr-3 text-right font-medium">{en ? "Spend" : "Wydatki"}</th>
              <th className="py-2 pr-3 text-right font-medium">{en ? "Impr." : "Wyśw."}</th>
              <th className="py-2 pr-3 text-right font-medium">{en ? "Clicks" : "Klik."}</th>
              <th className="py-2 pr-3 text-right font-medium">{en ? "CTR" : "Klikalność"}</th>
              <th className="py-2 pr-3 text-right font-medium">{en ? "CPC" : "Koszt klik."}</th>
              <th className="py-2 pr-3 text-right font-medium" title={en ? "Times seen per person" : "Ile razy 1 osoba widziała reklamę"}>
                {en ? "Freq." : "Częst."}
              </th>
              <th className="py-2 text-right font-medium" title={en ? "Share of views watched 3s+ (videos)" : "Część wyświetleń oglądanych dłużej niż 3 s (filmy)"}>
                {en ? "3s+" : "3 s+"}
              </th>
            </tr>
          </thead>
          <tbody>
            {table.map((c) => (
              <tr
                key={c.adId}
                onClick={() => setSelected(c)}
                className="cursor-pointer border-t border-line hover:bg-chip"
              >
                <td className="max-w-[22rem] py-2.5 pr-3">
                  <div className="flex items-center gap-2.5">
                    <CreativeThumb
                      src={c.thumbnailUrl}
                      name={c.name}
                      lang={lang}
                      compact
                      className="h-10 w-10 rounded-[12px]"
                    />
                    {/* The row is clickable for mouse users; this button is
                        the keyboard/screen-reader way in (it bubbles to the row). */}
                    <button
                      type="button"
                      className="min-w-0 truncate rounded-sm text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={c.name}
                    >
                      {c.name}
                    </button>
                  </div>
                </td>
                <td className="py-2.5 pr-3 text-right text-sm font-medium tabular-nums">
                  {formatPlnWhole(c.spend)}
                </td>
                <td className="py-2.5 pr-3 text-right text-sm tabular-nums text-ink-2">
                  {formatNumberPL(c.impressions)}
                </td>
                <td className="py-2.5 pr-3 text-right text-sm tabular-nums text-ink-2">
                  {formatNumberPL(c.clicks)}
                </td>
                <td className="py-2.5 pr-3 text-right text-sm tabular-nums text-ink-2">
                  {c.ctr != null ? formatPercent(c.ctr) : "-"}
                </td>
                <td className="py-2.5 pr-3 text-right text-sm tabular-nums text-ink-2">
                  {c.cpc != null ? formatMoneyPLN(Math.round(c.cpc)) : "-"}
                </td>
                <td className="py-2.5 pr-3 text-right text-sm tabular-nums text-ink-2">
                  {(() => {
                    const f = frequencyOf(c);
                    return f != null
                      ? f.toLocaleString(en ? "en-GB" : "pl-PL", { maximumFractionDigits: 1 })
                      : "-";
                  })()}
                </td>
                <td className="py-2.5 text-right text-sm tabular-nums text-ink-2">
                  {(() => {
                    const h = videoRatesOf(c)?.hook;
                    return h != null ? formatPercent(h * 100, 0) : "-";
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <CreativeModal c={selected} onClose={() => setSelected(null)} en={en} bench={bench} />
      ) : null}
    </section>
  );
}
