import { DailyNetPageView } from "@/components/dashboard/daily-net/daily-net-page";
import {
  buildDailyNetView,
  datesBetween,
  type DayInputs,
  parseCompareMode,
  readWindows,
  resolveNetRange,
  yearsOf,
} from "@/lib/daily-net/calc";
import { cellKey } from "@/lib/daily-net/paste";
import { blackFridayOf, demoRng, type DemoSource } from "@/lib/demo/source";
import { getDemoSource } from "@/lib/demo/profile/store";

// Public showcase of "Wynik dzień po dniu": the live page's view, fed by the
// demo source (the same days every /demo-full page reads), with a couple of
// sample hand-entered channels shown read-only.
export const dynamic = "force-dynamic";

/** Sample Pinterest and Bing costs: a small, steady share of the day's ads. */
function sampleManualCosts(src: DemoSource, windows: Array<{ start: string; end: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of windows) {
    // Typed in after the day ends, as the shop does in its sheet.
    for (const date of datesBetween(w.start, w.end < src.today ? w.end : src.today)) {
      if (date >= src.today) continue;
      const d = src.day(date);
      if (!d) continue;
      const r = demoRng(`demo-manual:${date}`);
      // Whole złoty, like a sheet.
      out[cellKey(date, "pinterest")] = Math.round((d.spend * 0.035 * (0.8 + r() * 0.4)) / 100) * 100;
      if (new Date(`${date}T12:00:00Z`).getUTCDay() % 6 !== 0) {
        out[cellKey(date, "bing")] = Math.round((d.spend * 0.015 * (0.8 + r() * 0.4)) / 100) * 100;
      }
    }
  }
  return out;
}

export default async function DemoWynikPage({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string; cmp?: string };
}) {
  const src = await getDemoSource();
  const today = src.today;
  // The demo has no season (it is shown to every prospect): this month by default.
  const range = resolveNetRange({ range: searchParams.range, from: searchParams.from, to: searchParams.to, today, season: null });
  const mode = parseCompareMode(searchParams.cmp);
  const windows = readWindows(range);
  const manual = sampleManualCosts(src, windows);

  const days: DayInputs = {};
  for (const w of windows) {
    for (const date of datesBetween(w.start, w.end)) {
      const d = src.day(date);
      if (!d) continue;
      days[date] = { revenue: d.hasSales ? d.revenue : null, api: { meta: d.meta.spend, google: d.google.spend } };
    }
  }
  for (const [key, v] of Object.entries(manual)) {
    const [date, channel] = key.split("|") as [string, "pinterest" | "bing"];
    const day = (days[date] ??= {});
    (day.manual ??= {})[channel] = v;
  }

  const view = buildDailyNetView(range, mode, today, days, yearsOf(range).map(blackFridayOf));
  const rangeValues = Object.fromEntries(
    Object.entries(manual).filter(([key]) => key.slice(0, 10) >= range.start && key.slice(0, 10) <= range.end)
  );

  return (
    <DailyNetPageView
      view={view}
      range={range}
      mode={mode}
      base="/demo-full"
      seasonLabel={null}
      shop={{ available: true, first: src.dataStart, last: today }}
      manual={{ available: true, values: rangeValues }}
      tiktokApiDates={[]}
      isAgency={false}
      exportClient="demo"
      readOnlyNote="W wersji demo kosztów nie da się zapisać - to przykładowe kwoty z Pinteresta i Binga. W panelu sklepu wpisujesz je albo wklejasz prosto z arkusza."
      padded={false}
    />
  );
}
