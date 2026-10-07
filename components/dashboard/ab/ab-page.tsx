import type { ReactNode } from "react";
import { ChevronDown, Clock, FlaskConical, Info, WalletCards } from "lucide-react";

import { AdsPageHeader } from "@/components/dashboard/ads-page-intro";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Pill } from "@/components/ui/pill";
import { AB_WINDOW_LABEL, type AbAd, type AbView, type AbWindowKey } from "@/lib/ab/types";
import { addDaysIso } from "@/lib/season/config";
import { formatDateWarsaw } from "@/lib/utils";

import { AbActions } from "./ab-actions";
import {
  AB_WINDOWS,
  adsWord,
  fmtCount,
  fmtEstimate,
  fmtCpa,
  fmtMoney,
  fmtRoas,
  purchasesWord,
} from "./ab-meta";
import { AbTestsExplorer } from "./ab-tests";
import { AbWindowLinks, type WindowLink } from "./window-links";

const WINDOW_DAYS: Partial<Record<AbWindowKey, number>> = { today: 1, "3d": 3, "7d": 7, "14d": 14, "30d": 30 };

const inSets = (n: number) => `w ${n} ${n === 1 ? "zestawie" : "zestawach"}`;

/** "1-7 paź" / "28 wrz - 7 paź" for a window's tooltip. */
function rangeText(start: string, end: string): string {
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  if (start === end) return formatDateWarsaw(e, "d MMM");
  return s.getUTCMonth() === e.getUTCMonth()
    ? `${formatDateWarsaw(s, "d")}-${formatDateWarsaw(e, "d MMM")}`
    : `${formatDateWarsaw(s, "d MMM")} - ${formatDateWarsaw(e, "d MMM")}`;
}

/** The one sentence the owner reads first: how many calls, and the biggest. */
function leadOf(view: AbView, ads: Record<string, AbAd>): string {
  const decisions = view.actions
    .filter((a) => a.kind !== "watch")
    .sort((a, b) => b.impactPerDay - a.impactPerDay);
  if (decisions.length === 0) {
    return `Nic pilnego - ${view.adCount} ${adsWord(view.adCount)} ${inSets(view.tests.length)} idzie równo.`;
  }
  const top = decisions[0];
  const name = ads[top.adId]?.adName;
  const head = `${decisions.length} ${adsWord(decisions.length)} do decyzji dziś`;
  if (!name) return `${head}.`;
  const money = fmtEstimate(top.impactPerDay);
  if (top.kind === "cut") return `${head} - najwięcej do oszczędzenia na «${name}» (${money} dziennie).`;
  if (top.kind === "scale") return `${head} - najwięcej do zyskania na «${name}» (ok. ${money} sprzedaży dziennie).`;
  return `${head} - najpilniej do odświeżenia «${name}» (ok. ${money} sprzedaży dziennie do odzyskania).`;
}

/** Daily sums over every ad, oldest -> newest (tile sparklines). */
function dailyTotals(view: AbView) {
  const byDate = new Map<string, { spend: number; value: number; purchases: number }>();
  for (const t of view.tests)
    for (const a of t.ads)
      for (const d of a.daily) {
        const cur = byDate.get(d.date) ?? { spend: 0, value: 0, purchases: 0 };
        cur.spend += d.spend;
        cur.value += d.value;
        cur.purchases += d.purchases;
        byDate.set(d.date, cur);
      }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, v]) => v);
}

/** How "Szansa" and the verdicts are worked out, in plain Polish. */
function AbMethod() {
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
          <b className="font-semibold text-foreground">Szansa, że najlepsza.</b> Dla każdej reklamy liczymy, ile
          zakupów przypada na jej kliknięcia, i porównujemy to z resztą reklam w tym samym zestawie - one
          trafiają do tych samych ludzi i dzielą ten sam budżet. Szansa mówi, na ile pewne jest, że reklama
          naprawdę sprzedaje lepiej, a nie miała po prostu szczęścia.
        </p>
        <p>
          <b className="font-semibold text-foreground">Kiedy oceniamy.</b> Poniżej 10 zakupów nie oceniamy reklamy
          („Za wcześnie”) - przy tak małych liczbach wynik to jeszcze przypadek.
        </p>
        <p>
          <b className="font-semibold text-foreground">Werdykty.</b> „Wygrywa”: co najmniej 90% szans, że sprzedaje
          lepiej niż reszta zestawu. „Przegrywa”: równie pewne, że sprzedaje gorzej, a wciąż wydaje pieniądze.
          „Męczy się”: ostatnie 3 dni są wyraźnie słabsze niż tydzień wcześniej, a te same osoby widzą ją coraz
          częściej. „Na równi”: bez wyraźnej różnicy.
        </p>
        <p>
          <b className="font-semibold text-foreground">Skąd liczby.</b> Zakupy i sprzedaż to dane Meta - jej własne
          przypisanie zakupów do reklam (np. zakup do 7 dni po kliknięciu). Mogą się różnić od zamówień w
          sklepie. Dzisiejszy dzień jest jeszcze niepełny.
        </p>
      </div>
    </details>
  );
}

/**
 * "Testy kreacji" for shops that A/B test many ads per ad set: what to do
 * today, the window's totals, every test with its verdicts, and a compare
 * panel. Shared by the client page and the demo; returns the slides as a
 * fragment so each is its own presentation slide.
 */
export function AbPageView({
  view,
  path,
  keep = {},
  seasonAllowed,
  tabs,
  kickerExtra = "",
}: {
  view: AbView;
  /** This page's path, e.g. "/dre/kreacje/testy". */
  path: string;
  /** Other query params the window links carry along (range, demo day). */
  keep?: Record<string, string>;
  /** "Cały sezon" only for clients with a season window. */
  seasonAllowed: boolean;
  /** The Reklamy section tabs. */
  tabs: ReactNode;
  kickerExtra?: string;
}) {
  const windowLabel = AB_WINDOW_LABEL[view.windowKey];
  const ads: Record<string, AbAd> = {};
  for (const t of view.tests) for (const a of t.ads) ads[a.adId] = a;

  const links: WindowLink[] = AB_WINDOWS.filter((k) => k !== "season" || seasonAllowed).map((key) => {
    const params = new URLSearchParams(keep);
    params.set("okno", key);
    const days = WINDOW_DAYS[key];
    return {
      key,
      href: `${path}?${params.toString()}`,
      label: AB_WINDOW_LABEL[key],
      title:
        key === view.windowKey
          ? rangeText(view.start, view.end)
          : days
            ? rangeText(addDaysIso(view.end, -(days - 1)), view.end)
            : undefined,
    };
  });

  const stamp = view.updatedAt
    ? formatDateWarsaw(view.updatedAt, "yyyy-MM-dd") === view.end
      ? formatDateWarsaw(view.updatedAt, "HH:mm")
      : formatDateWarsaw(view.updatedAt, "d MMM, HH:mm")
    : null;

  const header = (lead: string, controls: boolean) => (
    <AdsPageHeader
      kicker={`Meta · testy kreacji · ${windowLabel.toLowerCase()}${kickerExtra}`}
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
        {header("Która reklama wygrywa, która przepala budżet, a która się męczy - test po teście.", false)}
        <EmptyState
          icon={FlaskConical}
          title="Testy kreacji jeszcze się nie pojawiły"
          description="Testy kreacji pojawią się po pierwszej synchronizacji reklam na poziomie pojedynczych reklam (do 30 min po włączeniu)."
        />
      </>
    );
  }

  if (view.tests.length === 0) {
    return (
      <>
        {header("W tym oknie żadna reklama nie wydała pieniędzy.", true)}
        <EmptyState
          icon={WalletCards}
          title="Brak wydatków w tym oknie"
          description="Wybierz dłuższe okno u góry - testy pokażą się, gdy reklamy zaczną wydawać."
        />
      </>
    );
  }

  // The window ends today, which is still filling up: a sparkline ending on
  // it would always "crash" on the last point.
  const all = dailyTotals(view);
  const days = all.length > 2 ? all.slice(0, -1) : all;
  const { totals, rates } = view;

  return (
    <>
      {header(leadOf(view, ads), true)}

      <SectionBoundary name="ab/actions">
        <AbActions actions={[...view.actions].sort((a, b) => b.impactPerDay - a.impactPerDay)} ads={ads} />
      </SectionBoundary>

      <SectionBoundary name="ab/kpis">
        <section aria-label="Wyniki reklam w oknie" className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <StatTile
            index={0}
            label="Wydatki"
            explain="Ile kosztowały wszystkie testowane reklamy Meta w wybranym oknie."
            value={fmtMoney(totals.spend)}
            spark={days.map((d) => d.spend)}
            sub={`${view.adCount} ${adsWord(view.adCount)} ${inSets(view.tests.length)}`}
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
        <AbTestsExplorer tests={view.tests} windowLabel={windowLabel} end={view.end} />
      </SectionBoundary>

      <AbMethod />
    </>
  );
}
