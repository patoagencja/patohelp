import Link from "next/link";
import { Store } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SalesSectionTabs } from "@/components/dashboard/section-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import {
  alignedDate,
  type CompareMode,
  dayMonthPl,
  type DailyNetView,
  type NetRange,
} from "@/lib/daily-net/calc";
import type { ManualChange } from "@/lib/daily-net/paste";
import { cn, formatPlnWhole } from "@/lib/utils";

import { ManualCostsGrid, type ManualSaveResult } from "./manual-costs-grid";
import { NetCumulativeChart } from "./net-chart";
import { NetKpis } from "./net-kpis";
import { NetRangeControl, wynikHref } from "./net-range-control";
import { NetTable } from "./net-table";

const fullDate = (iso: string) => `${dayMonthPl(iso)} ${iso.slice(0, 4)}`;

/** A quiet one-line note above the numbers (data gaps, partial history). */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[18px] bg-chip px-4 py-3 text-sm leading-relaxed text-ink-2">{children}</p>;
}

/**
 * "Wynik dzień po dniu": the shop's revenue minus every ad channel, day by
 * day, against last year - the sheet seasonal shops kept by hand. Shared
 * by the live page and the public demo: everything arrives as props.
 */
export function DailyNetPageView({
  view,
  range,
  mode,
  base,
  seasonLabel,
  shop,
  manual,
  tiktokApiDates,
  isAgency,
  exportClient,
  save,
  readOnlyNote,
  padded = true,
}: {
  view: DailyNetView;
  range: NetRange;
  mode: CompareMode;
  /** Client root: "/<slug>" or "/demo-full". */
  base: string;
  /** "Sezon 2026" for a seasonal shop's season range, else null. */
  seasonLabel: { cur: string; ly: string } | null;
  shop: { available: boolean; first: string | null; last: string | null };
  manual: { available: boolean; failed?: boolean; values: Record<string, number>; migration?: string };
  tiktokApiDates: string[];
  isAgency: boolean;
  /** Slug for the CSV file name. */
  exportClient: string;
  /** Bulk save of the hand-entered costs; absent = read-only. */
  save?: (payload: { client: string; changes: ManualChange[] }) => Promise<ManualSaveResult>;
  readOnlyNote?: string;
  /** False where the layout pads the page (the demo). */
  padded?: boolean;
}) {
  const path = `${base}/wynik`;
  const { rows, comparison: cmp } = view;
  const seasonal = seasonLabel !== null;
  const query = { range: range.preset, from: range.preset === "custom" ? range.start : undefined, to: range.preset === "custom" ? range.end : undefined };
  const compareHrefs: Record<CompareMode, string> = {
    date: wynikHref(path, { ...query, cmp: "date" }),
    weekday: wynikHref(path, { ...query, cmp: "weekday" }),
  };
  const lyRange = {
    from: alignedDate(range.start, mode),
    to: alignedDate(range.end, mode),
  };

  const noShop = !shop.available || shop.first === null;
  const todayRow = rows.find((r) => r.partial);
  const finished = rows.filter((r) => !r.partial);
  const gaps = finished.filter((r) => r.revenue === null && (shop.first === null || r.date >= shop.first));
  const beforeShop = shop.first !== null && range.start < shop.first;
  const lyHasSales = rows.some((r) => r.ly.revenue !== null);
  const lyWithoutAds = lyHasSales && cmp.adsMatched === null;
  const settingsHint = isAgency ? " Historię wgrasz z pliku CSV w Ustawienia → Sprzedaż sklepu." : " Agencja może ją wgrać z pliku CSV.";

  const curLabel = seasonLabel && range.preset === "season" ? seasonLabel.cur : "Ten okres";
  const lyLabel = seasonLabel && range.preset === "season" ? seasonLabel.ly : "Rok temu";

  return (
    <div className={cn("min-w-0 space-y-8", padded && "px-4 py-6 sm:px-6 md:py-8")}>
      <div className="space-y-5">
        <SalesSectionTabs base={base} active="wynik" />
        <PageHeader
          eyebrow={<span className="kick">Sklep · {range.label}</span>}
          title="Wynik dzień po dniu"
          description="Przychód sklepu minus wszystkie reklamy - ile zostaje każdego dnia i jak to wygląda na tle zeszłego roku."
          actions={<NetRangeControl path={path} range={range} mode={mode} seasonal={seasonal} />}
        />
      </div>

      {noShop ? (
        <EmptyState
          icon={Store}
          title="Sklep nie przesyła jeszcze sprzedaży do panelu"
          description={
            isAgency
              ? "Bez przychodu ze sklepu tabela pokaże same koszty reklam. Podłącz sprzedaż w Ustawieniach: API sklepu (co godzinę) albo plik CSV z historią."
              : "Gdy sklep zacznie przesyłać sprzedaż, zobaczysz tu przychód minus reklamy dzień po dniu. Do tego czasu widać same koszty reklam."
          }
          action={
            isAgency && base !== "/demo-full" ? (
              <Button asChild size="pill">
                <Link href={`${base}/settings#sprzedaz-sklepu`}>Podłącz sprzedaż sklepu</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-2">
          {range.clamped ? <Note>Pokazujemy najwyżej 400 dni naraz - zakres zaczyna się od {fullDate(range.start)}.</Note> : null}
          {beforeShop ? (
            <Note>Sprzedaż ze sklepu jest w panelu od {fullDate(shop.first ?? range.start)} - wcześniejsze dni nie mają przychodu.</Note>
          ) : null}
          {gaps.length ? (
            <Note>
              {gaps.length === 1 ? `${fullDate(gaps[0].date)}: brak sprzedaży z tego dnia` : `${gaps.length} dni bez sprzedaży w panelu (pierwszy: ${fullDate(gaps[0].date)})`}{" "}
              - sprawdź import ze sklepu. Te dni nie liczą się do „zostaje po reklamach”.
            </Note>
          ) : null}
          {cmp.basis === "none" ? (
            <Note>
              Zeszłorocznej sprzedaży nie ma jeszcze w panelu - kolumna „Rok temu” jest pusta.
              {settingsHint}
            </Note>
          ) : cmp.basis === "matched" ? (
            <Note>
              Zeszłoroczna sprzedaż jest w panelu tylko za część dni ({cmp.matchedDays} z {cmp.cur.revenueDays}) - porównania z rokiem
              temu liczymy z tych dni.
            </Note>
          ) : null}
          {lyWithoutAds ? (
            <Note>
              Brak wydatków na reklamy z zeszłego roku w panelu - „Rok temu” to na razie sam przychód. Koszty z zeszłego roku możesz
              wpisać niżej, w{" "}
              <Link className="font-medium text-foreground underline underline-offset-2" href={wynikHref(path, { ...lyRange, cmp: mode })}>
                tym samym okresie rok temu
              </Link>
              .
            </Note>
          ) : null}
        </div>
      )}

      <NetKpis cmp={cmp} lyWord={seasonLabel && range.preset === "season" ? "poprzedni sezon" : "rok temu"} />
      {todayRow ? (
        <p className="-mt-4 text-sm text-ink-3">
          Dziś do teraz (dzień niepełny, poza sumami): przychód {todayRow.revenue !== null ? formatPlnWhole(todayRow.revenue) : "jeszcze brak"},
          reklamy {formatPlnWhole(todayRow.spend.total)}.
        </p>
      ) : null}

      <section className="space-y-4">
        <SectionHeader
          title="Zostaje po reklamach - narastająco"
          description={
            seasonal && range.preset === "season"
              ? `${curLabel} do wczoraj na tle całego poprzedniego sezonu (${mode === "weekday" ? "ten sam dzień tygodnia" : "ta sama data"}).`
              : `Ten okres do wczoraj na tle tych samych dni rok temu (${mode === "weekday" ? "ten sam dzień tygodnia" : "ta sama data"}).`
          }
        />
        <Card className="p-5 sm:p-6">
          <NetCumulativeChart points={view.chart} curLabel={curLabel} lyLabel={lyLabel} />
        </Card>
      </section>

      <NetTable view={view} mode={mode} compareHrefs={compareHrefs} exportScope={{ client: exportClient, from: range.start, to: range.end }} />

      <section className="space-y-4" id="koszty-spoza-integracji">
        <SectionHeader
          title="Koszty spoza integracji (Pinterest, Bing, X, ChatGPT…)"
          description="Kanały, których panel nie pobiera sam - wpisz albo wklej je z arkusza, a doliczą się do „Reklamy razem”. TikTok wpisuj tylko za dni, gdy integracja nie ma danych."
        />
        {!manual.available ? (
          <Note>
            {isAgency
              ? `Ta sekcja potrzebuje nowej tabeli - uruchom migrację ${manual.migration ?? "0046_manual_ad_costs.sql"} w Supabase (SQL Editor). Do tego czasu tabela wyżej liczy tylko Meta, Google i TikTok.`
              : "Ta sekcja nie jest jeszcze włączona - agencja musi ją uruchomić. Do tego czasu tabela wyżej liczy tylko Meta, Google i TikTok."}
          </Note>
        ) : manual.failed ? (
          <Note>Nie udało się wczytać kosztów spoza integracji - odśwież stronę za chwilę.</Note>
        ) : (
          <>
            <ManualCostsGrid
              clientSlug={exportClient}
              dates={rows.map((r) => r.date)}
              stored={manual.values}
              tiktokApiDates={tiktokApiDates}
              save={save}
              readOnlyNote={readOnlyNote}
            />
            {save ? (
              <p className="text-sm text-ink-3">
                Koszty z zeszłego roku wpiszesz po przełączeniu na{" "}
                <Link className="font-medium text-ink-2 underline underline-offset-2" href={wynikHref(path, { ...lyRange, cmp: mode })}>
                  ten sam okres rok temu
                </Link>
                {" "}({fullDate(lyRange.from)} - {fullDate(lyRange.to)}).
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
