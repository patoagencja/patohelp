import { MetricLabel } from "@/components/dashboard/info-tip";
import { MetricTile } from "@/components/dashboard/metric-tile";
import { Pill, type PillProps } from "@/components/ui/pill";
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

  return (
    <section
      aria-label={en ? "Website at a glance" : "Strona w liczbach"}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3"
    >
      <MetricTile
        label={
          <MetricLabel
            name={en ? "Visits" : "Wizyty"}
            explain={
              en
                ? "How many times people opened the website, counted per visit (one person can visit several times)."
                : "Ile razy ktoś wszedł na stronę. Jedna osoba może odwiedzić ją kilka razy - liczymy każdą wizytę."
            }
            lang={lang}
          />
        }
        value={dash(formatNumberPL(totalSessions))}
        // The period sits beside the sparkline, like the overview's deltas.
        delta={
          <p className="text-[13px] leading-snug text-muted-foreground">
            {noVisits ? pending : periodLabel}
          </p>
        }
        sparkline={noVisits ? undefined : sessionsSeries}
      />
      <MetricTile
        label={
          <MetricLabel
            name={en ? "Engaged visits" : "Zainteresowani"}
            explain={
              en
                ? "Visits that lasted 10s+, viewed 2+ pages or included an action."
                : "Wizyty, w których ktoś był dłużej niż 10 s, obejrzał 2+ podstrony albo coś kliknął."
            }
            lang={lang}
          />
        }
        value={dash(formatPercent(engagement.engagementRate, 0))}
      >
        {verdict ? (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
            <Pill tone={verdict.tone}>{verdict.pill}</Pill>
            <span>{verdict.text}</span>
          </p>
        ) : (
          <p className="text-muted-foreground">{pending}</p>
        )}
      </MetricTile>
      <MetricTile
        // Third tile spans both columns on phones so the row doesn't end
        // with a lonely half-width card.
        className="col-span-2 lg:col-span-1"
        label={
          <MetricLabel
            name={en ? "Visits per day" : "Wizyt dziennie"}
            explain={
              en
                ? "Average number of visits per day in the period."
                : "Średnia liczba wizyt na dzień w tym okresie."
            }
            lang={lang}
          />
        }
        value={dash(formatNumberPL(engagement.avgDailySessions))}
      >
        <p className="text-muted-foreground">
          {noVisits ? pending : en ? "on average" : "średnio każdego dnia"}
        </p>
      </MetricTile>
    </section>
  );
}
