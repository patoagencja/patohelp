"use client";

import { useCallback, useMemo, useState } from "react";
import { LayoutGrid, Table2, Trophy } from "lucide-react";

import { CreativeModal, CreativesTable } from "@/components/dashboard/creatives-table";
import { GalleryCard } from "@/components/dashboard/creatives/gallery-card";
import { CreativesPodium, PodiumFootnote } from "@/components/dashboard/creatives/podium";
import {
  computeBenchmarks,
  pickPodium,
  scoreCreative,
  sortCreatives,
  type CreativeItem,
  type GallerySort,
  type Lang,
} from "@/lib/dashboard/creatives";
import { cn, formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

// Enough to fill a few rows on desktop without rendering 300 images at once.
const PAGE = 24;

type View = "gallery" | "table";

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: typeof Trophy }>;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex max-w-full rounded-lg bg-muted p-1">
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:px-3",
              value === o.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The whole "Kreacje" experience: podium of winners, then a gallery of every
 * ad compared against the client's own average, with the dense table one
 * toggle away for agency users. Fed from Supabase (or demo data) by the page.
 */
export function CreativesExplorer({
  creatives,
  lang = "pl",
}: {
  creatives: CreativeItem[];
  lang?: Lang;
}) {
  const en = lang === "en";
  const [view, setView] = useState<View>("gallery");
  const [sort, setSort] = useState<GallerySort>("best");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<CreativeItem | null>(null);

  const bench = useMemo(() => computeBenchmarks(creatives), [creatives]);
  const podium = useMemo(() => pickPodium(creatives), [creatives]);
  const scores = useMemo(
    () => new Map(creatives.map((c) => [c.adId, scoreCreative(c, bench)])),
    [creatives, bench]
  );
  const sorted = useMemo(
    () => sortCreatives(creatives, sort, bench),
    [creatives, sort, bench]
  );

  const counts = useMemo(() => {
    let better = 0;
    let worse = 0;
    scores.forEach((s) => {
      if (s.verdict === "better") better += 1;
      if (s.verdict === "worse") worse += 1;
    });
    return { better, worse };
  }, [scores]);

  const close = useCallback(() => setSelected(null), []);

  return (
    <div className="min-w-0 space-y-8">
      {/* Podium */}
      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Trophy className="h-4 w-4 text-amber-500" aria-hidden />
            {en ? "Best ads" : "Najlepsze reklamy"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {en
              ? "The winners of this period, and what they do better than the rest."
              : "Zwycięzcy tego okresu - i w czym są lepsze od pozostałych."}
          </p>
        </div>
        <CreativesPodium entries={podium} bench={bench} lang={lang} onSelect={setSelected} />
        {podium.length > 0 ? <PodiumFootnote lang={lang} /> : null}
      </section>

      {/* All creatives */}
      <section className="min-w-0 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {en ? "All ads" : "Wszystkie reklamy"}{" "}
              <span className="font-normal text-muted-foreground">({creatives.length})</span>
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {en
                ? `${counts.better} above and ${counts.worse} below your average. Click an ad to see it bigger.`
                : `${counts.better} lepiej i ${counts.worse} słabiej niż Twoja średnia. Kliknij reklamę, by ją powiększyć.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {view === "gallery" ? (
              <Segmented<GallerySort>
                label={en ? "Sort" : "Sortowanie"}
                value={sort}
                onChange={(v) => {
                  setSort(v);
                  setLimit(PAGE);
                }}
                options={[
                  { value: "best", label: en ? "Best" : "Najlepsze" },
                  { value: "spend", label: en ? "Most spent" : "Najwięcej wydane" },
                  { value: "newest", label: en ? "Newest" : "Najnowsze" },
                ]}
              />
            ) : null}
            <Segmented<View>
              label={en ? "View" : "Widok"}
              value={view}
              onChange={setView}
              options={[
                { value: "gallery", label: en ? "Gallery" : "Galeria", icon: LayoutGrid },
                { value: "table", label: en ? "Table" : "Tabela", icon: Table2 },
              ]}
            />
          </div>
        </div>

        {/* The yardstick every "better/worse" chip is measured against. */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {en ? "Your average:" : "Twoja średnia:"}
          </span>
          <span>
            {en ? "click rate" : "klikalność"}{" "}
            <span className="tabular-nums font-semibold text-foreground">
              {bench.ctr != null ? formatPercent(bench.ctr, 1) : "-"}
            </span>{" "}
            {en ? "(clicks per 100 views)" : "(kliknięcia na 100 wyświetleń)"}
          </span>
          <span>
            {en ? "cost per click" : "koszt kliknięcia"}{" "}
            <span className="tabular-nums font-semibold text-foreground">
              {bench.cpc != null ? formatMoneyPLN(Math.round(bench.cpc)) : "-"}
            </span>
          </span>
          <span>
            {en ? "views" : "wyświetlenia"}{" "}
            <span className="tabular-nums font-semibold text-foreground">
              {formatNumberPL(bench.totalImpressions)}
            </span>
          </span>
        </div>

        {view === "table" ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <CreativesTable creatives={creatives} lang={lang} embedded />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">
              {sorted.slice(0, limit).map((c) => (
                <GalleryCard
                  key={c.adId}
                  c={c}
                  score={scores.get(c.adId) ?? scoreCreative(c, bench)}
                  lang={lang}
                  onSelect={setSelected}
                />
              ))}
            </div>
            {sorted.length > limit ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + PAGE)}
                  className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
                >
                  {en
                    ? `Show more (${sorted.length - limit} left)`
                    : `Pokaż więcej (jeszcze ${sorted.length - limit})`}
                </button>
              </div>
            ) : null}
            {sort === "newest" ? (
              <p className="text-xs text-muted-foreground">
                {en
                  ? "Newest = most recently created ads first."
                  : "Najnowsze = najpóźniej utworzone reklamy na początku."}
              </p>
            ) : null}
          </>
        )}
      </section>

      {selected ? (
        <CreativeModal
          c={selected}
          onClose={close}
          en={en}
          score={scores.get(selected.adId)}
        />
      ) : null}
    </div>
  );
}
