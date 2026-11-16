import { computePacing, type FlightDef, type FlightMetric, type PacingFlight } from "@/lib/alerts/pacing";
import { buildGoalTiles, type GoalTile } from "@/lib/dashboard/campaign-goals";
import { addDaysIso } from "@/lib/demo/profile/anonymize";
import type { DemoCampaign, DemoSource } from "@/lib/demo/source";

/**
 * Sample campaign goals for /demo-full: one per tile verdict (on plan,
 * behind, at risk, budget used up) and one ad set / ad group goal of each
 * platform. What each goal delivered is its campaign's own days in the demo
 * source (an ad set's share of them), so a goal can't claim clicks its
 * campaign never had; the targets are set against that delivery so each
 * goal lands in its state, then rounded like a person would write them.
 */

interface DemoGoal {
  id: string;
  campaign: DemoCampaign | undefined;
  adset: { id: string; name: string; share: number } | null;
  metric: FlightMetric;
  /** Days since the start (today = startAgo) and until the end. */
  startAgo: number;
  endIn: number;
  /** Target as a multiple of the linear plan the delivery so far implies. */
  vsPlan: number;
  /** Spend goals: target as a share of what was already spent. */
  vsRealized?: number;
}

const pick = (src: DemoSource, provider: DemoCampaign["provider"], types: string[], skip: Set<string>) =>
  types
    .map((t) => src.campaigns.find((c) => c.provider === provider && c.type === t && !skip.has(c.id)))
    .find((c) => c !== undefined) ??
  src.campaigns.find((c) => c.provider === provider && !skip.has(c.id));

/** Three significant digits: "12 300 kliknięć", "41 800 zł". */
function nice(v: number, metric: FlightMetric): number {
  if (metric === "spend") return Math.max(100_00, Math.round(v / 100_00) * 100_00);
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, v))) - 2);
  return Math.max(mag, Math.round(v / mag) * mag);
}

const metricOf = (metric: FlightMetric, a: { spend: number; clicks: number; impressions: number; conversions: number }) =>
  metric === "spend" ? a.spend : metric === "impressions" ? a.impressions : metric === "conversions" ? a.conversions : a.clicks;

export function demoCampaignFlights(src: DemoSource): PacingFlight[] {
  const today = src.today;
  const used = new Set<string>();
  const take = (c: DemoCampaign | undefined) => {
    if (c) used.add(c.id);
    return c;
  };
  const goals: DemoGoal[] = [
    {
      id: "demo-goal-1",
      campaign: take(pick(src, "meta_ads", ["PROSPECTING"], used)),
      adset: null,
      metric: "clicks",
      startAgo: 13,
      endIn: 14,
      vsPlan: 1,
    },
    {
      id: "demo-goal-2",
      campaign: take(pick(src, "meta_ads", ["RETARGETING", "CATALOG"], used)),
      adset: { id: "demo-adset-rmk", name: "Odwiedzili sklep 14 dni", share: 0.6 },
      metric: "impressions",
      startAgo: 18,
      endIn: 6,
      vsPlan: 1.45,
    },
    {
      id: "demo-goal-3",
      // A product Search campaign, not the brand one (the biggest Search is
      // named "Marka"); else the shopping feed.
      campaign: take(
        src.campaigns.filter((c) => c.provider === "google_ads" && c.type === "SEARCH" && !used.has(c.id))[1] ??
          pick(src, "google_ads", ["SHOPPING", "SEARCH"], used)
      ),
      adset: { id: "demo-adgroup-tv", name: "Telewizory 55-65 cali", share: 0.45 },
      metric: "clicks",
      startAgo: 9,
      endIn: 11,
      vsPlan: 1.22,
    },
    {
      id: "demo-goal-4",
      campaign: take(pick(src, "google_ads", ["PMAX"], used)),
      adset: null,
      metric: "spend",
      startAgo: 22,
      endIn: 3,
      vsPlan: 1,
      // A launch budget met before its end date: "budżet wykorzystany".
      vsRealized: 0.97,
    },
  ];

  const out: PacingFlight[] = [];
  for (const g of goals) {
    const c = g.campaign;
    if (!c) continue;
    const start = addDaysIso(today, -g.startAgo);
    if (start < src.campaignStart) continue;
    const end = addDaysIso(today, g.endIn);
    const totalDays = g.startAgo + g.endIn + 1;
    const share = g.adset?.share ?? 1;
    const byDate = new Map<string, number>();
    let done = 0;
    let realized = 0;
    for (let i = 0; i <= g.startAgo; i++) {
      const d = addDaysIso(start, i);
      const a = src.campaignDay(c.id, d);
      const v = a ? Math.round(metricOf(g.metric, a) * share) : 0;
      byDate.set(d, v);
      realized += v;
      if (d < today) done += v;
    }
    if (done <= 0) continue;
    const plan = (done / g.startAgo) * totalDays;
    const target = nice(g.vsRealized ? realized * g.vsRealized : plan * g.vsPlan, g.metric);
    const def: FlightDef = {
      id: g.id,
      campaignId: c.id,
      campaignName: c.namePl,
      adsetId: g.adset?.id ?? null,
      adsetName: g.adset?.name ?? null,
      provider: c.provider,
      metric: g.metric,
      target,
      startDate: start,
      endDate: end,
    };
    out.push(computePacing(def, byDate, today));
  }
  return out;
}

/** The demo's goal tiles, on the same "today" as its flights. */
export function demoGoalTiles(src: DemoSource): GoalTile[] {
  return buildGoalTiles(demoCampaignFlights(src), src.today);
}
