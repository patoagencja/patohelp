import { StatTile } from "@/components/dashboard/stat-tile";
import type { PillProps } from "@/components/ui/pill";
import { Ping } from "@/components/ui/primitives";
import { formatNumberPL, formatPercent } from "@/lib/utils";

// GA4's "engagement rate" means nothing to a marketing manager; the tile says
// what the number is about (ⓘ) and whether it's good (pill + a few words).
// TODO: avg session duration (not stored in ga4_daily yet).

function engagedVerdict(
  rate: number,
  en: boolean
): { pill: string; text: string; tone: PillProps["tone"] } {
  if (rate >= 60)
    return en
      ? { pill: "Great", text: "most visitors are genuinely interested", tone: "positive" }
      : { pill: "Świetnie", text: "większość gości naprawdę się interesuje", tone: "positive" };
  if (rate >= 45)
    return en
      ? { pill: "Good", text: "about half of visitors stay longer", tone: "positive" }
      : { pill: "Dobrze", text: "około połowy gości zostaje na dłużej", tone: "positive" };
  return en
    ? { pill: "Check", text: "many visitors leave quickly", tone: "warning" }
    : { pill: "Do sprawdzenia", text: "sporo osób szybko wychodzi", tone: "warning" };
}

/** The website page's KPI row: visits, engaged visitors, visits per day. */
export function WebsiteKpis({
  engagement,
  totalSessions,
  periodLabel,
  sessionsSeries,
  lang = "pl",
}: {
  /** Daily visits, oldest -> newest: drawn as the Wizyty tile's sparkline. */
  sessionsSeries?: number[];
  engagement: {
    engagementRate: number;
    bounceRate: number;
    avgDailySessions: number;
  };
  /** All visits in the window (sum of the daily trend). */
  totalSessions: number;
  /** "ostatnie 30 dni" - the window the numbers cover. */
  periodLabel: string;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  // Rates over zero visits are undefined: GA4 sends breakdown rows before the
  // daily totals land, and "0% zainteresowanych" would be a false alarm. Show
  // dashes and say when the numbers arrive.
  const noVisits = engagement.avgDailySessions <= 0 && totalSessions <= 0;
  const pending = en
    ? "Appears after the first Google Analytics sync."
    : "Pojawi się po pierwszej synchronizacji Google Analytics.";
  const verdict = noVisits ? null : engagedVerdict(engagement.engagementRate, en);
  const dash = (v: string) => (noVisits ? "-" : v);

  const peak = !noVisits && sessionsSeries?.length ? Math.max(...sessionsSeries) : null;
  // Phones: a swipeable row like the overview's tiles; a grid from sm.
  const tile = "w-[15rem] shrink-0 snap-start sm:w-auto";

  return (
    <section
      aria-label={en ? "Website at a glance" : "Strona w liczbach"}
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 pt-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:snap-none sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0"
    >
      <StatTile
        className={tile}
        index={0}
        highlight={!noVisits}
        lang={lang}
        label={en ? "Visits" : "Wizyty"}
        explain={
          en
            ? "How many times people opened the website, counted per visit (one person can visit several times)."
            : "Ile razy ktoś wszedł na stronę. Jedna osoba może odwiedzić ją kilka razy - liczymy każdą wizytę."
        }
        value={dash(formatNumberPL(totalSessions))}
        spark={noVisits ? undefined : sessionsSeries}
        sub={noVisits ? pending : periodLabel}
      />
      <StatTile
        className={tile}
        index={1}
        lang={lang}
        label={en ? "Engaged visits" : "Zainteresowani"}
        explain={
          en
            ? "Visits that lasted 10s+, viewed 2+ pages or included an action."
            : "Wizyty, w których ktoś był dłużej niż 10 s, obejrzał 2+ podstrony albo coś kliknął."
        }
        value={dash(formatPercent(engagement.engagementRate, 0))}
        meter={noVisits ? null : engagement.engagementRate / 100}
        sub={
          verdict ? (
            <span className="flex items-start gap-2">
              <Ping tone={verdict.tone === "warning" ? "amber" : "lime"} still className="mt-[5px]" />
              <span>
                <b className="font-medium text-foreground">{verdict.pill}</b> · {verdict.text}
              </span>
            </span>
          ) : (
            pending
          )
        }
      />
      <StatTile
        className={tile}
        index={2}
        lang={lang}
        label={en ? "Visits per day" : "Wizyt dziennie"}
        explain={
          en
            ? "Average number of visits per day in the period."
            : "Średnia liczba wizyt na dzień w tym okresie."
        }
        value={dash(formatNumberPL(engagement.avgDailySessions))}
        sub={noVisits ? pending : en ? "on average" : "średnio każdego dnia"}
        foot={
          peak !== null && peak > 0 ? (
            <span className="tabular-nums">
              {en ? "busiest day: " : "najwięcej jednego dnia: "}
              <b className="font-medium text-foreground">{formatNumberPL(peak)}</b>
            </span>
          ) : undefined
        }
      />
    </section>
  );
}
