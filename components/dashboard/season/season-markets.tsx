import type { CSSProperties } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { change, compactCount, compactPln, roasText } from "@/lib/season/format";
import type { SeasonMarket } from "@/lib/season/load";
import { marketLabel } from "@/lib/season/markets";
import { cn } from "@/lib/utils";

/**
 * Market by market: who carries the season and who grows. One row per
 * country with its share of sales as a bar (no 7-colour pie), ROAS and the
 * change against the same point of the previous season.
 */
export function SeasonMarkets({
  markets,
  shopMarkets,
  showRevenue,
  prevGen,
  running = true,
  unmappedShare,
  isAgency,
}: {
  markets: SeasonMarket[];
  /** The shop's own sales per market (SeasonShop.markets), when it sends them. */
  shopMarkets?: Record<string, { cur: { revenue: number }; prev: { revenue: number } }> | null;
  showRevenue: boolean;
  /** "sezonu 2025" (genitive). */
  prevGen: string;
  /** Season in progress: compare "at the same point", else in full. */
  running?: boolean;
  unmappedShare: number;
  isAgency: boolean;
}) {
  const adByCode = new Map(markets.map((m) => [m.code, m]));
  const shopCodes = shopMarkets ? Object.keys(shopMarkets).filter((c) => c !== "") : [];
  // With a shop feed split by country the table ranks markets by real sales
  // and shows MER per market (that market's sales / its ad spend).
  const byShop = showRevenue && shopCodes.length >= 2;
  type Row = { code: string; v: number; prev: number; sub: string };
  let rows: Row[];
  if (byShop) {
    const codes = Array.from(new Set([...shopCodes, ...markets.map((m) => m.code)]));
    const total = codes.reduce((a, c) => a + (shopMarkets![c]?.cur.revenue ?? 0), 0);
    rows = codes
      .map((code) => {
        const v = shopMarkets![code]?.cur.revenue ?? 0;
        const spend = adByCode.get(code)?.cur.spend ?? 0;
        const share = total > 0 ? Math.round((v / total) * 100) : 0;
        const merText =
          spend > 0 && v > 0
            ? `zwrot\u00a0${(v / spend).toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`
            : spend > 0
              ? "jeszcze bez sprzedaży"
              : "bez reklam";
        return {
          code,
          v,
          prev: shopMarkets![code]?.prev.revenue ?? 0,
          sub: `${share}%\u00a0sprzedaży · ${merText}${spend > 0 ? ` · reklamy\u00a0${compactPln(spend)}` : ""}`,
        };
      })
      .sort((a, b) => b.v - a.v);
  } else {
    const metric = (t: SeasonMarket["cur"]) => (showRevenue ? t.value : t.clicks);
    const total = markets.reduce((a, m) => a + metric(m.cur), 0);
    rows = markets.map((m) => ({
      code: m.code,
      v: metric(m.cur),
      prev: metric(m.prev),
      sub: `${total > 0 ? Math.round((metric(m.cur) / total) * 100) : 0}%\u00a0sezonu${
        showRevenue ? ` · zwrot wg Meta i Google\u00a0${roasText(m.cur.value, m.cur.spend)}` : ""
      }`,
    }));
  }
  const total = rows.reduce((a, r) => a + r.v, 0);
  const fmt = (v: number) => (showRevenue ? compactPln(v) : compactCount(v));

  if (rows.length < 2) {
    // Nothing to split: say why to the agency (it's a naming fix), stay
    // quiet for the client.
    return isAgency ? (
      <Card className="p-5 text-sm leading-relaxed text-ink-2 sm:p-6">
        <p className="font-medium text-foreground">Rynki</p>
        <p className="mt-1">
          Podział na kraje bierzemy z nazw kampanii. Dodaj kod kraju na początku nazwy (np. „PL -
          Search”, „DE | PMax”) albo flagę, a pojawi się tu tabela rynków.
        </p>
      </Card>
    ) : null;
  }

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <SectionHeader
        title="Rynki"
        description={
          (byShop
            ? "Sprzedaż sklepu w każdym kraju, zwrot z reklam w tym kraju"
            : showRevenue
              ? "Sprzedaż z reklam (wg Meta i Google) w każdym kraju"
              : "Kliknięcia w każdym kraju") +
          (running
            ? ` i zmiana względem ${prevGen} w tym samym momencie.`
            : ` i zmiana względem całego ${prevGen}.`)
        }
      />
      <ul className="divide-y divide-[var(--line)]">
        {rows.map((m, idx) => {
          const v = m.v;
          const share = total > 0 ? v / total : 0;
          const ch = change(v, m.prev);
          return (
            <li key={m.code} className="grid grid-cols-[2.75rem_1fr_auto_auto] items-center gap-x-3 gap-y-1.5 py-3 sm:grid-cols-[2.75rem_minmax(8rem,1fr)_minmax(6rem,2fr)_auto_auto] sm:gap-x-5">
              <span className="grid h-9 w-11 place-items-center rounded-[12px] bg-chip font-mono text-[12px] font-medium tracking-[0.06em]">
                {m.code}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium">{marketLabel(m.code)}</span>
                <span className="hidden text-[12.5px] text-ink-3 tabular-nums sm:block">{m.sub}</span>
              </span>
              {/* Phones: the detail line gets the full width under the name. */}
              <span className="col-span-3 col-start-2 row-start-2 text-[12.5px] leading-snug text-ink-3 tabular-nums sm:hidden">
                {m.sub}
              </span>
              <span className="col-span-4 row-start-3 sm:col-span-1 sm:row-start-auto">
                <span aria-hidden className="block h-2.5 overflow-hidden rounded-full bg-chip">
                  <span
                    className="share-fill block h-full origin-left rounded-full animate-grow"
                    style={{ width: `${Math.max(2, share * 100)}%`, "--d": `${0.3 + idx * 0.06}s` } as CSSProperties}
                  />
                </span>
              </span>
              <b className="text-right text-[15px] font-semibold tabular-nums">{fmt(v)}</b>
              <span
                className={cn(
                  "inline-flex min-w-[3.5rem] items-center justify-end gap-0.5 text-[13px] font-semibold tabular-nums sm:min-w-[4.5rem]",
                  !ch ? "text-ink-3" : ch.tone === "good" ? "text-positive" : ch.tone === "bad" ? "text-negative" : "text-ink-2"
                )}
              >
                {ch ? (
                  <>
                    {ch.direction === "up" ? (
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    ) : ch.direction === "down" ? (
                      <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                    ) : null}
                    <span className="sr-only">{ch.direction === "down" ? "spadek" : "wzrost"} </span>
                    {ch.text}
                  </>
                ) : (
                  "nowy"
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {unmappedShare > 0.15 ? (
        <p className="text-[12.5px] text-ink-3">
          {Math.round(unmappedShare * 100)}% wydatków na reklamy to kampanie bez jednego kraju w nazwie
          (np. na kilka krajów naraz) - nie ma ich w tabeli, więc zwrot w krajach może wyglądać na wyższy.
        </p>
      ) : null}
    </Card>
  );
}
