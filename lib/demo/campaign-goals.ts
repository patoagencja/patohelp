import { format, subDays, addDays } from "date-fns";

import { computePacing, type FlightDef, type PacingFlight } from "@/lib/alerts/pacing";
import { buildGoalTiles, type GoalTile } from "@/lib/dashboard/campaign-goals";
import { getDemoDashboard } from "@/lib/demo/data";

/**
 * Sample campaign goals for /demo-full: one per tile verdict (on plan, behind,
 * at risk, reached) and one ad set / ad group goal of each provider, so the
 * goal tiles and the Alerty goal cards show every state. Deterministic.
 */

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface DemoGoal {
  def: Omit<FlightDef, "startDate" | "endDate">;
  /** Days since the start (today = startAgo) and until the end. */
  startAgo: number;
  endIn: number;
  /** Delivery per day as a share of the linear plan, start -> today. */
  paceFrom: number;
  paceTo: number;
}

export function demoCampaignFlights(today = new Date()): PacingFlight[] {
  const rand = seeded(20261006);
  const todayStr = format(today, "yyyy-MM-dd");
  const goals: DemoGoal[] = [
    {
      def: {
        id: "demo-goal-1",
        campaignId: "d-m2",
        campaignName: "SPRZEDAŻ | Skrzynki warzyw",
        adsetId: null,
        adsetName: null,
        provider: "meta_ads",
        metric: "clicks",
        target: 12000,
      },
      startAgo: 13,
      endIn: 14,
      paceFrom: 0.92,
      paceTo: 1.12,
    },
    {
      def: {
        id: "demo-goal-2",
        campaignId: "d-m4",
        campaignName: "REMARKETING | Sklep",
        adsetId: "d-m4-as1",
        adsetName: "Odwiedzili sklep 14 dni",
        provider: "meta_ads",
        metric: "impressions",
        target: 400000,
      },
      startAgo: 18,
      endIn: 6,
      paceFrom: 0.75,
      paceTo: 0.55,
    },
    {
      def: {
        id: "demo-goal-3",
        campaignId: "d-g2",
        campaignName: "SEARCH | Warzywa z dostawą",
        adsetId: "d-g2-ag1",
        adsetName: "Skrzynki warzyw",
        provider: "google_ads",
        metric: "clicks",
        target: 500,
      },
      startAgo: 9,
      endIn: 11,
      // Plan counts finished days only (computePacing), so "behind" needs a
      // pace clearly under 90% of plan.
      paceFrom: 0.9,
      paceTo: 0.65,
    },
    {
      def: {
        id: "demo-goal-4",
        campaignId: "d-g3",
        campaignName: "PMAX | Sklep z warzywami",
        adsetId: null,
        adsetName: null,
        provider: "google_ads",
        metric: "spend",
        // Placeholder: set from the PMAX campaign's spend below.
        target: 550000,
      },
      // The launch budget, met before its end date because the campaign
      // overspends - the same story as the demo's "Skok wydatków dziś" alert
      // on this campaign. It used to have ended two days ago, next to that
      // alert about spend today.
      startAgo: 22,
      endIn: 3,
      paceFrom: 1.0,
      paceTo: 1.35,
    },
  ];

  // The PMAX launch budget is the whole campaign, which started inside the
  // demo's 30 days: its spend must be the campaign row's (it read 5 674 zł
  // here and 5 705 zł in the table). The target sits ~3% under it.
  const pmaxSpend =
    getDemoDashboard("pl", today).campaigns.find((c) => c.campaignId === "d-g3")?.spendMinorUnits ?? 0;
  const pmaxGoal = goals.find((g) => g.def.id === "demo-goal-4");
  if (pmaxGoal && pmaxSpend > 0) pmaxGoal.def.target = Math.round(pmaxSpend / 1.03 / 10_000) * 10_000;

  return goals.map((g) => {
    const start = subDays(today, g.startAgo);
    const end = addDays(today, g.endIn);
    const totalDays = g.startAgo + g.endIn + 1;
    const perDay = g.def.target / totalDays;
    const days = Math.min(g.startAgo + 1, totalDays);
    const byDate = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const t = days > 1 ? i / (days - 1) : 0;
      const pace = g.paceFrom + (g.paceTo - g.paceFrom) * t;
      // Today is a partial day in the live data too.
      const partial = i === g.startAgo ? 0.45 : 1;
      byDate.set(
        format(addDays(start, i), "yyyy-MM-dd"),
        Math.round(perDay * pace * (0.85 + rand() * 0.3) * partial)
      );
    }
    if (g.def.id === "demo-goal-4" && pmaxSpend > 0) {
      // Same days, scaled to add up to the campaign's spend exactly.
      const raw = Array.from(byDate.values()).reduce((a, v) => a + v, 0) || 1;
      let left = pmaxSpend;
      const keys = Array.from(byDate.keys());
      keys.forEach((k, i) => {
        const v = i === keys.length - 1 ? left : Math.round(((byDate.get(k) ?? 0) * pmaxSpend) / raw);
        byDate.set(k, v);
        left -= v;
      });
    }
    return computePacing(
      { ...g.def, startDate: format(start, "yyyy-MM-dd"), endDate: format(end, "yyyy-MM-dd") },
      byDate,
      todayStr
    );
  });
}

/** The demo's goal tiles, on the same "today" as its flights. */
export function demoGoalTiles(today = new Date()): GoalTile[] {
  return buildGoalTiles(demoCampaignFlights(today), format(today, "yyyy-MM-dd"));
}
