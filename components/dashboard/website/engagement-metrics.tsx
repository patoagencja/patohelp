import { Card, Grid } from "@tremor/react";
import { CalendarDays, DoorOpen, HeartHandshake } from "lucide-react";

import { cn, formatNumberPL, formatPercent } from "@/lib/utils";

// GA4's "engagement rate" / "bounce rate" mean nothing to a marketing manager;
// each tile says what the number is about and what it implies.
// TODO: avg session duration (not stored in ga4_daily yet).

function engagedVerdict(rate: number): { text: string; tone: string } {
  if (rate >= 60)
    return { text: "Świetnie - większość gości naprawdę się interesuje.", tone: "text-emerald-600 dark:text-emerald-400" };
  if (rate >= 45)
    return { text: "Dobrze - około połowy gości zostaje na dłużej.", tone: "text-emerald-600 dark:text-emerald-400" };
  return { text: "Sporo osób szybko wychodzi - pracujemy nad dopasowaniem ruchu.", tone: "text-amber-600 dark:text-amber-400" };
}

export function EngagementMetrics({
  engagement,
  lang = "pl",
}: {
  engagement: {
    engagementRate: number;
    bounceRate: number;
    avgDailySessions: number;
  };
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  // Rates over zero visits are undefined: GA4 sends breakdown rows before the
  // daily totals land, and "0% zainteresowanych, 100% wyjść" would be a false
  // alarm. Show dashes and say when the numbers arrive.
  const noVisits = engagement.avgDailySessions <= 0;
  const verdict = noVisits
    ? {
        text: en
          ? "Appears after the first Google Analytics sync."
          : "Pojawi się po pierwszej synchronizacji Google Analytics.",
        tone: "text-muted-foreground",
      }
    : engagedVerdict(engagement.engagementRate);
  const dashIfEmpty = (v: string) => (noVisits ? "-" : v);
  const tiles = [
    {
      icon: HeartHandshake,
      label: en ? "Engaged visits" : "Zainteresowani goście",
      value: dashIfEmpty(formatPercent(engagement.engagementRate, 0)),
      hint: en
        ? "Stayed 10s+, viewed 2+ pages or took an action."
        : "Byli dłużej niż 10 s, obejrzeli 2+ podstrony albo coś kliknęli.",
      footer: en && !noVisits ? null : verdict,
    },
    {
      icon: DoorOpen,
      label: en ? "Quick exits" : "Szybkie wyjścia",
      value: dashIfEmpty(formatPercent(engagement.bounceRate, 0)),
      hint: en
        ? "Left without interacting."
        : "Wyszli od razu, niczego nie oglądając.",
      footer: null,
    },
    {
      icon: CalendarDays,
      label: en ? "Visits per day" : "Wizyt dziennie",
      value: dashIfEmpty(formatNumberPL(engagement.avgDailySessions)),
      hint: en ? "Average over the period." : "Średnio każdego dnia w tym okresie.",
      footer: null,
    },
  ];

  return (
    <Grid numItemsSm={3} className="gap-4">
      {tiles.map((t) => (
        <Card key={t.label} className="flex flex-col">
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <t.icon className="h-4 w-4" />
            {t.label}
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight">{t.value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
          {t.footer ? (
            <p className={cn("mt-3 text-xs font-medium", t.footer.tone)}>{t.footer.text}</p>
          ) : null}
        </Card>
      ))}
    </Grid>
  );
}
