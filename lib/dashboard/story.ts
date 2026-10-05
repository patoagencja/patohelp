import type {
  DashboardKpis,
  EcommerceKpis,
  Kpi,
  TrendPoint,
} from "@/lib/dashboard/metrics";
import { formatMoneyPLN, formatNumberPL, formatPlnWhole } from "@/lib/utils";

// Plain-language "what happened" for people who don't speak CTR/CPC: marketing
// managers skimming before a board meeting. Deterministic (no LLM cost) and
// honest: wins are only claimed when the numbers support them, and changes on
// tiny bases are not dressed up as "+300%".

export type Tone = "good" | "bad" | "flat";

export interface StoryFact {
  key: string;
  value: string;
  /** What the number means, in words ("kliknięć w reklamy"). */
  caption: string;
  /** Comparison with the previous period, already phrased. */
  change: { text: string; tone: Tone } | null;
}

export interface Story {
  headline: string;
  facts: StoryFact[];
  wins: string[];
  watch: string | null;
}

/** Polish plural: 1 kliknięcie, 2-4 kliknięcia, 5+ kliknięć (12-14 -> many). */
export function plPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  if (abs === 1) return one;
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

const COMPACT = new Intl.NumberFormat("pl-PL", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 1 234 567 -> "1,2 mln"; below 100k keep the exact number, it reads better. */
export function formatCompactPL(n: number): string {
  return n >= 100_000 ? COMPACT.format(n) : formatNumberPL(n);
}

/** Noun form to use after a formatted number ("tys."/"mln" take genitive). */
function nounFor(n: number, one: string, few: string, many: string): string {
  return n >= 100_000 ? many : plPlural(n, one, few, many);
}

/** Minimum previous-period size before a % change is worth saying out loud. */
const MIN_BASE = { clicks: 50, sessions: 50, conversions: 10, orders: 5 };

function pct(kpi: Kpi): number | null {
  if (kpi.deltaPercent === null || !Number.isFinite(kpi.deltaPercent)) return null;
  return kpi.deltaPercent;
}

/** "o 16% więcej niż w poprzednim okresie" / "o 7% taniej niż wcześniej". */
function phraseChange(
  delta: number | null,
  kind: "more_is_good" | "cost" | "neutral"
): { text: string; tone: Tone } | null {
  if (delta === null) return null;
  const r = Math.round(Math.abs(delta));
  if (r < 3) return { text: "podobnie jak wcześniej", tone: "flat" };
  const up = delta > 0;
  if (kind === "cost") {
    return up
      ? { text: `o ${r}% drożej niż wcześniej`, tone: "bad" }
      : { text: `o ${r}% taniej niż wcześniej`, tone: "good" };
  }
  const text = `o ${r}% ${up ? "więcej" : "mniej"} niż wcześniej`;
  if (kind === "neutral") return { text, tone: "flat" };
  return { text, tone: up ? "good" : "bad" };
}

function bestDay(
  trend: TrendPoint[],
  pick: (t: TrendPoint) => number
): { date: string; value: number } | null {
  let best: TrendPoint | null = null;
  for (const t of trend) if (!best || pick(t) > pick(best)) best = t;
  if (!best || pick(best) <= 0) return null;
  return { date: best.date, value: pick(best) };
}

const MONTHS_GEN = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

/** "2026-09-28" -> "28 września" (dates are already Warsaw days). */
export function dayMonthPL(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}

export function buildStory({
  kpis,
  trend,
  ecommerce,
}: {
  kpis: DashboardKpis;
  trend: TrendPoint[];
  /** Pass for e-commerce clients only - engagement clients never see revenue. */
  ecommerce?: EcommerceKpis | null;
}): Story {
  const impressions = trend.reduce((a, t) => a + t.impressions, 0);
  const clicks = kpis.clicks.value;
  const sessions = kpis.sessions.value;
  const hasSessions = sessions > 0;

  const clicksDelta = kpis.clicks.previous >= MIN_BASE.clicks ? pct(kpis.clicks) : null;
  const sessionsDelta =
    kpis.sessions.previous >= MIN_BASE.sessions ? pct(kpis.sessions) : null;
  const cpcDelta = kpis.clicks.previous >= MIN_BASE.clicks ? pct(kpis.cpcMinorUnits) : null;
  const ctrDelta = kpis.clicks.previous >= MIN_BASE.clicks ? pct(kpis.ctr) : null;

  const facts: StoryFact[] = [];
  const wins: string[] = [];
  let watch: string | null = null;
  let headline: string;

  const revenue = ecommerce?.revenueMinorUnits.value ?? 0;
  const isShop = Boolean(ecommerce) && revenue > 0;

  if (isShop && ecommerce) {
    const orders = ecommerce.transactions.value;
    const roas = ecommerce.roas.value / 100;
    const ordersDelta =
      ecommerce.transactions.previous >= MIN_BASE.orders ? pct(ecommerce.transactions) : null;
    const revenueDelta =
      ecommerce.transactions.previous >= MIN_BASE.orders
        ? pct(ecommerce.revenueMinorUnits)
        : null;

    headline = `Sklep sprzedał za ${formatPlnWhole(revenue)} - ${formatNumberPL(
      orders
    )} ${plPlural(orders, "zamówienie", "zamówienia", "zamówień")}.`;

    facts.push({
      key: "revenue",
      value: formatPlnWhole(revenue),
      caption: "sprzedaży w sklepie",
      change: phraseChange(revenueDelta, "more_is_good"),
    });
    facts.push({
      key: "orders",
      value: formatNumberPL(orders),
      caption: plPlural(orders, "zamówienie", "zamówienia", "zamówień"),
      change: phraseChange(ordersDelta, "more_is_good"),
    });
    if (roas > 0) {
      facts.push({
        key: "roas",
        value: `${roas.toLocaleString("pl-PL", { maximumFractionDigits: 2 })} zł`,
        caption: "wróciło z każdej 1 zł wydanej na reklamy",
        change: phraseChange(
          ecommerce.roas.previous > 0 ? pct(ecommerce.roas) : null,
          "more_is_good"
        ),
      });
    }
    if (hasSessions) {
      facts.push({
        key: "sessions",
        value: formatCompactPL(sessions),
        caption: `${nounFor(sessions, "wizyta", "wizyty", "wizyt")} na stronie`,
        change: phraseChange(sessionsDelta, "more_is_good"),
      });
    }

    const roasDelta = ecommerce.roas.previous > 0 ? pct(ecommerce.roas) : null;
    if (roasDelta !== null && roasDelta >= 5)
      wins.push(
        `Reklamy zarabiają efektywniej - z każdej złotówki wraca o ${Math.round(
          roasDelta
        )}% więcej.`
      );
    const best = bestDay(trend, (t) => t.revenueMinorUnits);
    if (best)
      wins.push(
        `Najlepszy dzień: ${dayMonthPL(best.date)} - ${formatPlnWhole(best.value)} sprzedaży.`
      );
    if (revenueDelta !== null && revenueDelta <= -10)
      watch = `Sprzedaż niższa o ${Math.round(
        -revenueDelta
      )}% niż w poprzednim okresie - przyglądamy się kampaniom i ruchowi.`;
  } else {
    headline = hasSessions
      ? `Reklamy przyciągnęły ${formatNumberPL(clicks)} ${plPlural(
          clicks,
          "kliknięcie",
          "kliknięcia",
          "kliknięć"
        )} i ${formatNumberPL(sessions)} ${plPlural(sessions, "wizytę", "wizyty", "wizyt")} na stronie.`
      : `Reklamy przyciągnęły ${formatNumberPL(clicks)} ${plPlural(
          clicks,
          "kliknięcie",
          "kliknięcia",
          "kliknięć"
        )}.`;

    if (impressions > 0) {
      facts.push({
        key: "impressions",
        value: formatCompactPL(impressions),
        caption: `${nounFor(impressions, "wyświetlenie", "wyświetlenia", "wyświetleń")} reklam`,
        change: null,
      });
    }
    facts.push({
      key: "clicks",
      value: formatCompactPL(clicks),
      caption: `${nounFor(clicks, "kliknięcie", "kliknięcia", "kliknięć")} w reklamy`,
      change: phraseChange(clicksDelta, "more_is_good"),
    });
    if (hasSessions) {
      facts.push({
        key: "sessions",
        value: formatCompactPL(sessions),
        caption: `${nounFor(sessions, "wizyta", "wizyty", "wizyt")} na stronie`,
        change: phraseChange(sessionsDelta, "more_is_good"),
      });
    }
    if (kpis.cpcMinorUnits.value > 0) {
      facts.push({
        key: "cpc",
        value: formatMoneyPLN(kpis.cpcMinorUnits.value),
        caption: "średni koszt jednego kliknięcia",
        change: phraseChange(cpcDelta, "cost"),
      });
    }
  }

  // Wins that apply to every client. Changes already shown under the big
  // numbers aren't repeated here - this list is for what the numbers hide.
  if (cpcDelta !== null && cpcDelta <= -3)
    wins.push(
      `Kliknięcie tańsze o ${Math.round(-cpcDelta)}% - za te same pieniądze więcej ruchu.`
    );
  if (ctrDelta !== null && ctrDelta >= 5)
    wins.push(
      `Reklamy lepiej przyciągają uwagę - klika ${Math.round(ctrDelta)}% więcej osób z tych, które je widzą.`
    );
  if (!isShop) {
    const best = bestDay(trend, (t) => (hasSessions ? t.sessions : t.clicks));
    if (best)
      wins.push(
        `Najlepszy dzień: ${dayMonthPL(best.date)} - ${formatNumberPL(best.value)} ${
          hasSessions
            ? plPlural(best.value, "wizyta", "wizyty", "wizyt")
            : plPlural(best.value, "kliknięcie", "kliknięcia", "kliknięć")
        }.`
      );
  }

  if (!watch) {
    if (clicksDelta !== null && clicksDelta <= -10)
      watch = `Kliknięć mniej o ${Math.round(
        -clicksDelta
      )}% niż w poprzednim okresie - sprawdzamy, które kampanie za tym stoją.`;
    else if (cpcDelta !== null && cpcDelta >= 15)
      watch = `Kliknięcie podrożało o ${Math.round(
        cpcDelta
      )}% - pracujemy nad obniżeniem kosztu.`;
  }

  return { headline, facts: facts.slice(0, 4), wins: wins.slice(0, 4), watch };
}
