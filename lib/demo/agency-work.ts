import type { ChartEvent } from "@/lib/dashboard/chart-events";
import type { AgencyWork, AgencyWorkCategory, AgencyWorkEntry } from "@/lib/dashboard/overview";

// Shared by the demo's "Co dla Ciebie zrobiliśmy" card (client component) and
// the presentation story deck (server component), so it lives outside the
// "use client" module. yyyy-MM-dd strings are Warsaw days: UTC maths only.
const DAY_MS = 86_400_000;
const shift = (s: string, n: number) =>
  new Date(new Date(`${s}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

/** Six plausible entries for the public demo, dated relative to `today`. */
export function demoAgencyWork(today: string): { work: AgencyWork; autoEvents: ChartEvent[] } {
  const d = (n: number) => shift(today, -n);
  const entry = (
    id: string,
    days: number,
    category: AgencyWorkCategory,
    title: string,
    description: string | null = null
  ): AgencyWorkEntry => ({
    id,
    date: d(days),
    category,
    title,
    description,
    visibleToClient: true,
  });
  return {
    work: {
      today,
      since: d(29),
      entries: [
        entry(
          "demo-1",
          1,
          "kreacja",
          "Przygotowaliśmy 4 nowe reklamy na jesień",
          "Grafiki z sezonowymi pomidorami i 2 krótkie wideo do kampanii na Facebooku i Instagramie."
        ),
        entry(
          "demo-2",
          3,
          "optymalizacja",
          "Wykluczyliśmy 38 nietrafionych fraz w Google Ads",
          "Reklamy nie wyświetlają się już na zapytania typu „nasiona pomidorów” - budżet idzie na właściwych klientów."
        ),
        entry(
          "demo-3",
          9,
          "strona",
          "Przyspieszyliśmy stronę główną",
          "Czas ładowania na telefonie spadł z 3,8 s do 2,1 s."
        ),
        entry(
          "demo-4",
          16,
          "raport",
          "Raport miesięczny z rekomendacjami na październik"
        ),
      ],
    },
    autoEvents: [
      {
        id: "demo-auto-1",
        // Same days and % as the demo chart's markers (buildDemoChartExtras:
        // 25% / 55% into a 30-day trend) - the two used to disagree.
        date: d(13),
        kind: "budget_up",
        text: "Zwiększono budżet: SPRZEDAŻ | Skrzynki warzyw (Meta, +60%)",
        weight: 1,
      },
      {
        id: "demo-auto-2",
        date: d(22),
        kind: "start",
        text: "Start kampanii: PMAX | Sklep z warzywami (Google)",
        weight: 1,
      },
    ],
  };
}
