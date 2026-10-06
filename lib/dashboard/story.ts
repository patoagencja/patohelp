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
  /**
   * One plain-language line that translates the number into something a
   * board understands ("ok. 105 kliknięć za każde 100 zł"). Dashboard only.
   */
  hint?: string;
}

/** The answer to "czy to dobrze czy źle?" in one short phrase. */
export interface StoryVerdict {
  tone: Tone;
  text: string;
}

export interface Story {
  headline: string;
  facts: StoryFact[];
  wins: string[];
  watch: string | null;
  /** Overall call for the period; null when there is nothing to compare. */
  verdict: StoryVerdict | null;
  /**
   * Shown instead of the numbers when there is nothing to tell yet (a brand
   * new client before the first sync): what is going on and when to look.
   */
  note?: string | null;
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

/**
 * Minimum previous-period size before a % change is worth saying out loud.
 * Must match the KPI cards' thin-base cut-offs (kpi-cards.tsx,
 * ecommerce-kpis.tsx MIN_PREV_TRANSACTIONS = 10): with orders at 5 the hero
 * said "o 40% więcej" while the tile below said "za mało danych".
 */
const MIN_BASE = { clicks: 50, sessions: 50, conversions: 10, orders: 10 };

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

// "Najlepszy dzień" out of two days of history is not news - wait for a week.
const MIN_DAYS_FOR_BEST = 7;

function bestDay(
  trend: TrendPoint[],
  pick: (t: TrendPoint) => number
): { date: string; value: number } | null {
  if (trend.filter((t) => pick(t) > 0).length < MIN_DAYS_FOR_BEST) return null;
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

/**
 * What "niż wcześniej" means for a given range label, phrased to follow
 * "w porównaniu " / "względem ". Mirrors resolveRange() in metrics.ts: presets
 * compare with the same-length period right before, "Bieżący miesiąc" with the
 * same days of last month. Managers kept asking "wcześniej, czyli kiedy?".
 */
export function comparisonPhrase(periodLabel: string): string {
  const days = periodLabel.match(/(\d+)\s*dni/i);
  if (days) {
    const n = Number(days[1]);
    return `z poprzednimi ${n} ${n === 1 ? "dniem" : "dniami"}`;
  }
  const l = periodLabel.toLowerCase();
  if (l.includes("bieżący miesiąc")) return "z tymi samymi dniami poprzedniego miesiąca";
  if (l.includes("poprzedni miesiąc")) return "z miesiącem wcześniej";
  return "z okresem tej samej długości tuż przed nim";
}

// Minimum previous spend (grosze) before a spend % is worth saying: 100 zł,
// same cut-off as the KPI tile (MIN_PREV_SPEND in kpi-cards.tsx).
const MIN_PREV_SPEND = 10_000;

export function buildStory({
  kpis,
  trend,
  ecommerce,
  includeSpend = false,
}: {
  kpis: DashboardKpis;
  trend: TrendPoint[];
  /** Pass for e-commerce clients only - engagement clients never see revenue. */
  ecommerce?: EcommerceKpis | null;
  /**
   * Lead with ad spend ("ile wydaliśmy?" is the board's first question). The
   * weekly e-mail shows spend in its own block, so it leaves this off.
   */
  includeSpend?: boolean;
}): Story {
  const impressions = trend.reduce((a, t) => a + t.impressions, 0);
  const clicks = kpis.clicks.value;
  const sessions = kpis.sessions.value;
  const hasSessions = sessions > 0;

  // A period with zero clicks/sessions is a missing source (sync gap, GA4
  // unplugged), not a "-100%" collapse; CPC and CTR of zero clicks would read
  // as "100% cheaper". So every comparison also needs data in this period.
  const adsComparable = clicks > 0 && kpis.clicks.previous >= MIN_BASE.clicks;
  const clicksDelta = adsComparable ? pct(kpis.clicks) : null;
  const sessionsDelta =
    hasSessions && kpis.sessions.previous >= MIN_BASE.sessions ? pct(kpis.sessions) : null;
  const cpcDelta = adsComparable ? pct(kpis.cpcMinorUnits) : null;
  const ctrDelta = adsComparable ? pct(kpis.ctr) : null;

  const facts: StoryFact[] = [];
  const wins: string[] = [];
  let watch: string | null = null;
  let headline: string;

  const revenue = ecommerce?.revenueMinorUnits.value ?? 0;
  const isShop = Boolean(ecommerce) && revenue > 0;

  if (isShop && ecommerce) {
    const orders = ecommerce.transactions.value;
    const roas = ecommerce.roas.value / 100;
    // Revenue, orders and ROAS share one guard, like the tiles: all three
    // swing on one or two baskets when last period had few orders.
    const ordersComparable = ecommerce.transactions.previous >= MIN_BASE.orders;
    const ordersDelta = ordersComparable ? pct(ecommerce.transactions) : null;
    const revenueDelta = ordersComparable ? pct(ecommerce.revenueMinorUnits) : null;
    const roasDelta =
      ordersComparable && ecommerce.roas.previous > 0 ? pct(ecommerce.roas) : null;

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
        change: phraseChange(roasDelta, "more_is_good"),
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
    const clicksText = `${formatNumberPL(clicks)} ${plPlural(
      clicks,
      "kliknięcie",
      "kliknięcia",
      "kliknięć"
    )}`;
    const visitsText = `${formatNumberPL(sessions)} ${plPlural(
      sessions,
      "wizytę",
      "wizyty",
      "wizyt"
    )}`;
    const spend = kpis.spendMinorUnits.value;
    const leadSpend = includeSpend && spend > 0;
    // "Za 43 885 zł reklamy przyciągnęły..." answers "ile wydaliśmy i co mamy".
    const forMoney = leadSpend ? `Za ${formatPlnWhole(spend)} reklamy` : "Reklamy";
    // Each source can be missing on its own (no ads yet, GA4 not synced) -
    // never claim "0 kliknięć" when the honest story is "no ads data yet".
    // Sessions are ALL GA4 visits (organic, direct...), not only the ones ads
    // brought - "reklamy przyciągnęły X wizyt" overstated the ads' effect.
    if (clicks > 0 && hasSessions) {
      headline = `${forMoney} przyciągnęły ${clicksText}, a strona miała łącznie ${visitsText}.`;
    } else if (clicks > 0) {
      headline = `${forMoney} przyciągnęły ${clicksText}.`;
    } else if (hasSessions) {
      headline = `Strona zanotowała ${visitsText}.`;
    } else if (impressions > 0) {
      headline = `Reklamy wyświetliły się ${formatNumberPL(impressions)} ${plPlural(
        impressions,
        "raz",
        "razy",
        "razy"
      )} - czekamy na pierwsze kliknięcia.`;
    } else {
      headline = "Pierwsze dane już spływają.";
    }

    const impressionsText = `${formatCompactPL(impressions)} ${nounFor(
      impressions,
      "wyświetlenia",
      "wyświetleń",
      "wyświetleń"
    )}`;
    if (leadSpend) {
      // Spend replaces the impressions tile; impressions move under clicks
      // ("z 2,2 mln wyświetleń") where they explain the number next to them.
      const spendDelta =
        kpis.spendMinorUnits.previous >= MIN_PREV_SPEND ? pct(kpis.spendMinorUnits) : null;
      facts.push({
        key: "spend",
        value: formatPlnWhole(spend),
        caption: "wydane na reklamy",
        // More spend is neither good nor bad on its own - it's a decision.
        change: phraseChange(spendDelta, "neutral"),
      });
    } else if (impressions > 0) {
      facts.push({
        key: "impressions",
        value: formatCompactPL(impressions),
        caption: `${nounFor(impressions, "wyświetlenie", "wyświetlenia", "wyświetleń")} reklam`,
        change: null,
      });
    }
    if (clicks > 0 || impressions > 0) {
      facts.push({
        key: "clicks",
        value: formatCompactPL(clicks),
        caption: `${nounFor(clicks, "kliknięcie", "kliknięcia", "kliknięć")} w reklamy`,
        change: phraseChange(clicksDelta, "more_is_good"),
        hint: leadSpend && impressions > 0 ? `z ${impressionsText} reklam` : undefined,
      });
    }
    if (hasSessions) {
      facts.push({
        key: "sessions",
        value: formatCompactPL(sessions),
        caption: `${nounFor(sessions, "wizyta", "wizyty", "wizyt")} na stronie`,
        change: phraseChange(sessionsDelta, "more_is_good"),
        hint: leadSpend ? "ze wszystkich źródeł, nie tylko z reklam" : undefined,
      });
    }
    if (kpis.cpcMinorUnits.value > 0) {
      // "Ile nas kosztuje jedna osoba?" - the board thinks in "za 100 zł mamy X".
      const per100 = Math.round(10_000 / kpis.cpcMinorUnits.value);
      facts.push({
        key: "cpc",
        value: formatMoneyPLN(kpis.cpcMinorUnits.value),
        caption: "średni koszt jednego kliknięcia",
        change: phraseChange(cpcDelta, "cost"),
        hint:
          includeSpend && per100 >= 1
            ? `czyli ok. ${formatNumberPL(per100)} ${plPlural(
                per100,
                "kliknięcie",
                "kliknięcia",
                "kliknięć"
              )} za każde 100 zł`
            : undefined,
      });
    }
  }

  // Wins that apply to every client. Changes already shown under the big
  // numbers aren't repeated here - this list is for what the numbers hide.
  const cpcShown = facts.some((f) => f.key === "cpc");
  if (cpcDelta !== null && cpcDelta <= -3 && !cpcShown)
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
      )}% - sprawdzamy, co podbija koszt.`;
  }

  // Nothing synced yet: say so calmly instead of a row of zeros.
  const note =
    facts.length === 0
      ? "Gdy reklamy i Google Analytics zbiorą pierwsze dni danych, pokażemy tu najważniejsze liczby i porównanie z poprzednim okresem. Zajrzyj jutro."
      : null;

  const shown = facts.slice(0, 4);

  return {
    headline,
    facts: shown,
    wins: wins.slice(0, 4),
    watch,
    verdict: buildVerdict(shown, watch),
    note,
  };
}

/**
 * "Czy to dobrze czy źle?" - a manager shouldn't have to add up arrow colours.
 * Counts the judged changes (neutral ones like spend don't vote) and only
 * calls a good period when nothing went the wrong way.
 */
function buildVerdict(facts: StoryFact[], watch: string | null): StoryVerdict | null {
  const judged = facts.filter((f) => f.change);
  if (judged.length === 0) return null;
  const good = judged.filter((f) => f.change?.tone === "good").length;
  const bad = judged.filter((f) => f.change?.tone === "bad").length + (watch ? 1 : 0);
  if (bad === 0 && good >= 2) return { tone: "good", text: "Dobry okres - wyniki lepsze niż wcześniej" };
  if (bad === 0 && good === 1) return { tone: "good", text: "Stabilnie, z jednym plusem" };
  if (bad > good) return { tone: "bad", text: "Słabszy okres - szczegóły niżej" };
  if (bad > 0) return { tone: "flat", text: "Mieszany okres - są plusy i minusy" };
  return { tone: "flat", text: "Stabilnie - podobnie jak wcześniej" };
}
