import Link from "next/link";

import { CsvDownloadButton } from "@/components/dashboard/csv-download-button";
import { InfoTip } from "@/components/dashboard/info-tip";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import {
  CHANNEL_LABEL,
  type CompareMode,
  dayDot,
  type DayMoment,
  type DailyNetView,
  finishedRows,
  type NetRow,
  OTHER_CHANNELS,
  totalsOf,
  weekdayPl,
} from "@/lib/daily-net/calc";
import { csvFileName, type CsvColumn, type CsvValue, type ExportScope } from "@/lib/export/csv";
import { cn, formatPlnWhole } from "@/lib/utils";

import { signedPln } from "./net-kpis";

const MOMENT_LABEL: Record<Exclude<DayMoment, null>, string> = {
  "black-friday": "Black Friday",
  "cyber-monday": "Cyber Monday",
  "black-week": "Black Week",
};
// Phones: the pinned date column must stay narrow.
const MOMENT_SHORT: Record<Exclude<DayMoment, null>, string> = {
  "black-friday": "BF",
  "cyber-monday": "CM",
  "black-week": "BW",
};

const NO_SALES = "brak sprzedaży z tego dnia - sprawdź import ze sklepu";
const NOT_YET = "sklep nie przesłał jeszcze dzisiejszej sprzedaży";

const money = (v: number | null) => (v === null ? "-" : formatPlnWhole(v));
/** "+12%" / "-3%"; a change that rounds to 0% reads "0%", not "-0%". */
const pct = (r: number | null) => {
  if (r === null) return "-";
  const n = Math.round(Math.abs(r) * 100);
  return n === 0 ? "0%" : `${r > 0 ? "+" : "-"}${n}%`;
};
const tone = (v: number | null) => (v === null || v === 0 ? "text-ink-3" : v > 0 ? "text-positive" : "text-negative");

/** "Pinterest 120 zł · Bing 40 zł" for the "Pozostałe" tooltip. */
function othersBreakdown(others: Partial<Record<(typeof OTHER_CHANNELS)[number], number>>): string {
  return OTHER_CHANNELS.filter((c) => (others[c] ?? 0) > 0)
    .map((c) => `${CHANNEL_LABEL[c]} ${formatPlnWhole(others[c] ?? 0)}`)
    .join(" · ");
}

/**
 * The shop's sheet, one row per day: revenue, every ad channel, what is
 * left, last year's left-over on the matched day and the difference (the
 * sheet's R and R%). Black Week rows are tinted and everything from it on
 * is set in bold, as in the sheet; today is shown but marked partial and
 * left out of the totals. On a phone the table scrolls sideways inside its
 * card with the date column pinned.
 */
export function NetTable({
  view,
  mode,
  compareHrefs,
  exportScope,
}: {
  view: DailyNetView;
  mode: CompareMode;
  /** Links that switch the comparison, keeping the range. */
  compareHrefs: Record<CompareMode, string>;
  exportScope: ExportScope;
}) {
  const { rows, change, showY2 } = view;
  const done = finishedRows(rows);
  const cur = totalsOf(done);
  const lyNetTotal = done.reduce<number | null>((a, r) => (r.ly.net === null ? a : (a ?? 0) + r.ly.net), null);
  const y2NetTotal = done.reduce<number | null>((a, r) => (r.y2.net === null ? a : (a ?? 0) + r.y2.net), null);
  const anyManualTiktok = rows.some((r) => r.spend.source.tiktok === "manual");
  const weekday = mode === "weekday";

  const th = "px-3 py-3 text-right font-medium whitespace-nowrap";
  const td = "px-3 py-2.5 text-right whitespace-nowrap";
  // The pinned date cell needs its own opaque fill (the row tint is behind it).
  const stickyCell = (r?: NetRow) =>
    cn(
      "sticky left-0 z-[1] px-3 py-2.5 text-left whitespace-nowrap shadow-[1px_0_0_var(--line)]",
      r?.partial ? "bg-muted" : r?.moment ? "bg-lime-soft" : "bg-card"
    );

  const csvColumns: CsvColumn[] = [
    { header: "Data", kind: "date" },
    { header: "Przychód", kind: "money" },
    { header: "Reklamy razem", kind: "money" },
    { header: "Meta", kind: "money" },
    { header: "Google", kind: "money" },
    { header: "TikTok", kind: "money" },
    ...OTHER_CHANNELS.map((c): CsvColumn => ({ header: CHANNEL_LABEL[c], kind: "money" })),
    { header: "Zostaje po reklamach", kind: "money" },
    { header: "Rok temu - dzień", kind: "date" },
    { header: "Rok temu", kind: "money" },
    { header: "Różnica zł", kind: "money" },
    { header: "Różnica %", kind: "percent", digits: 1 },
    ...(showY2 ? [{ header: "2 lata temu", kind: "money" } satisfies CsvColumn] : []),
    { header: "Uwagi", kind: "text" },
  ];
  const csvRows: CsvValue[][] = rows.map((r) => [
    r.date,
    r.revenue,
    r.spend.total,
    r.spend.meta,
    r.spend.google,
    r.spend.tiktok,
    ...OTHER_CHANNELS.map((c) => r.spend.others[c] ?? null),
    r.net,
    r.ly.date,
    r.ly.net,
    r.diff,
    r.diffPct === null ? null : r.diffPct * 100,
    ...(showY2 ? [r.y2.net] : []),
    [r.partial ? "dziś - dzień niepełny, poza sumą" : "", r.revenue === null && !r.partial ? NO_SALES : "", r.moment ? MOMENT_LABEL[r.moment] : ""]
      .filter(Boolean)
      .join("; "),
  ]);
  csvRows.push([
    "Razem",
    cur.revenue,
    cur.ads,
    cur.meta,
    cur.google,
    cur.tiktok,
    ...OTHER_CHANNELS.map((c) => cur.others[c]),
    cur.net,
    null,
    lyNetTotal,
    change.diff,
    change.pct === null ? null : change.pct * 100,
    ...(showY2 ? [y2NetTotal] : []),
    rows.some((r) => r.partial) ? "bez dzisiejszego dnia" : "",
  ]);

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Dzień po dniu"
        description={
          weekday
            ? "„Rok temu” to ten sam dzień tygodnia rok wcześniej (364 dni wstecz) - piątek z piątkiem, Black Friday z Black Friday."
            : "„Rok temu” to ta sama data rok wcześniej - jak w Waszym arkuszu."
        }
        actions={<CsvDownloadButton columns={csvColumns} rows={csvRows} fileName={csvFileName(exportScope, "wynik-dzien-po-dniu")} />}
      />
      {/* Its own row, not the header's actions: there the two long labels
          widened the page past a phone screen. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5" data-print-hide>
        <span className="text-xs text-ink-3" aria-hidden>
          porównuj z:
        </span>
        <nav aria-label="Porównuj z" className={segmentedTrack}>
          {(
            [
              ["date", "tą samą datą"],
              ["weekday", "tym samym dniem tygodnia"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={compareHrefs[key]}
              scroll={false}
              aria-current={mode === key ? "true" : undefined}
              className={segmentedItem(mode === key, "min-h-10 text-[13px]")}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <Card className="overflow-hidden bg-card p-0">
        {/* Phones scroll the page itself (only sideways in here); larger
            screens keep the header and the totals in view while scrolling. */}
        <div className="overflow-auto overscroll-x-contain sm:max-h-[75vh]">
          <table className="w-full min-w-[68rem] border-separate border-spacing-0 text-sm tabular-nums">
            <caption className="sr-only">Wynik dzień po dniu: przychód, reklamy i to, co zostaje, na tle zeszłego roku</caption>
            <thead className="sticky top-0 z-[2] bg-card text-xs text-ink-3">
              <tr className="[&>th]:border-b [&>th]:border-line">
                <th scope="col" className={cn(stickyCell(), "z-[3] py-3 font-medium")}>
                  Data
                </th>
                <th scope="col" className={th}>Przychód</th>
                <th scope="col" className={th}>Reklamy razem</th>
                <th scope="col" className={th}>Meta</th>
                <th scope="col" className={th}>Google</th>
                <th scope="col" className={th}>TikTok</th>
                <th scope="col" className={th}>Pozostałe</th>
                <th scope="col" className={cn(th, "text-foreground")}>Zostaje po reklamach</th>
                <th scope="col" className={th}>Rok temu</th>
                <th scope="col" className={th}>Różnica zł</th>
                <th scope="col" className={th}>Różnica %</th>
                {showY2 ? <th scope="col" className={th}>2 lata temu</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const breakdown = othersBreakdown(r.spend.others);
                return (
                  <tr
                    key={r.date}
                    className={cn(
                      "[&>td]:border-b [&>td]:border-line [&>th]:border-b [&>th]:border-line",
                      r.partial ? "bg-muted italic text-ink-2" : r.moment ? "bg-lime-soft" : undefined,
                      r.emphasis && !r.partial && "font-semibold"
                    )}
                  >
                    <th scope="row" className={cn(stickyCell(r), r.emphasis ? "font-semibold" : "font-normal")}>
                      <span className="text-ink-3">{weekdayPl(r.date)}</span> {dayDot(r.date)}
                      {r.moment ? (
                        <span
                          className="ml-2 rounded-full bg-anchor px-2 py-0.5 text-[10.5px] font-medium not-italic text-anchor-foreground"
                          title={MOMENT_LABEL[r.moment]}
                        >
                          <span className="sm:hidden" aria-hidden>
                            {MOMENT_SHORT[r.moment]}
                          </span>
                          <span className="max-sm:sr-only">{MOMENT_LABEL[r.moment]}</span>
                        </span>
                      ) : null}
                      {r.partial ? <span className="ml-2 text-[11px] font-normal text-ink-3">dziś, niepełny</span> : null}
                    </th>
                    <td className={td}>
                      {r.revenue !== null ? (
                        formatPlnWhole(r.revenue)
                      ) : (
                        <span className="text-[12px] font-normal text-warning" title={r.partial ? NOT_YET : NO_SALES}>
                          {r.partial ? "jeszcze brak" : "brak danych"}
                          <span className="sr-only"> - {r.partial ? NOT_YET : NO_SALES}</span>
                        </span>
                      )}
                    </td>
                    <td className={td}>{r.spend.hasData ? formatPlnWhole(r.spend.total) : <span className="text-ink-3">-</span>}</td>
                    <td className={td}>{r.spend.source.meta ? formatPlnWhole(r.spend.meta) : <span className="text-ink-3">-</span>}</td>
                    <td className={td}>{r.spend.source.google ? formatPlnWhole(r.spend.google) : <span className="text-ink-3">-</span>}</td>
                    <td className={td}>
                      {r.spend.source.tiktok ? formatPlnWhole(r.spend.tiktok) : <span className="text-ink-3">-</span>}
                      {r.spend.source.tiktok === "manual" ? (
                        <span className="ml-0.5 text-ink-3" title="wpisane ręcznie">
                          *
                        </span>
                      ) : null}
                    </td>
                    <td className={td}>
                      {r.spend.othersTotal > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          {formatPlnWhole(r.spend.othersTotal)}
                          <InfoTip label={`Pozostałe ${dayDot(r.date)}`} text={breakdown} />
                        </span>
                      ) : (
                        <span className="text-ink-3">-</span>
                      )}
                    </td>
                    <td className={cn(td, "text-foreground", r.net !== null && r.net < 0 && "text-negative")}>{money(r.net)}</td>
                    <td className={cn(td, "text-ink-2")}>
                      {money(r.ly.net)}
                      {weekday ? <span className="block text-[11px] font-normal text-ink-3">{`${weekdayPl(r.ly.date)} ${dayDot(r.ly.date)}.${r.ly.date.slice(0, 4)}`}</span> : null}
                    </td>
                    <td className={cn(td, tone(r.diff))}>{r.diff === null ? "-" : signedPln(r.diff)}</td>
                    <td className={cn(td, tone(r.diffPct))}>{pct(r.diffPct)}</td>
                    {showY2 ? <td className={cn(td, "text-ink-2")}>{money(r.y2.net)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-[2] bg-card font-semibold [&_td]:border-t [&_td]:border-line [&_th]:border-t [&_th]:border-line">
              <tr>
                <th scope="row" className={cn(stickyCell(), "z-[3] py-3")}>
                  Razem
                  {rows.some((r) => r.partial) ? <span className="block text-[11px] font-normal text-ink-3">bez dzisiaj</span> : null}
                </th>
                <td className={td}>{formatPlnWhole(cur.revenue)}</td>
                <td className={td}>{formatPlnWhole(cur.ads)}</td>
                <td className={td}>{formatPlnWhole(cur.meta)}</td>
                <td className={td}>{formatPlnWhole(cur.google)}</td>
                <td className={td}>{formatPlnWhole(cur.tiktok)}</td>
                <td className={td}>
                  <span className="inline-flex items-center gap-1">
                    {formatPlnWhole(cur.othersTotal)}
                    {cur.othersTotal > 0 ? <InfoTip label="Pozostałe razem" text={othersBreakdown(cur.others)} /> : null}
                  </span>
                </td>
                <td className={cn(td, cur.net < 0 && "text-negative")}>{formatPlnWhole(cur.net)}</td>
                <td className={cn(td, "text-ink-2")}>{money(lyNetTotal)}</td>
                <td
                  className={cn(td, tone(change.diff))}
                  title={change.days < cur.revenueDays ? `Suma różnic z dni, które mają dane z obu lat (${change.days})` : undefined}
                >
                  {change.diff === null ? "-" : signedPln(change.diff)}
                </td>
                <td className={cn(td, tone(change.pct))}>{pct(change.pct)}</td>
                {showY2 ? <td className={cn(td, "text-ink-2")}>{money(y2NetTotal)}</td> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      {anyManualTiktok ? (
        <p className="text-xs text-ink-3">* TikTok wpisany ręcznie - integracja nie ma danych z tego dnia.</p>
      ) : null}
    </section>
  );
}
