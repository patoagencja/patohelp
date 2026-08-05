// Per-segment monthly numbers for the Google Slides report automation.
// A "segment" is a subset of campaigns selected by substrings of
// campaign_name (e.g. all_of: ["GOODS", "CEP"]) - matching how the OLX decks
// split into Goods/Parts/Jobs/Services x subtype.
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { AdProvider } from "@/lib/types";

export interface CampaignFilter {
  all_of: string[]; // campaign_name must contain every entry (case-insensitive)
  any_of: string[]; // and at least one of these, when non-empty
}

export function matchesFilter(name: string, filter: CampaignFilter): boolean {
  const n = name.toLowerCase();
  const all = (filter.all_of ?? []).map((s) => s.toLowerCase());
  const any = (filter.any_of ?? []).map((s) => s.toLowerCase());
  if (!all.every((s) => n.includes(s))) return false;
  if (any.length && !any.some((s) => n.includes(s))) return false;
  return true;
}

interface Agg {
  cost: number; // grosze
  impressions: number;
  clicks: number;
  reach: number;
}
const emptyAgg = (): Agg => ({ cost: 0, impressions: 0, clicks: 0, reach: 0 });

export interface SegmentMonthData {
  month: string; // YYYY-MM
  monthLabel: string; // e.g. Lipiec 2026
  periodLabel: string; // 01.07.2026-31.07.2026
  campaignCount: number;
  perProvider: Partial<Record<AdProvider, Agg & { cpc: number | null; cpm: number | null; ctr: number | null }>>;
  totals: Agg & { cpc: number | null; cpm: number | null; ctr: number | null };
  prevTotals: (Agg & { cpc: number | null; cpm: number | null; ctr: number | null }) | null;
  topCampaigns: Array<{ provider: AdProvider; name: string; cost: number; clicks: number }>;
}

const MONTHS_PL = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
];

function derive(a: Agg) {
  return {
    ...a,
    cpc: a.clicks > 0 ? a.cost / a.clicks : null,
    cpm: a.impressions > 0 ? (a.cost / a.impressions) * 1000 : null,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : null,
  };
}

/** Aggregate one month (+previous for deltas) of a campaign-name segment. */
export async function getSegmentMonthData(
  clientId: string,
  filter: CampaignFilter,
  monthDate?: Date
): Promise<SegmentMonthData> {
  const admin = createAdminClient();
  const target = monthDate ?? subMonths(new Date(), 1);
  const monthStart = startOfMonth(target);
  const monthEnd = endOfMonth(target);
  const prevStart = startOfMonth(subMonths(target, 1));

  const fmtIso = (d: Date) => format(d, "yyyy-MM-dd");
  const targetKey = format(monthStart, "yyyy-MM");
  const prevKey = format(prevStart, "yyyy-MM");

  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    admin
      .from("ads_daily")
      .select(
        "provider, campaign_id, campaign_name, date, spend_minor_units, impressions, clicks, reach"
      )
      .eq("client_id", clientId)
      .gte("date", fmtIso(prevStart))
      .lte("date", fmtIso(monthEnd))
      .order("date", { ascending: true })
      .order("provider", { ascending: true })
      .order("campaign_id", { ascending: true })
      .range(from, to)
  );

  const byProvider = new Map<AdProvider, Agg>();
  const prevAgg = emptyAgg();
  const byCampaign = new Map<
    string,
    { provider: AdProvider; name: string; cost: number; clicks: number }
  >();
  const campaignIds = new Set<string>();
  let prevAny = false;

  for (const r of rows ?? []) {
    const name = (r.campaign_name as string) || "";
    if (!matchesFilter(name, filter)) continue;
    const mk = (r.date as string).slice(0, 7);
    const provider = r.provider as AdProvider;

    if (mk === targetKey) {
      const agg = byProvider.get(provider) ?? emptyAgg();
      agg.cost += Number(r.spend_minor_units);
      agg.impressions += Number(r.impressions);
      agg.clicks += Number(r.clicks);
      agg.reach += Number(r.reach ?? 0);
      byProvider.set(provider, agg);
      campaignIds.add(`${provider}:${r.campaign_id}`);

      const ck = `${provider}:${r.campaign_id}`;
      const c =
        byCampaign.get(ck) ?? { provider, name, cost: 0, clicks: 0 };
      c.cost += Number(r.spend_minor_units);
      c.clicks += Number(r.clicks);
      byCampaign.set(ck, c);
    } else if (mk === prevKey) {
      prevAny = true;
      prevAgg.cost += Number(r.spend_minor_units);
      prevAgg.impressions += Number(r.impressions);
      prevAgg.clicks += Number(r.clicks);
      prevAgg.reach += Number(r.reach ?? 0);
    }
  }

  const totals = emptyAgg();
  const perProvider: SegmentMonthData["perProvider"] = {};
  for (const [p, a] of byProvider) {
    perProvider[p] = derive(a);
    totals.cost += a.cost;
    totals.impressions += a.impressions;
    totals.clicks += a.clicks;
    totals.reach += a.reach;
  }

  return {
    month: targetKey,
    monthLabel: `${MONTHS_PL[monthStart.getMonth()]} ${monthStart.getFullYear()}`,
    periodLabel: `${format(monthStart, "dd.MM.yyyy")}-${format(monthEnd, "dd.MM.yyyy")}`,
    campaignCount: campaignIds.size,
    perProvider,
    totals: derive(totals),
    prevTotals: prevAny ? derive(prevAgg) : null,
    topCampaigns: [...byCampaign.values()]
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Token values for Slides replaceAllText. Everything a template may reference;
// unknown tokens in a deck simply stay unreplaced (visible in the debug list).

const fmtPln = (grosze: number | null): string =>
  grosze == null
    ? "-"
    : `${(grosze / 100).toLocaleString("pl-PL", { maximumFractionDigits: 0 })} zł`;
const fmtPln2 = (grosze: number | null): string =>
  grosze == null
    ? "-"
    : `${(grosze / 100).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const fmtInt = (n: number): string => Math.round(n).toLocaleString("pl-PL");
const fmtPct = (frac: number | null): string =>
  frac == null ? "-" : `${(frac * 100).toLocaleString("pl-PL", { maximumFractionDigits: 2 })}%`;
const delta = (cur: number, prev: number | null | undefined): string => {
  if (!prev) return "-";
  const d = ((cur - prev) / prev) * 100;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%`;
};

/** Flatten SegmentMonthData into {{token}} -> display string. */
export function buildTokenValues(d: SegmentMonthData): Record<string, string> {
  const values: Record<string, string> = {
    month: d.monthLabel,
    period: d.periodLabel,
    campaign_count: fmtInt(d.campaignCount),
    // Totals across providers
    spend: fmtPln(d.totals.cost),
    impressions: fmtInt(d.totals.impressions),
    clicks: fmtInt(d.totals.clicks),
    reach: fmtInt(d.totals.reach),
    cpc: fmtPln2(d.totals.cpc),
    cpm: fmtPln2(d.totals.cpm),
    ctr: fmtPct(d.totals.ctr),
    // Deltas vs previous month
    spend_delta: delta(d.totals.cost, d.prevTotals?.cost),
    clicks_delta: delta(d.totals.clicks, d.prevTotals?.clicks),
    impressions_delta: delta(d.totals.impressions, d.prevTotals?.impressions),
    reach_delta: delta(d.totals.reach, d.prevTotals?.reach),
  };

  // Per-provider blocks: meta_spend, google_cpc, tiktok_reach, ...
  const prefixes: Array<[AdProvider, string]> = [
    ["meta_ads", "meta"],
    ["google_ads", "google"],
    ["tiktok_ads", "tiktok"],
  ];
  for (const [provider, prefix] of prefixes) {
    const p = d.perProvider[provider];
    values[`${prefix}_spend`] = fmtPln(p?.cost ?? null);
    values[`${prefix}_impressions`] = p ? fmtInt(p.impressions) : "-";
    values[`${prefix}_clicks`] = p ? fmtInt(p.clicks) : "-";
    values[`${prefix}_reach`] = p ? fmtInt(p.reach) : "-";
    values[`${prefix}_cpc`] = fmtPln2(p?.cpc ?? null);
    values[`${prefix}_cpm`] = fmtPln2(p?.cpm ?? null);
    values[`${prefix}_ctr`] = fmtPct(p?.ctr ?? null);
  }

  // Top campaigns: top1_name/top1_spend ... top5_*
  d.topCampaigns.slice(0, 5).forEach((c, i) => {
    values[`top${i + 1}_name`] = c.name;
    values[`top${i + 1}_spend`] = fmtPln(c.cost);
    values[`top${i + 1}_clicks`] = fmtInt(c.clicks);
  });
  for (let i = d.topCampaigns.length; i < 5; i++) {
    values[`top${i + 1}_name`] = "-";
    values[`top${i + 1}_spend`] = "-";
    values[`top${i + 1}_clicks`] = "-";
  }

  return values;
}
