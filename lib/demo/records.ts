import { computeRecords, type DayAds, type DayGa4, type RecordItem } from "@/lib/dashboard/records";
import { addDaysIso } from "@/lib/demo/profile/anonymize";
import type { DemoSource } from "@/lib/demo/source";

/**
 * "Rekordy i kamienie milowe" for the demo shop, by the live rules
 * (computeRecords) on the demo's own days - so every record names numbers
 * the other pages show. A real shop's profile holds only recent weeks and
 * last year's season, so its "since 1 January" milestones would count a
 * fraction of the year: those are left out for a profile.
 */
export function getDemoRecords(src: DemoSource): RecordItem[] {
  const today = src.today;
  const lookback = (() => {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 25, 1)).toISOString().slice(0, 10);
  })();
  const start = src.dataStart > lookback ? src.dataStart : lookback;
  const ads = new Map<string, DayAds>();
  const ga4 = new Map<string, DayGa4>();
  for (let d = start; d <= today; d = addDaysIso(d, 1)) {
    const v = src.day(d);
    if (!v) continue;
    ads.set(d, { spend: v.spend, clicks: v.clicks, impressions: v.impressions });
    if (v.hasSite || v.hasSales) ga4.set(d, { sessions: v.sessions, revenue: v.revenue, transactions: v.orders });
  }
  const items = computeRecords({ today, ecommerce: true, ads, ga4, adsLookbackStart: lookback, hasRevenue: true });
  return src.kind === "profile" ? items.filter((r) => !r.id.startsWith("ytd-")) : items;
}
