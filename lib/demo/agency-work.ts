import type { ChartEvent } from "@/lib/dashboard/chart-events";
import type { AgencyWork, AgencyWorkCategory, AgencyWorkEntry } from "@/lib/dashboard/overview";
import { addDaysIso } from "@/lib/demo/profile/anonymize";

// "Co dla Ciebie zrobiliśmy" on the demo, shared by the overview card and the
// presentation story deck. The automatic entries are the campaign starts,
// pauses and budget changes the chart marks (lib/demo/dashboard.ts,
// demoCampaignEvents) - passed in, so the two can't disagree. The hand-written
// ones describe agency work, not the shop's numbers.

/** Four plausible entries for the demo shop, dated relative to `today`. */
export function demoAgencyWork(today: string, autoEvents: ChartEvent[]): { work: AgencyWork; autoEvents: ChartEvent[] } {
  const entry = (
    id: string,
    days: number,
    category: AgencyWorkCategory,
    title: string,
    description: string | null = null
  ): AgencyWorkEntry => ({
    id,
    date: addDaysIso(today, -days),
    category,
    title,
    description,
    visibleToClient: true,
  });
  return {
    work: {
      today,
      since: addDaysIso(today, -29),
      entries: [
        entry(
          "demo-1",
          1,
          "kreacja",
          "Przygotowaliśmy nowe reklamy na Black Friday",
          "Wideo z rozpakowaniem telewizora i karuzele z ratami 0% na duże AGD, na Facebooka i Instagrama."
        ),
        entry(
          "demo-2",
          3,
          "optymalizacja",
          "Wykluczyliśmy nietrafione frazy w Google Ads",
          "Reklamy nie wyświetlają się już na zapytania typu „naprawa pralki” czy „instrukcja obsługi telewizora” - budżet idzie na osoby, które chcą kupić."
        ),
        entry(
          "demo-3",
          9,
          "strona",
          "Dodaliśmy na kartach produktów termin dostawy przed Świętami",
          "Klient od razu widzi, czy sprzęt dotrze przed Wigilią, razem z informacją o wniesieniu i montażu."
        ),
        entry("demo-4", 16, "raport", "Raport miesięczny z planem na Black Friday i grudzień"),
      ],
    },
    autoEvents,
  };
}
