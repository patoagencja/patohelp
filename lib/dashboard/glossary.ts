// Plain-language dictionary for every metric a client can see. The people
// reading the dashboard are marketing managers presenting to their board, not
// ad specialists - so every KPI gets a friendly name, an optional jargon tag
// (kept small, because agencies and platforms still use it) and a one-breath
// explanation with a concrete example.

export type GlossaryKey =
  | "spend"
  | "clicks"
  | "sessions"
  | "ctr"
  | "cpc"
  | "conversions"
  | "impressions"
  | "reach"
  | "frequency"
  | "cpm"
  | "revenue"
  | "transactions"
  | "roas"
  | "aov"
  | "engagementRate"
  | "poas";

/** Which way of moving is good news for the client. */
export type GoodWhen = "higher" | "lower" | "neutral";

export interface GlossaryEntry {
  /** Friendly Polish name used as the card label. */
  name: string;
  /** Industry abbreviation shown as a small muted tag, or null. */
  short: string | null;
  /** 1-2 plain-Polish sentences with a concrete example. */
  explain: string;
  goodWhen: GoodWhen;
  /** English copy for the `lang="en"` demo pages. */
  /** English copy for the `lang="en"` demo pages; `short` overrides the tag. */
  en: { name: string; explain: string; short?: string };
}

export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  spend: {
    name: "Wydatki na reklamy",
    short: null,
    explain:
      "Ile wydaliśmy na same reklamy w Meta i Google w wybranym okresie. Np. 3 000 zł = tyle zapłacono platformom za wyświetlanie reklam.",
    goodWhen: "neutral",
    en: {
      name: "Ad spend",
      explain:
        "How much was paid to Meta and Google for showing the ads in this period. E.g. 3,000 zł = what the platforms charged.",
    },
  },
  clicks: {
    name: "Kliknięcia w reklamy",
    short: null,
    explain:
      "Ile razy ktoś kliknął reklamę i przeszedł dalej, np. na stronę. 500 kliknięć = 500 razy reklama zaciekawiła kogoś na tyle, że w nią kliknął.",
    goodWhen: "higher",
    en: {
      name: "Ad clicks",
      explain:
        "How many times someone clicked an ad and moved on, e.g. to the website. 500 clicks = 500 times an ad was interesting enough to click.",
    },
  },
  sessions: {
    name: "Wizyty na stronie",
    short: "GA4",
    explain:
      "Ile razy ktoś odwiedził stronę - z reklam, wyszukiwarki, social mediów lub wpisując adres. Jedna osoba, która wróci następnego dnia, to 2 wizyty.",
    goodWhen: "higher",
    en: {
      name: "Website visits",
      explain:
        "How many times someone visited the website - from ads, search, social media or typing the address. One person coming back the next day = 2 visits.",
    },
  },
  ctr: {
    name: "Klikalność",
    short: "CTR",
    explain:
      "Ile osób na 100, które zobaczyły reklamę, w nią kliknęło. 2% = 2 osoby na 100.",
    goodWhen: "higher",
    en: {
      name: "Click-through rate",
      explain:
        "How many people out of 100 who saw the ad clicked it. 2% = 2 people out of 100.",
    },
  },
  cpc: {
    name: "Koszt kliknięcia",
    short: "CPC",
    explain:
      "Ile średnio płacimy za jedno kliknięcie w reklamę. 1,50 zł = za 100 kliknięć płacimy 150 zł. Im taniej, tym lepiej.",
    goodWhen: "lower",
    en: {
      name: "Cost per click",
      explain:
        "What one click on an ad costs on average. 1.50 zł = 100 clicks cost 150 zł. Cheaper is better.",
    },
  },
  conversions: {
    name: "Działania na stronie",
    // The tag wrapped under the label on narrow cards; the ⓘ explains it.
    short: null,
    explain:
      "Ile razy ktoś zrobił na stronie coś ważnego dla firmy, np. wysłał formularz albo kliknął numer telefonu. 20 = 20 takich zgłoszeń lub kontaktów.",
    goodWhen: "higher",
    en: {
      name: "Key actions",
      short: "Conversions",
      explain:
        "How many times someone did something valuable on the website, e.g. sent a form or tapped the phone number. 20 = 20 such leads or contacts.",
    },
  },
  impressions: {
    name: "Wyświetlenia reklam",
    short: null,
    explain:
      "Ile razy reklama pojawiła się na czyimś ekranie. Jedna osoba może zobaczyć ją kilka razy - każde wyświetlenie liczy się osobno.",
    goodWhen: "higher",
    en: {
      name: "Ad impressions",
      explain:
        "How many times an ad appeared on someone's screen. One person can see it several times - each view counts separately.",
    },
  },
  reach: {
    name: "Zasięg",
    short: null,
    explain:
      "Ile różnych osób zobaczyło reklamę przynajmniej raz. 10 000 = 10 tys. różnych ludzi, niezależnie od tego, ile razy każdy ją widział.",
    goodWhen: "higher",
    en: {
      name: "Reach",
      explain:
        "How many different people saw the ad at least once. 10,000 = 10k different people, however many times each saw it.",
    },
  },
  frequency: {
    name: "Częstotliwość",
    short: null,
    explain:
      "Ile razy średnio jedna osoba widziała reklamę. 3 = każdy widział ją ok. 3 razy; przy 6 i więcej reklama może zacząć nużyć.",
    goodWhen: "neutral",
    en: {
      name: "Frequency",
      explain:
        "How many times one person saw the ad on average. 3 = about 3 times each; at 6+ people may start tuning it out.",
    },
  },
  cpm: {
    name: "Koszt 1000 wyświetleń",
    short: "CPM",
    explain:
      "Ile kosztuje pokazanie reklamy 1000 razy. 20 zł = za każde 1000 wyświetleń płacimy 20 zł. Im taniej, tym lepiej.",
    goodWhen: "lower",
    en: {
      name: "Cost per 1,000 impressions",
      explain:
        "What it costs to show the ad 1,000 times. 20 zł = every 1,000 views cost 20 zł. Cheaper is better.",
    },
  },
  revenue: {
    name: "Przychód",
    short: null,
    explain:
      "Łączna wartość zamówień złożonych w sklepie internetowym w wybranym okresie, zmierzona przez Google Analytics.",
    goodWhen: "higher",
    en: {
      name: "Revenue",
      explain:
        "Total value of orders placed in the online store in this period, as measured by Google Analytics.",
    },
  },
  transactions: {
    name: "Zamówienia",
    short: null,
    explain:
      "Ile zamówień złożono w sklepie internetowym. 120 = 120 opłaconych koszyków.",
    goodWhen: "higher",
    en: {
      name: "Orders",
      explain: "How many orders were placed in the online store. 120 = 120 paid checkouts.",
    },
  },
  roas: {
    name: "Zwrot z reklam",
    short: "ROAS",
    explain:
      "Ile złotych sprzedaży przyniosła każda 1 zł wydana na reklamy. 5× = z każdej 1 zł na reklamy wróciło 5 zł przychodu.",
    goodWhen: "higher",
    en: {
      name: "Return on ad spend",
      explain:
        "How many złoty of sales each 1 zł spent on ads brought in. 5× = every 1 zł on ads returned 5 zł of revenue.",
    },
  },
  aov: {
    name: "Średnia wartość zamówienia",
    short: "AOV",
    explain:
      "Ile średnio wydaje klient w jednym zamówieniu. 250 zł = przeciętny koszyk jest wart 250 zł.",
    goodWhen: "higher",
    en: {
      name: "Average order value",
      explain:
        "How much a customer spends per order on average. 250 zł = the typical basket is worth 250 zł.",
    },
  },
  engagementRate: {
    name: "Zainteresowani goście",
    short: null,
    explain:
      "Jaka część wizyt to prawdziwe zainteresowanie: ktoś został dłużej niż 10 sekund, obejrzał 2+ podstrony lub wykonał ważną akcję. 60% = 6 na 10 wizyt.",
    goodWhen: "higher",
    en: {
      name: "Engagement rate",
      explain:
        "Share of visits with real interest: 10+ seconds on site, 2+ pages viewed or a key action. 60% = 6 out of 10 visits.",
    },
  },
  poas: {
    name: "Zysk z reklam",
    short: "POAS",
    explain:
      "Ile złotych zysku (po odjęciu kosztu towaru) przyniosła każda 1 zł wydana na reklamy. Powyżej 1× reklamy na siebie zarabiają.",
    goodWhen: "higher",
    en: {
      name: "Profit on ad spend",
      explain:
        "How many złoty of profit (after cost of goods) each 1 zł on ads brought in. Above 1× the ads pay for themselves.",
    },
  },
};

/** How a change should be phrased: volumes, prices or rates. */
export type ChangeTone = "amount" | "cost" | "rate";

// Below this many percent the move is noise for a board-level reader, so we
// say "about the same" instead of quoting a number.
const FLAT_THRESHOLD = 3;

/**
 * Turn a period-over-period delta into one plain sentence, e.g.
 * "o 16% więcej niż wcześniej" or "o 7% taniej niż wcześniej".
 * `thinBase` short-circuits to "not enough data" - +300% on 4 clicks is
 * technically true but misleading in a board meeting.
 */
export function describeChange(
  deltaPercent: number | null,
  tone: ChangeTone,
  opts: { thinBase?: boolean; lang?: "pl" | "en" } = {}
): string {
  const en = opts.lang === "en";
  // Infinity/NaN come from a zero baseline - same meaning as "no data".
  if (deltaPercent === null || !Number.isFinite(deltaPercent)) {
    return en ? "no data for the previous period" : "brak danych z poprzedniego okresu";
  }
  if (opts.thinBase) {
    return en ? "not enough data to compare" : "za mało danych do porównania";
  }
  if (Math.abs(deltaPercent) < FLAT_THRESHOLD) {
    return en ? "about the same as before" : "podobnie jak wcześniej";
  }
  const pct = `${Math.round(Math.abs(deltaPercent)).toLocaleString(en ? "en-GB" : "pl-PL")}%`;
  const up = deltaPercent > 0;
  if (tone === "cost") {
    return en
      ? `${pct} ${up ? "pricier" : "cheaper"} than before`
      : `o ${pct} ${up ? "drożej" : "taniej"} niż wcześniej`;
  }
  if (tone === "rate") {
    return en
      ? `${pct} ${up ? "higher" : "lower"} than before`
      : `o ${pct} ${up ? "wyżej" : "niżej"} niż wcześniej`;
  }
  return en
    ? `${pct} ${up ? "more" : "less"} than the previous period`
    : `o ${pct} ${up ? "więcej" : "mniej"} niż wcześniej`;
}
