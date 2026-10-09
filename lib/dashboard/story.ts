import type {
  DashboardKpis,
  EcommerceKpis,
  Kpi,
  TrendPoint,
} from "@/lib/dashboard/metrics";
import type { EngagementYoY } from "@/lib/dashboard/yoy";
import {
  formatMoneyPLN,
  formatNumberPL,
  formatPlnWhole,
  formatSignedPct,
} from "@/lib/utils";

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
  /** Same days a year earlier, already phrased ("rok temu: 31 200 (+16%)"). */
  yoy?: string;
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
  /** Last year's window when at least one fact carries a "rok temu" line. */
  yearAgo?: { start: string; end: string } | null;
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
  if (l.includes("ostatni rok")) return "z rokiem wcześniej";
  if (l.includes("bieżący miesiąc")) return "z tymi samymi dniami poprzedniego miesiąca";
  if (l.includes("poprzedni miesiąc")) return "z miesiącem wcześniej";
  return "z okresem tej samej długości tuż przed nim";
}

// Minimum previous spend (grosze) before a spend % is worth saying: 100 zł,
// same cut-off as the KPI tile (MIN_PREV_SPEND in kpi-cards.tsx).
const MIN_PREV_SPEND = 10_000;

// Same thin-base idea for last year: below these a % is noise, so only the
// raw number is shown. Impressions swing hard on tiny bases, hence 1000.
const MIN_YOY = {
  spend: MIN_PREV_SPEND,
  clicks: MIN_BASE.clicks,
  sessions: MIN_BASE.sessions,
  impressions: 1_000,
};

/**
 * When the period ends today, today's partial value and the day count: the
 * % then compares the finished days' per-day rate with last year's (whose
 * matching day is complete), like the period-over-period deltas do.
 */
type YoyPartial = { todayPart: number; days: number } | null;

/** % change vs last year, or null when either side can't carry one. */
function yoyPct(
  current: number,
  lastYear: number | null | undefined,
  min: number,
  partial: YoyPartial = null
): number | null {
  if (lastYear == null || lastYear < min || current <= 0) return null;
  if (partial && partial.days > 1) {
    const rate = (current - partial.todayPart) / (partial.days - 1);
    const lyRate = lastYear / partial.days;
    return ((rate - lyRate) / lyRate) * 100;
  }
  return ((current - lastYear) / lastYear) * 100;
}

/** "rok temu: 31 200 (+16%)"; the % is dropped on a thin base. */
function yoyLine(
  current: number,
  lastYear: number | null | undefined,
  min: number,
  format: (v: number) => string,
  partial: YoyPartial = null
): string | undefined {
  // No last-year number, or nothing this period to compare it with.
  if (lastYear == null || lastYear <= 0 || current <= 0) return undefined;
  const p = yoyPct(current, lastYear, min, partial);
  return `rok temu: ${format(lastYear)}${p === null ? "" : ` (${formatSignedPct(p / 100)})`}`;
}

export function buildStory({
  kpis,
  trend,
  ecommerce,
  includeSpend = false,
  yoy = null,
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
  /**
   * Same window a year earlier (getEngagementYoY). Adds a "rok temu" line per
   * fact and a good-news item; the weekly e-mail leaves it out.
   */
  yoy?: EngagementYoY | null;
}): Story {
  const impressions = trend.reduce((a, t) => a + t.impressions, 0);
  // Today's partial day, when the YoY window ends today (see YoyPartial).
  const lastPoint = yoy?.endsToday ? trend[trend.length - 1] : undefined;
  const partialOf = (pick: (t: TrendPoint) => number): YoyPartial =>
    lastPoint ? { todayPart: pick(lastPoint), days: trend.length } : null;
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
        yoy: yoyLine(sessions, yoy?.sessions, MIN_YOY.sessions, formatCompactPL, partialOf((t) => t.sessions)),
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
        yoy: yoyLine(spend, yoy?.spendMinorUnits, MIN_YOY.spend, formatPlnWhole, partialOf((t) => t.spendMinorUnits)),
      });
    } else if (impressions > 0) {
      facts.push({
        key: "impressions",
        value: formatCompactPL(impressions),
        caption: `${nounFor(impressions, "wyświetlenie", "wyświetlenia", "wyświetleń")} reklam`,
        change: null,
        yoy: yoyLine(impressions, yoy?.impressions, MIN_YOY.impressions, formatCompactPL, partialOf((t) => t.impressions)),
      });
    }
    if (clicks > 0 || impressions > 0) {
      facts.push({
        key: "clicks",
        value: formatCompactPL(clicks),
        caption: `${nounFor(clicks, "kliknięcie", "kliknięcia", "kliknięć")} w reklamy`,
        change: phraseChange(clicksDelta, "more_is_good"),
        hint: leadSpend && impressions > 0 ? `z ${impressionsText} reklam` : undefined,
        yoy: yoyLine(clicks, yoy?.clicks, MIN_YOY.clicks, formatCompactPL, partialOf((t) => t.clicks)),
      });
    }
    if (hasSessions) {
      facts.push({
        key: "sessions",
        value: formatCompactPL(sessions),
        caption: `${nounFor(sessions, "wizyta", "wizyty", "wizyt")} na stronie`,
        change: phraseChange(sessionsDelta, "more_is_good"),
        hint: leadSpend ? "ze wszystkich źródeł, nie tylko z reklam" : undefined,
        yoy: yoyLine(sessions, yoy?.sessions, MIN_YOY.sessions, formatCompactPL, partialOf((t) => t.sessions)),
      });
    }
    if (kpis.cpcMinorUnits.value > 0) {
      // "Ile nas kosztuje jedna osoba?" - the board thinks in "za 100 zł mamy X".
      const per100 = Math.round(10_000 / kpis.cpcMinorUnits.value);
      // Last year's CPC only from a solid click base - 3 clicks give any CPC.
      const lyCpc =
        yoy?.spendMinorUnits != null && yoy.clicks != null && yoy.clicks >= MIN_YOY.clicks
          ? yoy.spendMinorUnits / yoy.clicks
          : null;
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
        yoy: yoyLine(kpis.cpcMinorUnits.value, lyCpc, 0, formatMoneyPLN),
      });
    }
  }

  // A year-on-year jump is the strongest good news (seasonality can't explain
  // it away), so it leads. Visits first: they matter more than clicks.
  const sessionsYoY = hasSessions
    ? yoyPct(sessions, yoy?.sessions, MIN_YOY.sessions, partialOf((t) => t.sessions))
    : null;
  const clicksYoY =
    clicks > 0 ? yoyPct(clicks, yoy?.clicks, MIN_YOY.clicks, partialOf((t) => t.clicks)) : null;
  if (sessionsYoY !== null && sessionsYoY >= 10)
    wins.push(`Wizyt na stronie o ${Math.round(sessionsYoY)}% więcej niż rok temu.`);
  else if (clicksYoY !== null && clicksYoY >= 10)
    wins.push(`Kliknięć w reklamy o ${Math.round(clicksYoY)}% więcej niż rok temu.`);

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
    yearAgo:
      yoy && shown.some((f) => f.yoy) ? { start: yoy.lyStart, end: yoy.lyEnd } : null,
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

export type OverviewStatusTone = "good" | "warn" | "bad" | "neutral";

/** The one status pill on the overview: "is it working, do I need to act?" */
export interface OverviewStatus {
  tone: OverviewStatusTone;
  text: string;
}

/**
 * Folds the three "health" signals the overview used to show separately (the
 * period verdict, the alerts digest and the daily score) into one phrase.
 * Open alerts win: they are the only thing that asks the client to look at
 * something. `attention` counts alerts worth a look (not the FYI ones).
 */
export function overviewStatus(
  story: Story,
  alerts: { attention: number; urgent: boolean } | null
): OverviewStatus {
  if (alerts && alerts.attention > 0) {
    const n = alerts.attention;
    const what = `${n} ${plPlural(n, "rzecz", "rzeczy", "rzeczy")} do sprawdzenia`;
    // "Pilne: 2 rzeczy" called both urgent when one was only worth a look.
    return alerts.urgent
      ? { tone: "bad", text: n === 1 ? `Pilne: ${what}` : `${what}, w tym pilne` }
      : { tone: "warn", text: what };
  }
  if (story.facts.length === 0) return { tone: "neutral", text: "Czekamy na pierwsze dane" };
  const v = story.verdict;
  // No verdict = nothing comparable yet (new client, thin base). Then only a
  // clean alert scan can vouch for the period; "Wszystko idzie dobrze" with
  // neither a comparison nor a scan claimed something we didn't check.
  if (!v) {
    return alerts
      ? { tone: "good", text: "Bez niepokojących sygnałów" }
      : { tone: "neutral", text: "Za mało danych do porównania" };
  }
  if (v.tone === "good") return { tone: "good", text: "Wszystko idzie dobrze" };
  if (v.tone === "bad") return { tone: "warn", text: "Słabszy okres niż poprzedni" };
  // "flat" covers both "nothing changed" and "plusy i minusy".
  const mixed = story.facts.some((f) => f.change?.tone === "bad") || Boolean(story.watch);
  return mixed
    ? { tone: "neutral", text: "Są plusy i minusy" }
    : { tone: "good", text: "Stabilnie, bez niespodzianek" };
}
