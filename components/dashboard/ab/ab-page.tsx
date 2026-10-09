import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Clock, Eye, FlaskConical, Info, WalletCards } from "lucide-react";

import { AdsPageHeader } from "@/components/dashboard/ads-page-intro";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Pill } from "@/components/ui/pill";
import {
  addDaysIso,
  BIG_SPENDER_DAILY,
  FATIGUE_BEFORE_DAYS,
  FATIGUE_FREQ_RISE,
  FATIGUE_HIGH_FREQUENCY,
  FATIGUE_MIN_HISTORY_DAYS,
  FATIGUE_MIN_PURCHASES,
  FATIGUE_RECENT_DAYS,
  FATIGUE_RELATIVE_RATIO,
  formatPct,
  formatZl,
  LEADER_MIN_PROB,
  LOSER_MIN_SPEND_SHARE,
  LOSER_RATE_RATIO,
  LOSER_ROAS_RATIO,
  LOSER_SIGNIFICANCE_BIG,
  MIN_CLICKS,
  MIN_DECISION_DAYS,
  MIN_PURCHASES,
  MOMENT_MARGIN_DAYS,
  SCALE_DIMINISHING,
  SCALE_STEP,
  SIGNIFICANCE,
  WINNER_LIFT_PROB,
  WINNER_MIN_LIFT,
  WINNER_ROAS_RATIO,
} from "@/lib/ab/stats";
import { AB_WINDOW_LABEL, type AbAd, type AbSeriesLoader, type AbView, type AbWindowKey } from "@/lib/ab/types";
import { plPlural } from "@/lib/dashboard/story";
import { formatDateWarsaw } from "@/lib/utils";

import { AbActions } from "./ab-actions";
import {
  AB_WINDOWS,
  ACTION,
  adsWord,
  changesWord,
  fmtCount,
  fmtEstimate,
  fmtCpa,
  fmtMoney,
  fmtRoas,
  inTests,
  purchasesWord,
} from "./ab-meta";
import { AbTestsExplorer } from "./ab-tests";
import { AbWindowLinks, type WindowLink } from "./window-links";

const WINDOW_DAYS: Partial<Record<AbWindowKey, number>> = { "3d": 3, "7d": 7, "14d": 14, "30d": 30 };

/** "1-7 paź" / "28 wrz - 7 paź" / "9 gru". */
function rangeText(start: string, end: string): string {
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  if (start === end) return formatDateWarsaw(e, "d MMM");
  return s.getUTCMonth() === e.getUTCMonth()
    ? `${formatDateWarsaw(s, "d")}-${formatDateWarsaw(e, "d MMM")}`
    : `${formatDateWarsaw(s, "d MMM")} - ${formatDateWarsaw(e, "d MMM")}`;
}

/** A period that ended before yesterday (a finished season): nothing to do today. */
const isFinished = (view: AbView) => !view.monitor && view.end < addDaysIso(view.today, -1);

/** The one sentence the owner reads first: how many proposals, and the biggest. */
function leadOf(view: AbView, ads: Record<string, AbAd>): string {
  if (view.monitor) return "Dziś tylko podgląd - propozycje liczymy na pełnych dniach.";
  if (isFinished(view)) return "Ten okres już się skończył: werdykty za cały okres, bez propozycji na dziś.";
  // Already in order: most sales at stake first, ads to watch last.
  const decisions = view.actions.filter((a) => a.kind !== "watch");
  if (decisions.length === 0) {
    const n = view.adCount;
    return `Nic pilnego - ${n} ${adsWord(n)} ${inTests(view.tests.length)} ${plPlural(n, "idzie", "idą", "idzie")} równo.`;
  }
  const top = decisions[0];
  const name = ads[top.adId]?.adName;
  const head = `Proponujemy ${decisions.length} ${changesWord(decisions.length)}`;
  if (!name) return `${head}.`;
  const money = fmtEstimate(top.impactPerDay);
  if (top.kind === "cut") {
    return `${head} - najwięcej da wyłączenie „${name}” (ok. +${money} sprzedaży dziennie, bo jej budżet przejmą lepsze reklamy).`;
  }
  if (top.kind === "scale") {
    return `${head} - najwięcej da dołożenie budżetu „${name}” (ok. +${money} sprzedaży dziennie).`;
  }
  return `${head} - najpilniej nowa wersja „${name}” (ok. ${money} sprzedaży dziennie do odzyskania).`;
}

const times = (x: number) => `${x.toLocaleString("pl-PL")}×`;

/**
 * How "Szansa" and the verdicts are worked out, in plain Polish. Every
 * threshold comes from lib/ab/stats, so the note can't drift from the rules.
 */
function AbMethod({ seasonal }: { seasonal: boolean }) {
  const b = (s: string) => <b className="font-semibold text-foreground">{s}</b>;
  return (
    <details data-print-open className="group glass min-w-0 rounded-card p-5 sm:p-6">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[16px] text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2.5">
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-[12px] bg-chip text-ink-2">
            <Info className="h-4 w-4" />
          </span>
          Jak liczymy „szansę” i werdykty
        </span>
        <ChevronDown aria-hidden className="h-4 w-4 text-ink-3 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="mt-4 max-w-3xl space-y-3 text-sm leading-relaxed text-ink-2">
        <p>
          {b("Tylko pełne dni.")} Każdy okres kończy się wczoraj. Dzisiejszy dzień jeszcze trwa, a Meta dopisuje
          zakupy do reklam z opóźnieniem (zwykle liczy zakup do 7 dni po kliknięciu i do 1 dnia po obejrzeniu
          reklamy), więc ostatnie godziny zawsze wyglądają gorzej, niż wypadną. „Dziś” to tylko podgląd - bez
          werdyktów i decyzji.
        </p>
        <p>
          {b("Z czym porównujemy.")} Jeden test to jeden zestaw reklam w Meta. Każdą reklamę porównujemy z resztą
          reklam jej zestawu - bez niej samej i tylko w dniach, w których sama się wyświetlała. Reklamy zestawu trafiają do tych samych ludzi i dzielą budżet,
          ale Meta nie dzieli ruchu po równo (chętniej pokazuje te, które wcześnie dobrze wypadły), więc to
          rozsądna reguła, a nie eksperyment naukowy.
        </p>
        <p>
          {b("Szansa.")} Liczymy, ile zakupów przypada na kliknięcia w link, i jak pewne jest, że różnica to nie
          przypadek. „Szansa, że najlepsza” porównuje reklamy zestawu, które mają co najmniej {MIN_CLICKS} kliknięć;
          reklama „prowadzi” od {formatPct(LEADER_MIN_PROB)} szans.
        </p>
        <p>
          {b("Kiedy oceniamy.")} Najwcześniej po {MIN_DECISION_DAYS} pełnych dniach emisji, {MIN_CLICKS} kliknięciach
          i {MIN_PURCHASES} zakupach - wcześniej to „Za wcześnie”. Reklamę, która mimo wielu kliknięć prawie nie
          sprzedaje, oceniamy, gdy w tempie reszty zestawu miałaby już {MIN_PURCHASES} zakupów.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            {b("Wygrywa:")} co najmniej {formatPct(SIGNIFICANCE)} szans, że sprzedaje częściej niż reszta zestawu,{" "}
            {formatPct(WINNER_LIFT_PROB)} szans, że częściej o ponad {formatPct(WINNER_MIN_LIFT)}, i zwrot co najmniej{" "}
            {times(WINNER_ROAS_RATIO)} zwrotu reszty zestawu.
          </li>
          <li>
            {b("Przegrywa:")} co najmniej {formatPct(SIGNIFICANCE)} szans, że sprzedaje rzadziej (
            {formatPct(LOSER_SIGNIFICANCE_BIG)} przy reklamach wydających ponad {formatZl(BIG_SPENDER_DAILY)}{" "}
            dziennie), zwrot najwyżej {times(LOSER_ROAS_RATIO)} zwrotu reszty zestawu i co najmniej{" "}
            {formatPct(LOSER_MIN_SPEND_SHARE)} budżetu zestawu. Gdy Meta nie zna wartości zakupów - ta sama pewność,
            że sprzedaje o ponad {formatPct(1 - LOSER_RATE_RATIO)} rzadziej.
          </li>
          <li>
            {b("Męczy się:")} zwrot z ostatnich {FATIGUE_RECENT_DAYS} pełnych dni wobec {FATIGUE_BEFORE_DAYS} dni
            wcześniej spadł do najwyżej {formatPct(FATIGUE_RELATIVE_RATIO)} tego, jak w tym czasie zmienił się zwrot
            reszty zestawu, a częstotliwość wzrosła o co najmniej {formatPct(FATIGUE_FREQ_RISE)} (albo wynosi już co
            najmniej {FATIGUE_HIGH_FREQUENCY}). Potrzeba {FATIGUE_MIN_HISTORY_DAYS} dni emisji i {FATIGUE_MIN_PURCHASES} zakupów
            w tamtym tygodniu. Nie oceniamy tego w okolicach{" "}
            {seasonal
              ? "świąt zakupowych Twojego sezonu (np. Black Friday, Cyber Monday, Mikołajki, Wigilia)"
              : "Black Friday, Mikołajek i Wigilii"}{" "}
            (±{MOMENT_MARGIN_DAYS} dzień) - po szczycie zwrot zawsze spada.
          </li>
          <li>
            {b("Na równi:")} bez wyraźnej różnicy albo z różnicą za małą, by przesuwać budżet.
          </li>
        </ul>
        <p>
          {b("Kwoty w propozycjach")} to sprzedaż dziennie. „{ACTION.cut.label}”: dzienne wydatki reklamy z
          ostatnich {FATIGUE_RECENT_DAYS} dni razy różnica zwrotu wobec reszty zestawu - po wyłączeniu Meta wyda te
          pieniądze na pozostałe reklamy, więc nic się nie „oszczędza”, ale sprzedaje się więcej. „
          {ACTION.scale.label}”: +{formatPct(SCALE_STEP)} budżetu reklamy, liczone z{" "}
          {formatPct(SCALE_DIMINISHING)} różnicy zwrotu (dodatkowy budżet sprzedaje gorzej); najwyżej jedna taka
          propozycja na zestaw. „{ACTION.refresh.label}”: sprzedaż tracona dziennie wobec tego, jak idzie reszta
          zestawu.
        </p>
        <p>
          {b("Skąd liczby.")} Zakupy i sprzedaż to dane Meta - jej własne przypisanie zakupów do reklam. Mogą się
          różnić od zamówień w sklepie.
        </p>
      </div>
    </details>
  );
}

/** "Dziś": what the preview is, and the way to the decisions. */
function PreviewNote({ href }: { href: string }) {
  return (
    <section aria-label="Podgląd dnia" className="glass min-w-0 rounded-glass p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-chip text-ink-2">
            <Eye className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[19px] font-medium leading-snug tracking-[-0.02em] text-foreground">
              Dziś tylko podgląd - propozycje liczymy na pełnych dniach
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-3">
              Dzień jeszcze trwa, a Meta dopisuje zakupy do reklam z opóźnieniem, więc dzisiejsze liczby zawsze
              wyglądają gorzej, niż wypadną. Tu widać, jak reklamy idą od rana - bez werdyktów.
            </p>
          </div>
        </div>
        <Link
          href={href}
          scroll={false}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-full bg-anchor px-5 text-sm font-medium text-anchor-foreground transition-transform duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anchor-dot motion-reduce:active:scale-100 sm:self-center"
        >
          Propozycje z 7 dni
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

/**
 * "Testy kreacji" for shops that A/B test many ads per ad set: what to do
 * today, the period's totals, every test with its verdicts, and a compare
 * panel. Shared by the client page and the demo; returns the slides as a
 * fragment so each is its own presentation slide.
 */
export function AbPageView({
  view,
  path,
  keep = {},
  seasonAllowed,
  tabs,
  loadSeries,
  kickerExtra = "",
}: {
  view: AbView;
  /** This page's path, e.g. "/dre/kreacje/testy". */
  path: string;
  /** Other query params the period links carry along (range, demo day). */
  keep?: Record<string, string>;
  /** "Cały sezon" only for clients with a season (their sales moments too). */
  seasonAllowed: boolean;
  /** The Reklamy section tabs. */
  tabs: ReactNode;
  /** The compare chart's series, read on demand (a bound server action). */
  loadSeries: AbSeriesLoader;
  kickerExtra?: string;
}) {
  const windowLabel = AB_WINDOW_LABEL[view.windowKey];
  const ads: Record<string, AbAd> = {};
  for (const t of view.tests) for (const a of t.ads) ads[a.adId] = a;

  const hrefOf = (key: AbWindowKey) => {
    const params = new URLSearchParams(keep);
    params.set("okno", key);
    return `${path}?${params.toString()}`;
  };
  const yesterday = addDaysIso(view.today, -1);
  const links: WindowLink[] = AB_WINDOWS.filter((k) => k !== "season" || seasonAllowed).map((key) => {
    const days = WINDOW_DAYS[key];
    return {
      key,
      href: hrefOf(key),
      label: AB_WINDOW_LABEL[key],
      title:
        key === view.windowKey
          ? rangeText(view.start, view.end)
          : key === "today"
            ? rangeText(view.today, view.today)
            : days
              ? rangeText(addDaysIso(view.today, -days), yesterday)
              : undefined,
    };
  });

  const stamp = view.updatedAt
    ? formatDateWarsaw(view.updatedAt, "yyyy-MM-dd") === view.today
      ? formatDateWarsaw(view.updatedAt, "HH:mm")
      : formatDateWarsaw(view.updatedAt, "d MMM, HH:mm")
    : null;

  const header = (lead: string, controls: boolean) => (
    <AdsPageHeader
      kicker={`Meta · testy kreacji · ${windowLabel.toLowerCase()} (${rangeText(view.start, view.end)})${kickerExtra}`}
      title="Testy kreacji"
      lead={lead}
      actions={
        controls ? (
          <>
            <AbWindowLinks items={links} current={view.windowKey} />
            {stamp ? (
              <Pill
                tone="neutral"
                className="min-h-11 gap-2 bg-chip px-4 text-sm text-ink-2 [&_svg]:size-4"
                title="Reklamy z Meta synchronizujemy co ok. 30 minut"
              >
                <Clock aria-hidden />
                Dane z {stamp}
              </Pill>
            ) : null}
          </>
        ) : null
      }
      tabs={tabs}
    />
  );

  if (!view.available) {
    return (
      <>
        {header("Która reklama sprzedaje lepiej, która drożej niż reszta, a która się męczy - test po teście.", false)}
        <EmptyState
          icon={FlaskConical}
          title="Testy kreacji jeszcze się nie pojawiły"
          description="Pierwsze wyniki pojawią się ok. 30 minut po włączeniu - zobaczysz tu każdą reklamę osobno."
        />
      </>
    );
  }

  if (view.tests.length === 0) {
    return (
      <>
        {header(
          view.monitor ? "Dziś reklamy jeszcze nic nie wydały." : "W tym okresie żadna reklama nie wydała pieniędzy.",
          true
        )}
        <EmptyState
          icon={WalletCards}
          title={view.monitor ? "Dziś jeszcze bez wydatków" : "Brak wydatków w tym okresie"}
          description={
            view.monitor
              ? "Zajrzyj za godzinę albo wybierz pełne dni u góry."
              : "Wybierz dłuższy okres u góry - testy pokażą się, gdy reklamy zaczną wydawać."
          }
        />
      </>
    );
  }

  const days = view.days;
  const { totals, rates } = view;

  return (
    <>
      {header(leadOf(view, ads), true)}

      <SectionBoundary name="ab/actions">
        {view.monitor ? (
          <PreviewNote href={hrefOf("7d")} />
        ) : (
          <AbActions actions={view.actions} ads={ads} finished={isFinished(view)} />
        )}
      </SectionBoundary>

      <SectionBoundary name="ab/kpis">
        <section aria-label="Wyniki reklam w okresie" className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <StatTile
            index={0}
            label="Wydatki"
            explain="Ile kosztowały wszystkie testowane reklamy Meta w wybranym okresie."
            value={fmtMoney(totals.spend)}
            spark={days.map((d) => d.spend)}
            sub={`${view.adCount} ${adsWord(view.adCount)} ${inTests(view.tests.length)}`}
          />
          <StatTile
            index={1}
            highlight
            label="Sprzedaż z reklam"
            explain="Wartość zakupów, które Meta przypisuje tym reklamom (jej własne śledzenie)."
            value={fmtMoney(totals.value)}
            spark={days.map((d) => d.value)}
            sub={`${fmtCount(totals.purchases)} ${purchasesWord(totals.purchases)}`}
          />
          <StatTile
            index={2}
            label="Zwrot z reklam"
            explain="Ile złotych sprzedaży przypada na 1 zł wydany na reklamy (ROAS)."
            value={fmtRoas(rates.roas)}
            spark={days.filter((d) => d.spend > 0).map((d) => d.value / d.spend)}
            sub={
              rates.roas != null
                ? `z 1 zł reklamy: ${rates.roas.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł sprzedaży`
                : undefined
            }
          />
          <StatTile
            index={3}
            label="Koszt zakupu"
            explain="Ile średnio kosztuje jeden zakup z reklamy (CPA): wydatki podzielone przez liczbę zakupów."
            value={fmtCpa(rates.cpa)}
            spark={days.filter((d) => d.purchases > 0).map((d) => d.spend / d.purchases)}
            sub={
              rates.cvr
                ? `zakupem kończy się co ${Math.max(1, Math.round(1 / rates.cvr))}. kliknięcie`
                : undefined
            }
          />
        </section>
      </SectionBoundary>

      <SectionBoundary name="ab/tests">
        <AbTestsExplorer
          tests={view.tests}
          windowLabel={windowLabel}
          today={view.today}
          range={{ start: view.start, end: view.end }}
          monitor={view.monitor}
          loadSeries={loadSeries}
        />
      </SectionBoundary>

      <AbMethod seasonal={seasonAllowed} />
    </>
  );
}
