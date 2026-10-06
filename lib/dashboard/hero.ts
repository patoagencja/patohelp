import type { DashboardKpis, EcommerceKpis } from "@/lib/dashboard/metrics";
import { plPlural } from "@/lib/dashboard/story";
import { formatNumberPL } from "@/lib/utils";

/**
 * The overview hero (Przeglad-pastel): one giant number and one sentence
 * with the two figures that explain it highlighted. Plain data so a server
 * component can build it and a client component can count it up.
 *
 * Honesty rules carried over from story.ts: engagement clients never see
 * revenue; GA4 sessions are ALL visits (not only the ones ads brought), so
 * the sentence says "strona miała łącznie", not "reklamy przyniosły wizyty".
 */
export interface HeroFigures {
  /** The giant number, already rounded (whole złoty / count). */
  value: number;
  /** Small unit after it ("zł") or null. */
  unit: string | null;
  /** Sentence after the number; `hl` parts are highlighted. */
  parts: Array<string | { hl: string }>;
  /** Screen-reader sentence (number + words in one line). */
  label: string;
}

const clicksWord = (n: number) => plPlural(n, "kliknięcie", "kliknięcia", "kliknięć");
const visitsWord = (n: number) => plPlural(n, "wizytę", "wizyty", "wizyt");
const ordersWord = (n: number) => plPlural(n, "zamówienia", "zamówień", "zamówień");

function flatten(value: number, unit: string | null, parts: HeroFigures["parts"]): string {
  const words = parts.map((p) => (typeof p === "string" ? p : p.hl)).join("");
  return `${formatNumberPL(value)}${unit ? ` ${unit}` : ""} ${words}`.replace(/\s+/g, " ").trim();
}

/** Null when there is nothing to show yet (the story's note covers it). */
export function buildHero({
  kpis,
  ecommerce,
}: {
  kpis: DashboardKpis;
  /** Shops only - pass null for engagement clients. */
  ecommerce?: EcommerceKpis | null;
}): HeroFigures | null {
  const clicks = kpis.clicks.value;
  const sessions = kpis.sessions.value;
  const spend = Math.round(kpis.spendMinorUnits.value / 100);
  const revenue = ecommerce ? Math.round(ecommerce.revenueMinorUnits.value / 100) : 0;

  let value: number;
  let unit: string | null;
  let parts: HeroFigures["parts"];

  if (ecommerce && revenue > 0) {
    const orders = ecommerce.transactions.value;
    value = revenue;
    unit = "zł";
    parts = [
      "sprzedaży w sklepie z ",
      { hl: `${formatNumberPL(orders)} ${ordersWord(orders)}` },
      ...(sessions > 0
        ? [" przy ", { hl: `${formatNumberPL(sessions)} ${plPlural(sessions, "wizycie", "wizytach", "wizytach")}` }, " na stronie."]
        : ["."]),
    ];
  } else if (spend > 0) {
    value = spend;
    unit = "zł";
    if (clicks > 0 && sessions > 0) {
      parts = [
        "wydanych na reklamy przyniosło ",
        { hl: `${formatNumberPL(clicks)} ${clicksWord(clicks)}` },
        ", a strona miała łącznie ",
        { hl: `${formatNumberPL(sessions)} ${visitsWord(sessions)}` },
        ".",
      ];
    } else if (clicks > 0) {
      parts = ["wydanych na reklamy przyniosło ", { hl: `${formatNumberPL(clicks)} ${clicksWord(clicks)}` }, "."];
    } else {
      parts = ["wydanych na reklamy - czekamy na pierwsze kliknięcia."];
    }
  } else if (sessions > 0) {
    value = sessions;
    unit = null;
    parts = [
      `${plPlural(sessions, "wizyta", "wizyty", "wizyt")} na stronie`,
      ...(clicks > 0 ? [" i ", { hl: `${formatNumberPL(clicks)} ${clicksWord(clicks)}` }, " w reklamy."] : [" w tym okresie."]),
    ];
  } else {
    return null;
  }
  return { value, unit, parts, label: flatten(value, unit, parts) };
}

const MONTHS_NOM = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
];

/** "Październik 2026 · ostatnie 30 dni" from today's Warsaw date + range. */
export function heroKicker(todayIso: string, periodLabel: string): string {
  const [y, m] = todayIso.split("-").map(Number);
  const month = MONTHS_NOM[(m || 1) - 1];
  return `${month} ${y} · ${periodLabel.charAt(0).toLowerCase()}${periodLabel.slice(1)}`;
}
