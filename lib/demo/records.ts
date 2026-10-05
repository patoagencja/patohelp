import { format, subDays } from "date-fns";

import type { RecordItem } from "@/lib/dashboard/records";

/**
 * Hand-written records for the public demo. Written in the exact shape and
 * tone computeRecords() produces, with dates relative to today so the demo
 * never shows a stale "milestone".
 */
export function getDemoRecords(
  opts: { ecommerce?: boolean; today?: Date } = {}
): RecordItem[] {
  const today = opts.today ?? new Date();
  const day = (n: number) => format(subDays(today, n), "yyyy-MM-dd");
  const year = format(today, "yyyy");

  if (opts.ecommerce) {
    return [
      {
        id: "month-revenue",
        icon: "trophy",
        title: "Rekordowy miesiąc sprzedaży: 412 380 zł",
        detail:
          "Poprzedni miesiąc to najwięcej sprzedaży (wg GA4) w jednym miesiącu od początku danych w panelu - o 14% więcej niż poprzedni rekord.",
        achievedOn: day(4),
      },
      {
        id: "ytd-orders",
        icon: "flag",
        title: `2500. zamówienie w ${year} roku`,
        detail:
          "Od 1 stycznia sklep przyjął już 2531 zamówień (wg GA4) - próg 2500 zamówień padł kilka dni temu.",
        achievedOn: day(3),
      },
      {
        id: "cpc-90d",
        icon: "sparkles",
        title: "Najtańsze kliknięcie od 90 dni: 0,64 zł",
        detail:
          "Średni koszt kliknięcia z ostatnich 7 dni (3214 kliknięć) jest najniższy spośród wszystkich 7-dniowych okresów z ostatnich 90 dni i o 19% niższy niż średnia z tego czasu.",
        achievedOn: day(1),
      },
      {
        id: "month-sessions",
        icon: "trending",
        title: "Najlepszy miesiąc od grudnia: 48 112 wizyt na stronie",
        detail:
          "Więcej wizyt na stronie niż w każdym z 8 poprzednich miesięcy z danymi.",
        achievedOn: day(4),
      },
    ];
  }

  return [
    {
      id: "week-sessions",
      icon: "trophy",
      title: "Rekordowy tydzień: 9412 wizyt na stronie",
      detail:
        "Miniony tydzień przyniósł najwięcej wizyt na stronie w jednym tygodniu od początku danych w panelu. Poprzedni rekord: 8873 wizyty (teraz o 6% więcej).",
      achievedOn: day(2),
    },
    {
      id: "month-clicks",
      icon: "trending",
      title: "Najlepszy miesiąc od marca: 12 344 kliknięcia w reklamy",
      detail:
        "Więcej kliknięć w reklamy niż w każdym z 6 poprzednich miesięcy z danymi.",
      achievedOn: day(4),
    },
    {
      id: "cpc-90d",
      icon: "sparkles",
      title: "Najtańsze kliknięcie od 90 dni: 0,71 zł",
      detail:
        "Średni koszt kliknięcia z ostatnich 7 dni (2862 kliknięcia) jest najniższy spośród wszystkich 7-dniowych okresów z ostatnich 90 dni i o 17% niższy niż średnia z tego czasu.",
      achievedOn: day(1),
    },
    {
      id: "ytd-impressions",
      icon: "flag",
      title: `Przekroczyliśmy 1 mln wyświetleń reklam w ${year} roku`,
      detail:
        "Od 1 stycznia Wasze reklamy zebrały 1 018 452 wyświetlenia - próg 1 mln padł kilka dni temu.",
      achievedOn: day(5),
    },
  ];
}
