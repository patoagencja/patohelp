import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const WARSAW_TZ = "Europe/Warsaw";

export type SourceCategory =
  | "Paid"
  | "Organic"
  | "Direct"
  | "Social"
  | "Referral/Inne";

export interface WebsiteData {
  hasData: boolean;
  sources: Array<{
    category: SourceCategory;
    sessions: number;
    revenueMinorUnits: number;
    transactions: number;
  }>;
  devices: Array<{ device: string; sessions: number }>;
  topPages: Array<{ path: string; views: number; engagementRate: number }>;
  engagement: {
    engagementRate: number; // percent
    bounceRate: number; // percent
    avgDailySessions: number;
  };
  newVsReturning: { newUsers: number; returningUsers: number };
  sessionsTrend: Array<{ date: string; sessions: number }>;
}

const SOCIAL_SOURCES = [
  "facebook",
  "instagram",
  "fb",
  "ig",
  "linkedin",
  "tiktok",
  "youtube",
  "pinterest",
  "twitter",
  "x.com",
  "social",
];

function categorize(sourceMedium: string): SourceCategory {
  const sm = sourceMedium.toLowerCase();
  const [source = "", medium = ""] = sm.split("/").map((s) => s.trim());

  if (
    medium.includes("cpc") ||
    medium.includes("paid") ||
    medium.includes("ppc") ||
    medium.includes("cpm")
  ) {
    return "Paid";
  }
  if (medium.includes("organic")) return "Organic";
  if (source === "(direct)" || sm === "(direct) / (none)") return "Direct";
  if (SOCIAL_SOURCES.some((s) => source.includes(s))) return "Social";
  return "Referral/Inne";
}

export type Ga4Reason =
  | "ok"
  | "not_connected"
  | "no_property"
  | "sync_failed"
  | "no_data_yet";

export interface Ga4Status {
  connected: boolean;
  propertyId: string | null;
  multipleProperties: boolean;
  lastStatus: string | null;
  lastError: string | null;
  reason: Ga4Reason;
}

/**
 * Why the Witryna tab is empty - so the UI can tell the user exactly what to do
 * (pick a property / fix a failing sync) instead of a generic "connect GA4".
 * Uses the admin client so it doesn't depend on RLS for sync_runs.
 */
export async function getGa4Status(clientId: string): Promise<Ga4Status> {
  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("integrations")
    .select("account_ids")
    .eq("client_id", clientId)
    .eq("provider", "ga4")
    .maybeSingle();

  if (!integration) {
    return {
      connected: false,
      propertyId: null,
      multipleProperties: false,
      lastStatus: null,
      lastError: null,
      reason: "not_connected",
    };
  }

  const accountIds = (integration.account_ids ?? {}) as {
    propertyId?: string | null;
    properties?: Array<{ propertyId: string; displayName: string }>;
  };
  const propertyId = accountIds.propertyId ?? null;
  const multipleProperties = (accountIds.properties?.length ?? 0) > 1;

  if (!propertyId) {
    return {
      connected: true,
      propertyId: null,
      multipleProperties,
      lastStatus: null,
      lastError: null,
      reason: "no_property",
    };
  }

  const { data: lastRun } = await admin
    .from("sync_runs")
    .select("status, error_message")
    .eq("client_id", clientId)
    .eq("provider", "ga4")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastRun?.status === "failed") {
    return {
      connected: true,
      propertyId,
      multipleProperties,
      lastStatus: "failed",
      lastError: (lastRun.error_message as string) ?? null,
      reason: "sync_failed",
    };
  }

  return {
    connected: true,
    propertyId,
    multipleProperties,
    lastStatus: (lastRun?.status as string) ?? null,
    lastError: null,
    reason: "no_data_yet",
  };
}

/** Everything the Witryna tab needs from ga4_daily (last 30 days). */
export async function getWebsiteData(clientId: string): Promise<WebsiteData> {
  const supabase = createClient();
  const todayStr = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  const start = formatInTimeZone(
    subDays(new Date(`${todayStr}T00:00:00`), 29),
    WARSAW_TZ,
    "yyyy-MM-dd"
  );

  const BASE =
    "date, sessions, users_new, users_returning, engagement_rate, source_medium, device_category, page_path, page_views";
  // Revenue columns arrive with migration 0016 - selecting an unknown column
  // fails the whole query, so probe once and fall back to the base select.
  const probe = await supabase.from("ga4_daily").select("revenue_minor_units").limit(1);
  const select = probe.error ? BASE : `${BASE}, revenue_minor_units, transactions`;

  const { data } = await supabase
    .from("ga4_daily")
    .select(select as typeof BASE)
    .eq("client_id", clientId)
    .gte("date", start)
    .lte("date", todayStr);

  const rows = data ?? [];
  if (rows.length === 0) {
    return {
      hasData: false,
      sources: [],
      devices: [],
      topPages: [],
      engagement: { engagementRate: 0, bounceRate: 0, avgDailySessions: 0 },
      newVsReturning: { newUsers: 0, returningUsers: 0 },
      sessionsTrend: [],
    };
  }

  const dailyTotals = rows.filter(
    (r) => !r.source_medium && !r.device_category && !r.page_path
  );
  const sourceRows = rows.filter((r) => r.source_medium);
  const deviceRows = rows.filter((r) => r.device_category);
  const pageRows = rows.filter((r) => r.page_path);

  // Dimension breakdowns come from the latest snapshot date only.
  const latestSnapshot = (list: typeof rows) =>
    list.reduce((max, r) => (r.date > max ? (r.date as string) : max), "");

  const srcDate = latestSnapshot(sourceRows);
  const grouped = new Map<
    SourceCategory,
    { sessions: number; revenueMinorUnits: number; transactions: number }
  >();
  for (const r of sourceRows.filter((r) => r.date === srcDate)) {
    const cat = categorize(r.source_medium as string);
    const cur =
      grouped.get(cat) ?? { sessions: 0, revenueMinorUnits: 0, transactions: 0 };
    cur.sessions += Number(r.sessions);
    // Revenue columns only exist post-0016 and are only populated for
    // e-commerce properties; missing -> 0, so engagement clients are unaffected.
    cur.revenueMinorUnits += Number(
      (r as { revenue_minor_units?: number }).revenue_minor_units ?? 0
    );
    cur.transactions += Number((r as { transactions?: number }).transactions ?? 0);
    grouped.set(cat, cur);
  }
  const sources = Array.from(grouped.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.sessions - a.sessions);

  const devDate = latestSnapshot(deviceRows);
  const devices = deviceRows
    .filter((r) => r.date === devDate)
    .map((r) => ({
      device: r.device_category as string,
      sessions: Number(r.sessions),
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const pageDate = latestSnapshot(pageRows);
  const topPages = pageRows
    .filter((r) => r.date === pageDate)
    .map((r) => ({
      path: r.page_path as string,
      views: Number(r.page_views),
      engagementRate: Number(r.engagement_rate ?? 0) * 100,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  // Engagement: sessions-weighted average over daily totals.
  let sessSum = 0;
  let engWeighted = 0;
  const sessionsTrend = dailyTotals
    .map((r) => ({ date: r.date as string, sessions: Number(r.sessions) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const r of dailyTotals) {
    const s = Number(r.sessions);
    sessSum += s;
    engWeighted += s * Number(r.engagement_rate ?? 0);
  }
  const engagementRate = sessSum > 0 ? (engWeighted / sessSum) * 100 : 0;

  // New vs returning: freshest daily-total row carrying the split.
  const nvr = dailyTotals
    .filter((r) => Number(r.users_new) > 0 || Number(r.users_returning) > 0)
    .sort((a, b) => (b.date as string).localeCompare(a.date as string))[0];

  return {
    hasData: true,
    sources,
    devices,
    topPages,
    engagement: {
      engagementRate,
      bounceRate: Math.max(0, 100 - engagementRate),
      avgDailySessions:
        sessionsTrend.length > 0 ? sessSum / sessionsTrend.length : 0,
    },
    newVsReturning: {
      newUsers: Number(nvr?.users_new ?? 0),
      returningUsers: Number(nvr?.users_returning ?? 0),
    },
    sessionsTrend,
  };
}
