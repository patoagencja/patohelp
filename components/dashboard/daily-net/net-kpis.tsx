import { StatTile, type StatTone } from "@/components/dashboard/stat-tile";
import type { NetComparison } from "@/lib/daily-net/calc";
import { change } from "@/lib/season/format";
import { formatPlnWhole } from "@/lib/utils";

const pct1 = (ratio: number) =>
  `${(ratio * 100).toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** "+12 300 zł" / "-4 100 zł" */
export const signedPln = (minor: number) => `${minor > 0 ? "+" : minor < 0 ? "-" : ""}${formatPlnWhole(Math.abs(minor))}`;

/**
 * The four numbers of the range against last year: revenue, all ads, what
 * is left after ads, and the share of revenue the ads take. Changes compare
 * only days the panel has in both years (NetComparison.basis); the line
 * under each number says what last year was.
 */
export function NetKpis({ cmp, lyWord = "rok temu" }: { cmp: NetComparison; lyWord?: string }) {
  const { cur, curMatched, lyMatched, basis, adsMatched } = cmp;
  const compared = basis !== "none";
  const partialNote = basis === "matched" ? ` (${cmp.matchedDays} dni z obu lat)` : "";

  const revenue = compared ? change(curMatched.revenue, lyMatched.revenue) : null;
  const ads = adsMatched ? change(adsMatched.cur, adsMatched.ly, { neutral: true }) : null;
  const net = compared ? change(curMatched.net, lyMatched.net) : null;
  const netDiff = compared ? curMatched.net - lyMatched.net : null;

  let share: { text: string; tone: StatTone; direction: "up" | "down" | null } | null = null;
  if (compared && curMatched.adShare !== null && lyMatched.adShare !== null) {
    const pp = (curMatched.adShare - lyMatched.adShare) * 100;
    const r = Math.round(Math.abs(pp) * 10) / 10;
    share = {
      text: `${r.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} pp`,
      // Ads eating less of the revenue is the good direction.
      tone: r === 0 ? "flat" : pp < 0 ? "good" : "bad",
      direction: r === 0 ? null : pp > 0 ? "up" : "down",
    };
  }

  const noLy = `${lyWord}: brak danych w panelu`;
  return (
    <section aria-label="Wynik w liczbach" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      <StatTile
        index={0}
        label="Przychód"
        explain="Sprzedaż brutto ze sklepu (przesyłana przez sklep albo wgrana z pliku), bez dzisiejszego niepełnego dnia."
        value={formatPlnWhole(cur.revenue)}
        delta={revenue}
        sub={compared ? `${lyWord}: ${formatPlnWhole(lyMatched.revenue)}${partialNote}` : noLy}
      />
      <StatTile
        index={1}
        label="Reklamy razem"
        explain="Wszystkie wydatki na reklamy: Meta, Google i TikTok z integracji plus koszty wpisane ręcznie (Pinterest, Bing, X, ChatGPT i inne)."
        value={formatPlnWhole(cur.ads)}
        delta={ads}
        sub={adsMatched ? `${lyWord}: ${formatPlnWhole(adsMatched.ly)}` : `${lyWord}: brak wydatków w panelu`}
      />
      <StatTile
        index={2}
        highlight
        label="Zostaje po reklamach"
        explain="Przychód minus wszystkie reklamy. Dni bez danych ze sklepu nie są liczone ani jako przychód, ani jako strata."
        value={formatPlnWhole(cur.net)}
        delta={net}
        sub={
          compared && netDiff !== null
            ? `${lyWord}: ${formatPlnWhole(lyMatched.net)} · ${signedPln(netDiff)}${partialNote}`
            : noLy
        }
      />
      <StatTile
        index={3}
        label="Reklamy / przychód"
        explain="Jaką część przychodu zjadają reklamy. Im mniej, tym więcej zostaje."
        value={cur.adShare !== null ? pct1(cur.adShare) : "-"}
        delta={share}
        sub={compared && lyMatched.adShare !== null ? `${lyWord}: ${pct1(lyMatched.adShare)}` : noLy}
      />
    </section>
  );
}
