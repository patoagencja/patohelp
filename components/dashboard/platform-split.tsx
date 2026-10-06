import {
  ShareBars,
  sharesSumming100,
  type ShareRow,
} from "@/components/dashboard/website/share-bars";
import type { PlatformSplit as PlatformSplitData } from "@/lib/dashboard/metrics";

type Lang = "pl" | "en";

// Always group thousands ("7 581 zł"): pl-PL Intl skips grouping for 4-digit
// numbers, which looks inconsistent next to "50 000 zł" in the same card.
function wholePln(minorUnits: number): string {
  const n = Math.round(minorUnits / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n} zł`;
}

/**
 * One-line takeaway above the bars. Shares within ~10 points of each other
 * read as "roughly even" - "52% vs 48%" isn't a story worth telling the board.
 */
function takeaway(rows: ShareRow[], total: number, lang: Lang): string {
  const en = lang === "en";
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const second = sorted[1];
  const totalText = wholePln(total);

  if (!second) {
    return en
      ? `The whole budget (${totalText}) went to ${top.label}.`
      : `Cały budżet (${totalText}) poszedł na ${top.label}.`;
  }
  // Same rounding as the bars below, so the sentence quotes the printed %.
  const [topShare, secondShare] = sharesSumming100(sorted.map((r) => r.value));
  if (topShare - secondShare <= 10) {
    return en
      ? `${totalText} in total, split roughly evenly between ${top.label} and ${second.label}.`
      : `Łącznie ${totalText}, podzielone mniej więcej po równo między ${top.label} i ${second.label}.`;
  }
  return en
    ? `${totalText} in total - most of it (${topShare}%) went to ${top.label}.`
    : `Łącznie ${totalText} - większość (${topShare}%) poszła na ${top.label}.`;
}

/**
 * Where the ad money went, as ranked share bars ("Meta 62% · 7 400 zł").
 * Replaced a donut: people squinted at the legend to work out who got more,
 * and bars with the % printed survive a projector.
 */
export function PlatformSplit({
  split,
  lang = "pl",
}: {
  split: PlatformSplitData;
  lang?: Lang;
}) {
  const en = lang === "en";
  // Bar colours = the platform dots in the campaign list and the CPC chart
  // lines (chart-1 Meta, chart-2 Google, chart-3 TikTok).
  const rows: ShareRow[] = [
    {
      key: "meta",
      label: "Meta",
      hint: en ? "Facebook and Instagram" : "Facebook i Instagram",
      value: split.metaSpendMinorUnits,
      barClass: "bg-chart-1",
    },
    {
      key: "google",
      label: "Google",
      hint: en ? "search and YouTube" : "wyszukiwarka i YouTube",
      value: split.googleSpendMinorUnits,
      barClass: "bg-chart-2",
    },
    {
      key: "tiktok",
      label: "TikTok",
      value: split.tiktokSpendMinorUnits,
      barClass: "bg-chart-3",
    },
  ].filter((r) => r.value > 0);
  const total = rows.reduce((a, r) => a + r.value, 0);

  return (
    <ShareBars
      title={en ? "Where the ad money goes" : "Na co idą pieniądze"}
      // ShareBars renders its own empty-state line when there are no rows.
      insight={rows.length > 0 ? takeaway(rows, total, lang) : null}
      rows={rows}
      unit={wholePln}
      emptyText={
        en
          ? "No ad spend in this period yet - it appears after the next ad account sync."
          : "W tym okresie nie ma jeszcze wydatków - pojawią się po najbliższej synchronizacji kont reklamowych."
      }
    />
  );
}
