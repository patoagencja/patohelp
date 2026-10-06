"use client";

import { useCallback, useMemo, useState } from "react";
import { LayoutGrid, Table2 } from "lucide-react";

import { CreativeModal, CreativesTable } from "@/components/dashboard/creatives-table";
import { GalleryCard } from "@/components/dashboard/creatives/gallery-card";
import { RefreshList } from "@/components/dashboard/creatives/insight-bits";
import { CreativesPodium, PodiumFootnote } from "@/components/dashboard/creatives/podium";
import { DetailsDisclosure } from "@/components/dashboard/details-disclosure";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import {
  computeBenchmarks,
  fatigueOf,
  pickPodium,
  scoreCreative,
  sortCreatives,
  type CreativeItem,
  type Fatigue,
  type GallerySort,
  type Lang,
} from "@/lib/dashboard/creatives";
import { formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

// Enough to fill a few rows on desktop without rendering 300 images at once.
const PAGE = 24;
// Visible gallery under the podium: two rows of three on desktop.
const TOP_GALLERY = 6;

type View = "gallery" | "table";

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: typeof Table2 }>;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className={segmentedTrack}>
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={segmentedItem(value === o.value, "px-2.5 sm:px-3")}
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
 * The whole "Kreacje" experience, simplest first: the podium of winners and
 * the next six biggest spenders on screen; the full gallery (sort, table
 * view), ads worth refreshing and the averages behind every "better/worse"
 * chip sit behind the page's one "Pokaż szczegóły". Fed from Supabase (or
 * demo data) by the page.
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

  const fatigued = useMemo(
    () =>
      creatives
        .map((c) => ({ c, fatigue: fatigueOf(c, bench) }))
        .filter((x): x is { c: CreativeItem; fatigue: Fatigue } => x.fatigue != null)
        .sort((a, b) => b.c.spend - a.c.spend),
    [creatives, bench]
  );

  // Biggest spenders that are not already on the podium, so nothing repeats.
  const topSpend = useMemo(() => {
    const onPodium = new Set(podium.map((e) => e.creative.adId));
    return [...creatives]
      .filter((c) => !onPodium.has(c.adId))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, TOP_GALLERY);
  }, [creatives, podium]);

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

  const card = (c: CreativeItem, wide = false) => (
    <GalleryCard
      wide={wide}
      key={c.adId}
      c={c}
      score={scores.get(c.adId) ?? scoreCreative(c, bench)}
      bench={bench}
      lang={lang}
      onSelect={setSelected}
    />
  );

  return (
    <>
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-section-title text-foreground">
            {en ? "Best ads" : "Najlepsze reklamy"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {en
              ? "The winners of this period, and what they do better than the rest."
              : "Zwycięzcy tego okresu - i w czym wygrywają z pozostałymi."}
          </p>
        </div>
        <CreativesPodium entries={podium} bench={bench} lang={lang} onSelect={setSelected} />
      </section>

      {topSpend.length > 0 ? (
        <section className="min-w-0 space-y-4">
          <div className="space-y-1">
            <h2 className="text-section-title text-foreground">
              {en ? "Where most of the money goes" : "Reklamy z największymi wydatkami"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {en
                ? "Each one compared with your average. Click an ad to see it bigger."
                : "Każda porównana z Twoją średnią. Kliknij reklamę, by ją powiększyć."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {topSpend.map((c) => card(c, true))}
          </div>
        </section>
      ) : null}

      <DetailsDisclosure
        storageKey="pato:details:kreacje"
        openLabel={en ? "Show all ads and details" : "Pokaż wszystkie reklamy i szczegóły"}
        closeLabel={en ? "Hide details" : "Ukryj szczegóły"}
        summary={
          en
            ? `All ${creatives.length} ads with sorting and a table view${fatigued.length ? `, ${fatigued.length} worth refreshing` : ""}, and your averages.`
            : `Wszystkie reklamy (${creatives.length}) z sortowaniem i widokiem tabeli${fatigued.length ? `, reklamy do odświeżenia (${fatigued.length})` : ""} oraz Twoje średnie.`
        }
      >
        <RefreshList items={fatigued} lang={lang} onSelect={setSelected} />

        <section className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-section-title text-foreground">
                {en ? "All ads" : "Wszystkie reklamy"}{" "}
                <span className="font-normal text-muted-foreground">({creatives.length})</span>
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {en
                  ? `${counts.better} above and ${counts.worse} below your average.`
                  : `Lepiej niż Twoja średnia: ${counts.better}, słabiej: ${counts.worse}.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2" data-print-hide>
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
                    { value: "spend", label: en ? "Most spent" : "Największe wydatki" },
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
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-2xl bg-card px-4 py-3 text-sm text-muted-foreground shadow-card sm:rounded-full sm:px-5">
            <span className="rounded-full bg-anchor px-2.5 py-0.5 text-xs font-semibold text-anchor-foreground">
              {en ? "Your average" : "Twoja średnia"}
            </span>
            <span>
              {en ? "click rate" : "klikalność"}{" "}
              <span className="tabular-nums font-semibold text-foreground">
                {bench.ctr != null ? formatPercent(bench.ctr, 1) : "-"}
              </span>
            </span>
            <span>
              {en ? "cost per click" : "koszt kliknięcia"}{" "}
              <span className="tabular-nums font-semibold text-foreground">
                {bench.cpc != null ? formatMoneyPLN(Math.round(bench.cpc)) : "-"}
              </span>
            </span>
            {bench.hookRate != null ? (
              <span>
                {en ? "videos watched 3s+" : "filmy oglądane dłużej niż 3 s"}{" "}
                <span className="tabular-nums font-semibold text-foreground">
                  {formatPercent(bench.hookRate * 100, 0)}
                </span>
              </span>
            ) : null}
            <span>
              {en ? "views" : "wyświetlenia"}{" "}
              <span className="tabular-nums font-semibold text-foreground">
                {formatNumberPL(bench.totalImpressions)}
              </span>
            </span>
          </div>

          {view === "table" ? (
            <div className="surface p-4 sm:p-5">
              <CreativesTable creatives={creatives} lang={lang} embedded />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                {sorted.slice(0, limit).map((c) => card(c))}
              </div>
              {sorted.length > limit ? (
                <div className="flex justify-center" data-print-hide>
                  <button
                    type="button"
                    onClick={() => setLimit((l) => l + PAGE)}
                    className="rounded-full bg-card px-5 py-2 text-sm font-medium text-foreground shadow-card transition-colors hover:bg-anchor hover:text-anchor-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

        {podium.length > 0 ? <PodiumFootnote lang={lang} entries={podium} /> : null}
      </DetailsDisclosure>

      {selected ? (
        <CreativeModal
          c={selected}
          onClose={close}
          en={en}
          score={scores.get(selected.adId)}
          bench={bench}
        />
      ) : null}
    </>
  );
}
