"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { Check, GitCompareArrows, Scale, Search, SearchX, Trophy, X } from "lucide-react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Input } from "@/components/ui/input";
import { SegmentedTrack, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { LEADER_MIN_PROB } from "@/lib/ab/stats";
import type { AbAd, AbDay, AbSeries, AbSeriesLoader, AbTest, AbVerdictKind } from "@/lib/ab/types";
import { plPlural } from "@/lib/dashboard/story";
import { marketLabel } from "@/lib/season/markets";
import { cn } from "@/lib/utils";

import { AbCompare } from "./ab-compare";
import {
  VERDICT,
  adsWord,
  ageText,
  fmtCount,
  fmtCpa,
  fmtMoney,
  fmtProb,
  fmtProbText,
  fmtRate,
  fmtRoas,
  formatOf,
} from "./ab-meta";
import { KindChip } from "./kind-chip";

/** Ad sets open on arrival; the rest wait behind one button. */
const SHOWN_SETS = 4;
const MAX_COMPARE = 4;
/** "Tylko z oceną": the verdicts that ask for a move. */
const CALLED: ReadonlySet<AbVerdictKind> = new Set(["winner", "loser", "fatigue"]);

const H2 = "mt-2 text-[22px] font-medium tracking-[-0.03em] text-foreground";

const COUNT_WORD = ["", "Jedna", "Dwie", "Trzy", "Cztery"];

/**
 * Winners beat the REST of their set; the leader is the single BEST ad. Two
 * winners close to each other both beat the rest but neither leads - say so,
 * or "Wygrywa" next to "jeszcze bez lidera" reads as a contradiction.
 */
function winnersText(winners: AbAd[]): string {
  const n = winners.length;
  if (n === 1) {
    return `„${winners[0].adName}” wyraźnie wygrywa z resztą zestawu, ale nie ma jeszcze ${fmtProb(LEADER_MIN_PROB)} szans, że to najlepsza reklama.`;
  }
  return `${COUNT_WORD[n] ?? n} ${adsWord(n)} wyraźnie ${plPlural(n, "wygrywa", "wygrywają", "wygrywa")} z resztą, ale żadna jeszcze nie odskoczyła od ${n === 2 ? "drugiej" : "pozostałych"}.`;
}

// One grid for the column header and every row on wide screens (xl): check,
// thumb, ad, spend, purchases, cost per purchase, return, click rate, chance.
const XL_COLS =
  "xl:grid-cols-[2.75rem_4rem_minmax(14rem,1.7fr)_minmax(8rem,1fr)_4.5rem_6.25rem_4.25rem_5.25rem_minmax(9.75rem,0.9fr)]";

// Case- and accent-insensitive, so "mikolaj" finds "Mikołaja".
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l");
}

function Meter({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <span aria-hidden className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-chip">
      <span
        className={cn("block h-full rounded-full", strong ? "bg-[hsl(var(--lime-line))]" : "share-fill")}
        style={{ width: `${Math.max(2, Math.min(1, value) * 100)}%` }}
      />
    </span>
  );
}

/** One labelled figure: the label shows above it until the xl table header takes over. */
function Cell({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 xl:text-right", className)}>
      <p className="text-[11.5px] leading-tight text-ink-3 xl:sr-only">{label}</p>
      <div className="mt-0.5 text-[15px] font-medium tabular-nums tracking-[-0.01em] xl:mt-0">{children}</div>
    </div>
  );
}

const AdRow = memo(function AdRow({
  ad,
  today,
  leader,
  selected,
  disabled,
  flash,
  onToggle,
}: {
  ad: AbAd;
  today: string;
  leader: boolean;
  selected: boolean;
  disabled: boolean;
  flash: boolean;
  onToggle: (adId: string) => void;
}) {
  const v = VERDICT[ad.verdict.kind];
  const paused = ad.status != null && ad.status !== "ACTIVE";
  const age = ageText(ad, today);
  const preview = ad.verdict.kind === "preview";
  // A too-early ad's (or a partial day's) purchase figures are noise: greyed.
  const early = ad.verdict.kind === "too_early" || preview;
  return (
    <li
      id={`ad-${ad.adId}`}
      tabIndex={-1}
      className={cn(
        "grid scroll-mt-28 grid-cols-[2.75rem_3.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 rounded-[22px] px-1.5 py-3.5 outline-none transition-[background-color,box-shadow] duration-300 sm:px-2 xl:items-center xl:gap-x-4",
        XL_COLS,
        leader && "bg-lime-soft/60 dark:bg-lime-soft/45",
        selected && "shadow-[inset_0_0_0_1.5px_hsl(var(--anchor)/0.5)]",
        flash && "shadow-lime-ring"
      )}
    >
      <label
        className={cn(
          // invisible, not hidden, in print: the row grid keeps its first
          // column, or every cell would slide one column to the left.
          "grid h-11 w-11 place-items-center rounded-full transition-colors print:invisible",
          disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-chip"
        )}
        title={disabled ? "Porównasz najwyżej 4 reklamy naraz" : undefined}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          checked={selected}
          disabled={disabled}
          onChange={() => onToggle(ad.adId)}
          aria-label={`Porównaj: ${ad.adName} (${ad.adsetName})`}
        />
        <span
          aria-hidden
          className={cn(
            "grid h-5 w-5 place-items-center rounded-[7px] border-[1.5px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
            selected ? "border-anchor bg-anchor text-anchor-foreground" : "border-[color:var(--ink-3)]",
            disabled && "opacity-40"
          )}
        >
          {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
        </span>
      </label>

      <CreativeThumb
        src={ad.thumbnailUrl}
        name={ad.adName}
        format={formatOf(ad)}
        compact
        className="h-14 w-14 rounded-[14px] xl:h-16 xl:w-16 xl:rounded-[16px]"
      />

      <div className="min-w-0">
        <p className="line-clamp-2 break-words text-[15px] font-medium leading-snug tracking-[-0.01em] text-foreground">
          {ad.adName}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <KindChip meta={v} size="sm" />
          {leader ? (
            <span className="inline-flex min-h-6 items-center gap-1 rounded-full bg-anchor px-2.5 py-0.5 text-[12px] font-semibold text-anchor-foreground">
              <Trophy className="h-3 w-3" strokeWidth={2.4} aria-hidden />
              Prowadzi
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3">
            <span aria-hidden className={cn("ping ping-still h-[7px] w-[7px]", paused ? "ping-muted" : "ping-lime")} />
            {paused ? "wstrzymana" : "aktywna"}
            {age ? <span className="text-ink-3">· {age}</span> : null}
          </span>
        </div>
        {/* The preview says the same for every ad: the banner above says it once. */}
        {preview ? null : <p className="mt-1.5 text-[13px] leading-snug text-ink-2">{ad.verdict.text}</p>}
      </div>

      {/* Phones and tablets: the figures as a labelled grid under the ad;
          xl: `contents` makes each figure a column of the row's grid. */}
      <div className="col-span-3 grid grid-cols-3 gap-x-3 gap-y-3 rounded-[16px] bg-chip p-3 sm:grid-cols-6 xl:contents">
        <Cell label="Wydatki" className="col-span-1">
          {fmtMoney(ad.totals.spend)}
          <span className="mt-1.5 flex xl:justify-end">
            <Meter value={ad.spendShare} />
          </span>
          <span className="mt-1 block text-[11.5px] font-normal leading-tight text-ink-3">
            {Math.round(ad.spendShare * 100)}% budżetu zestawu
          </span>
        </Cell>
        <Cell label="Zakupy">{fmtCount(ad.totals.purchases)}</Cell>
        <Cell label="Koszt zakupu">
          <span className={cn(early && "text-ink-3")}>{fmtCpa(ad.rates.cpa)}</span>
        </Cell>
        <Cell label="Zwrot z reklam">
          <span className={cn(early && "text-ink-3")}>{fmtRoas(ad.rates.roas)}</span>
        </Cell>
        <Cell label="Klikalność">{fmtRate(ad.rates.ctr)}</Cell>
        {/* Full width on phones: the long label would wrap in a third of
            the row and push its figure below the others. */}
        <Cell label="Szansa, że najlepsza" className="col-span-3 sm:col-span-1">
          {ad.probBest == null ? (
            <span className="text-[13px] font-normal text-ink-3">
              {preview ? "po pełnym dniu" : early ? "za mało danych" : "-"}
            </span>
          ) : (
            <span className="flex items-center gap-2 xl:justify-end">
              <span className="w-10 shrink-0 text-left xl:order-2 xl:text-right">{fmtProb(ad.probBest)}</span>
              <Meter value={ad.probBest} strong={leader} />
            </span>
          )}
        </Cell>
      </div>
    </li>
  );
});

const TestCard = memo(function TestCard({
  test,
  ads,
  today,
  monitor,
  selectedKey,
  full,
  flashId,
  onToggle,
  index,
}: {
  test: AbTest;
  /** The ads that pass the filters (all of them when none is on). */
  ads: AbAd[];
  today: string;
  monitor: boolean;
  /** Comma-joined ids of this card's selected ads (cheap memo key). */
  selectedKey: string;
  full: boolean;
  flashId: string | null;
  onToggle: (adId: string) => void;
  index: number;
}) {
  const selected = useMemo(() => new Set(selectedKey ? selectedKey.split(",") : []), [selectedKey]);
  const leader = test.leaderAdId ? test.ads.find((a) => a.adId === test.leaderAdId) ?? null : null;
  const winners = test.ads.filter((a) => a.verdict.kind === "winner");
  const headingId = `test-${test.adsetId}-name`;
  const hidden = test.ads.length - ads.length;
  return (
    <article
      id={`test-${test.adsetId}`}
      aria-labelledby={headingId}
      className="glass min-w-0 rounded-card p-3.5 animate-rise sm:p-6"
      style={{ "--d": `${Math.min(index, 4) * 0.06}s` } as CSSProperties}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-1.5 sm:px-0">
        <div className="flex min-w-0 items-start gap-3">
          {test.market ? (
            <span
              title={marketLabel(test.market)}
              className="grid h-9 w-11 shrink-0 place-items-center rounded-[12px] bg-chip font-mono text-[12px] font-medium tracking-[0.06em]"
            >
              <span aria-hidden>{test.market}</span>
              <span className="sr-only">{marketLabel(test.market)}</span>
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 id={headingId} className="break-words text-[17px] font-medium leading-snug tracking-[-0.015em]">
              {test.adsetName}
            </h3>
            <p className="mt-0.5 break-words text-[13px] text-ink-3">
              {test.campaignName} · {test.ads.length} {adsWord(test.ads.length)}
              {hidden > 0 ? ` (pokazane ${ads.length})` : ""}
            </p>
          </div>
        </div>
        <dl className="flex gap-5 sm:gap-6 sm:text-right">
          <div>
            <dt className="text-[11.5px] text-ink-3">Wydatki</dt>
            <dd className="text-[17px] font-medium tabular-nums tracking-[-0.01em]">{fmtMoney(test.totals.spend)}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-3">Zwrot z reklam</dt>
            <dd className="text-[17px] font-medium tabular-nums tracking-[-0.01em]">{fmtRoas(test.rates.roas)}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-3">Koszt zakupu</dt>
            <dd className="text-[17px] font-medium tabular-nums tracking-[-0.01em]">{fmtCpa(test.rates.cpa)}</dd>
          </div>
        </dl>
      </header>

      <p className="mx-1.5 mt-4 flex items-start gap-2 rounded-[18px] bg-chip px-3.5 py-2.5 text-[13.5px] leading-snug text-ink-2 sm:mx-0">
        {monitor ? (
          <>
            <Scale className="mt-px h-4 w-4 shrink-0" aria-hidden />
            <span>Dziś tylko podgląd - kto prowadzi, liczymy na pełnych dniach.</span>
          </>
        ) : leader ? (
          <>
            <Trophy className="mt-px h-4 w-4 shrink-0 text-positive" aria-hidden />
            <span>
              Prowadzi <b className="font-semibold text-foreground">„{leader.adName}”</b> -{" "}
              {fmtProbText(leader.probBest)} szans, że to najlepsza reklama w tym zestawie.
            </span>
          </>
        ) : winners.length > 0 ? (
          <>
            <Trophy className="mt-px h-4 w-4 shrink-0" aria-hidden />
            <span>{winnersText(winners)}</span>
          </>
        ) : test.ads.length < 2 ? (
          <>
            <Scale className="mt-px h-4 w-4 shrink-0" aria-hidden />
            <span>Jedna reklama w zestawie - nie ma czego porównać. Dodaj drugą wersję, żeby zacząć test.</span>
          </>
        ) : (
          <>
            <Scale className="mt-px h-4 w-4 shrink-0" aria-hidden />
            <span>Jeszcze bez lidera - żadna reklama nie ma {fmtProb(LEADER_MIN_PROB)} szans, że jest najlepsza.</span>
          </>
        )}
      </p>

      <div
        aria-hidden
        className={cn(
          "kick mt-4 hidden gap-x-4 px-2 pb-1 text-[10.5px] tracking-[0.1em] xl:grid",
          XL_COLS
        )}
      >
        <span className="col-span-3 pl-[4.5rem]">Reklama</span>
        <span className="text-right">Wydatki</span>
        <span className="text-right">Zakupy</span>
        <span className="text-right">Koszt zakupu</span>
        <span className="text-right">Zwrot</span>
        <span className="text-right">Klikalność</span>
        <span className="text-right">Szansa, że najlepsza</span>
      </div>

      <ul className="mt-2 space-y-1 xl:mt-0">
        {ads.map((ad) => (
          <AdRow
            key={ad.adId}
            ad={ad}
            today={today}
            leader={ad.adId === test.leaderAdId}
            selected={selected.has(ad.adId)}
            disabled={full && !selected.has(ad.adId)}
            flash={flashId === ad.adId}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </article>
  );
});

/**
 * The tests themselves: one card per ad set (biggest spend first), its ads
 * as rows with the verdict, and a checkbox on each to compare 2-4 ads side
 * by side. Filters (market, "tylko z oceną", search) and the compare
 * selection are client state; the period is the page's (URL).
 */
export function AbTestsExplorer({
  tests,
  windowLabel,
  today,
  range,
  monitor,
  loadSeries,
}: {
  tests: AbTest[];
  windowLabel: string;
  /** Warsaw today (yyyy-MM-dd), for "od 12 dni". */
  today: string;
  /** The period's days, which the compare chart asks for. */
  range: { start: string; end: string };
  /** "Dziś" preview: no verdicts to filter on, no leaders. */
  monitor: boolean;
  loadSeries: AbSeriesLoader;
}) {
  const [market, setMarket] = useState<string | null>(null);
  const [calledOnly, setCalledOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const q = norm(useDeferredValue(query).trim());

  const adById = useMemo(() => {
    const m = new Map<string, AbAd>();
    tests.forEach((t) => t.ads.forEach((a) => m.set(a.adId, a)));
    return m;
  }, [tests]);

  // A new period can drop ads that were selected (no spend in it).
  useEffect(() => {
    setSelected((prev) => {
      const next = prev.filter((id) => adById.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [adById]);

  const markets = useMemo(() => {
    const seen: string[] = [];
    tests.forEach((t) => {
      if (t.market && !seen.includes(t.market)) seen.push(t.market);
    });
    return seen;
  }, [tests]);

  const calledCount = useMemo(
    () => tests.reduce((n, t) => n + t.ads.filter((a) => CALLED.has(a.verdict.kind)).length, 0),
    [tests]
  );

  const filtered = useMemo(() => {
    const out: Array<{ test: AbTest; ads: AbAd[] }> = [];
    for (const test of tests) {
      if (market && test.market !== market) continue;
      const setHit = q !== "" && norm(`${test.adsetName} ${test.campaignName}`).includes(q);
      const ads = test.ads.filter(
        (a) => (!calledOnly || CALLED.has(a.verdict.kind)) && (q === "" || setHit || norm(a.adName).includes(q))
      );
      if (ads.length > 0) out.push({ test, ads });
    }
    return out;
  }, [tests, market, calledOnly, q]);

  const filtering = market !== null || calledOnly || q !== "";
  // A search is an explicit ask: show every match.
  const visible = showAll || q !== "" ? filtered : filtered.slice(0, SHOWN_SETS);
  const rest = filtered.length - visible.length;
  const shownAds = filtered.reduce((n, f) => n + f.ads.length, 0);

  // Day-by-day series per ad for this period, kept while the page lives:
  // re-opening the panel or removing an ad doesn't ask the server again.
  const { start, end } = range;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new period or loader starts a new cache
  const seriesCache = useMemo(() => new Map<string, AbDay[]>(), [start, end, loadSeries]);
  const getSeries = useCallback(
    async (adIds: string[]): Promise<AbSeries[] | null> => {
      // One day has no line to draw (the chart says so): no round trip.
      if (start === end) return adIds.map((adId) => ({ adId, days: [] }));
      const missing = adIds.filter((id) => !seriesCache.has(id));
      if (missing.length > 0) {
        const got = await loadSeries({ adIds: missing, start, end });
        for (const s of got) seriesCache.set(s.adId, s.days);
      }
      // An ad the server didn't return (no access, gone): no chart rather than a flat zero line.
      if (adIds.some((id) => !seriesCache.has(id))) return null;
      return adIds.map((adId) => ({ adId, days: seriesCache.get(adId)! }));
    },
    [seriesCache, loadSeries, start, end]
  );

  const toggle = useCallback((adId: string) => {
    setSelected((prev) =>
      prev.includes(adId)
        ? prev.filter((id) => id !== adId)
        : prev.length >= MAX_COMPARE
          ? prev
          : [...prev, adId]
    );
  }, []);
  const clearFilters = () => {
    setMarket(null);
    setCalledOnly(false);
    setQuery("");
  };

  // "Do decyzji dziś" rows link to #ad-<id>: open the ad's set (and drop
  // filters hiding it), then bring the row into view and light it up. A
  // click handler rather than hashchange alone, so a second click on the
  // same row still works.
  useEffect(() => {
    const reveal = (adId: string) => {
      const owner = tests.findIndex((t) => t.ads.some((a) => a.adId === adId));
      if (owner < 0) return false;
      setMarket(null);
      setCalledOnly(false);
      setQuery("");
      if (owner >= SHOWN_SETS) setShowAll(true);
      setFlashId(adId);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Two frames: the expanded set has to render before we can scroll.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.getElementById(`ad-${adId}`);
          el?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
          el?.focus({ preventScroll: true });
        })
      );
      return true;
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href^="#ad-"]');
      if (!a) return;
      const id = decodeURIComponent(a.getAttribute("href")!.slice(4));
      if (reveal(id)) {
        e.preventDefault();
        history.replaceState(null, "", `#ad-${encodeURIComponent(id)}`);
      }
    };
    const m = /^#ad-(.+)$/.exec(window.location.hash);
    if (m) reveal(decodeURIComponent(m[1]));
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [tests]);

  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), 2600);
    return () => window.clearTimeout(t);
  }, [flashId]);

  const selectedAds = selected.map((id) => adById.get(id)).filter((a): a is AbAd => Boolean(a));
  const full = selected.length >= MAX_COMPARE;
  const closeCompare = useCallback(() => setComparing(false), []);
  const removeFromCompare = useCallback((adId: string) => {
    setSelected((prev) => prev.filter((id) => id !== adId));
  }, []);
  // Removing down to one ad closes the panel for good (it must not pop
  // back open when a second ad is ticked later).
  useEffect(() => {
    if (selectedAds.length < 2) setComparing(false);
  }, [selectedAds.length]);

  return (
    <section aria-labelledby="ab-tests-heading" className="min-w-0 space-y-5">
      <div className="px-1">
        <p className="kick">Testy · {windowLabel.toLowerCase()}</p>
        <h2 id="ab-tests-heading" className={H2}>
          Zestawy reklam <span className="font-light tabular-nums text-ink-3">({tests.length})</span>
        </h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-3">
          Każdy zestaw to osobny test: jego reklamy walczą o tych samych ludzi i ten sam budżet. Zaznacz
          2-4 reklamy, żeby porównać je obok siebie.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-print-hide>
        {markets.length > 1 ? (
          <SegmentedTrack role="group" aria-label="Rynek" className={cn(segmentedTrack, "min-w-0")}>
            <button
              type="button"
              aria-pressed={market === null}
              onClick={() => setMarket(null)}
              className={segmentedItem(market === null, "min-h-11 px-3.5")}
            >
              Wszystkie rynki
            </button>
            {markets.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={market === m}
                title={marketLabel(m)}
                onClick={() => setMarket((cur) => (cur === m ? null : m))}
                className={segmentedItem(market === m, "min-h-11 px-3 font-mono text-[13px] tracking-[0.04em]")}
              >
                <span aria-hidden>{m}</span>
                <span className="sr-only">{marketLabel(m)}</span>
              </button>
            ))}
          </SegmentedTrack>
        ) : null}

        {/* The preview has no verdicts to filter on. */}
        {monitor ? null : (
          <button
            type="button"
            aria-pressed={calledOnly}
            onClick={() => setCalledOnly((v) => !v)}
            title="Reklamy, które wygrywają, przegrywają albo się męczą"
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              calledOnly
                ? "bg-anchor text-anchor-foreground"
                : "bg-chip text-ink-2 hover:bg-[var(--chip-hover)] hover:text-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid h-4 w-4 place-items-center rounded-[5px] border-[1.5px]",
                calledOnly ? "border-anchor-foreground/70" : "border-[color:var(--ink-3)]"
              )}
            >
              {calledOnly ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </span>
            Tylko z oceną
            <span className={cn("tabular-nums", calledOnly ? "opacity-70" : "text-ink-3")}>· {calledCount}</span>
          </button>
        )}

        <div className="relative min-w-[13rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj reklamy lub zestawu"
            aria-label="Szukaj reklamy lub zestawu"
            autoComplete="off"
            className="rounded-full bg-chip pl-10 pr-12 hover:bg-[var(--chip-hover)] [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Wyczyść wyszukiwanie"
              className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-chip hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {filtering ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[13.5px] text-ink-3" aria-live="polite" data-print-hide>
          <span>
            {/* After "z" the genitive: "z 1 zestawu", "z 2 zestawów", never "z 2 zestawy". */}
            {plPlural(filtered.length, "Pasuje", "Pasują", "Pasuje")} {filtered.length} z {tests.length}{" "}
            {tests.length === 1 ? "zestawu" : "zestawów"} · {shownAds} {adsWord(shownAds)}
          </span>
          <button
            type="button"
            onClick={clearFilters}
            className="font-medium text-foreground underline decoration-[var(--ink-3)] underline-offset-4 hover:decoration-foreground"
          >
            Wyczyść filtry
          </button>
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nic nie pasuje do filtrów"
          description="Zmień rynek, wyłącz „Tylko z oceną” albo wpisz inną nazwę."
          action={
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-11 items-center rounded-full bg-anchor px-5 text-sm font-medium text-anchor-foreground"
            >
              Wyczyść filtry
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {visible.map(({ test, ads }, i) => (
            <TestCard
              key={test.adsetId}
              test={test}
              ads={ads}
              today={today}
              monitor={monitor}
              index={i}
              selectedKey={ads
                .filter((a) => selected.includes(a.adId))
                .map((a) => a.adId)
                .join(",")}
              full={full}
              flashId={flashId && ads.some((a) => a.adId === flashId) ? flashId : null}
              onToggle={toggle}
            />
          ))}
        </div>
      )}

      {rest > 0 || (showAll && filtered.length > SHOWN_SETS && q === "") ? (
        <div className="flex justify-center" data-print-hide>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            className="inline-flex min-h-11 items-center rounded-full bg-chip px-[18px] text-sm font-medium text-foreground transition-[background-color,transform] duration-200 hover:bg-[var(--chip-hover)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:active:scale-100"
          >
            {rest > 0 ? `Pokaż kolejne zestawy (${rest})` : "Pokaż mniej zestawów"}
          </button>
        </div>
      ) : null}

      {selectedAds.length > 0 ? (
        <div
          role="region"
          aria-label="Porównanie reklam"
          data-print-hide
          className="pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-40 !mt-0 flex justify-center px-3.5 md:bottom-6 print:hidden"
        >
          <div className="glass glass-blur pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-full bg-[var(--tip)] bg-none p-1.5 pl-2 shadow-raised animate-rise [--d:0s]">
            {/* Phones: no thumbnails, so the count isn't cut to "Wyb…". */}
            <div className="hidden shrink-0 -space-x-2.5 sm:flex" aria-hidden>
              {selectedAds.map((a) => (
                <CreativeThumb
                  key={a.adId}
                  src={a.thumbnailUrl}
                  name={a.adName}
                  format={formatOf(a)}
                  compact
                  className="h-9 w-9 rounded-full ring-2 ring-background"
                />
              ))}
            </div>
            <p className="min-w-0 flex-1 truncate pl-2 text-[13.5px] text-ink-2 sm:pl-1" aria-live="polite">
              <span className="sm:hidden">
                {selectedAds.length} z {MAX_COMPARE}
              </span>
              <span className="hidden sm:inline">
                {selectedAds.length < 2
                  ? "Zaznacz jeszcze 1 reklamę"
                  : `Wybrane ${selectedAds.length} z ${MAX_COMPARE}`}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-chip hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Wyczyść
            </button>
            <button
              type="button"
              disabled={selectedAds.length < 2}
              onClick={() => setComparing(true)}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-anchor px-4 text-sm font-semibold text-anchor-foreground shadow-card transition-[opacity,transform] duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anchor-dot motion-reduce:active:scale-100 sm:px-5"
            >
              <GitCompareArrows className="h-4 w-4" aria-hidden />
              Porównaj ({selectedAds.length})
            </button>
          </div>
        </div>
      ) : null}

      {comparing && selectedAds.length >= 2 ? (
        <AbCompare
          ads={selectedAds}
          windowLabel={windowLabel}
          getSeries={getSeries}
          onClose={closeCompare}
          onRemove={removeFromCompare}
        />
      ) : null}
    </section>
  );
}
