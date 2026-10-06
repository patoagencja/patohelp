import { formatInTimeZone } from "date-fns-tz";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
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
  // Plain date-string maths: the window is 30 Warsaw days ending today,
  // whatever the server's own time zone is.
  const start = new Date(Date.parse(`${todayStr}T00:00:00Z`) - 29 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const BASE =
    "id, date, sessions, users_new, users_returning, engagement_rate, source_medium, device_category, page_path, page_views";
  // Revenue columns arrive with migration 0016 - selecting an unknown column
  // fails the whole query. Ask for them and fall back to the base select only
  // when that errors: a probe query awaited up front cost every render of
  // Witryna/Sprzedaż a full extra round trip for a long-applied migration.
  const FULL = `${BASE}, revenue_minor_units, transactions`;

  // Separate, paginated reads. One unordered select of the whole window used
  // to hit PostgREST's silent 1000-row cap: every sync leaves a dated
  // source/device/page snapshot behind (~30-100 rows a day), so 30 days of
  // snapshots crowded out arbitrary daily-total rows and the trend/engagement
  // undercounted (or the latest snapshot vanished) with no error.
  type Ga4Row = Record<string, unknown>;
  const withRevenueFallback = (read: (select: string) => Promise<Ga4Row[]>) =>
    read(FULL).catch(() => read(BASE));
  const dailyRowsPromise = withRevenueFallback((select) =>
    fetchAll<Ga4Row>((from, to) =>
      supabase
        .from("ga4_daily")
        // The cast only quiets the select-string parser; rows are read loosely.
        .select(select as "*")
        .eq("client_id", clientId)
        .is("source_medium", null)
        .is("device_category", null)
        .is("page_path", null)
        .gte("date", start)
        .lte("date", todayStr)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    )
  );
  // Each dimension is a snapshot of the whole 30-day window dated to the sync
  // day, so only the latest snapshot date may be read - never summed across days.
  const latestSnapshotRows = async (
    column: "source_medium" | "device_category" | "page_path"
  ): Promise<Ga4Row[]> => {
    const { data: latest } = await supabase
      .from("ga4_daily")
      .select("date")
      .eq("client_id", clientId)
      .not(column, "is", null)
      .gte("date", start)
      .lte("date", todayStr)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const date = latest?.date as string | undefined;
    if (!date) return [];
    return withRevenueFallback((select) =>
      fetchAll<Ga4Row>((from, to) =>
        supabase
          .from("ga4_daily")
          .select(select as "*")
          .eq("client_id", clientId)
          .eq("date", date)
          .not(column, "is", null)
          .order("id", { ascending: true })
          .range(from, to)
      )
    );
  };
  const [dailyTotals, sourceRows, deviceRows, pageRows] = await Promise.all([
    dailyRowsPromise,
    latestSnapshotRows("source_medium"),
    latestSnapshotRows("device_category"),
    latestSnapshotRows("page_path"),
  ]);

  if (
    dailyTotals.length + sourceRows.length + deviceRows.length + pageRows.length ===
    0
  ) {
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

  const grouped = new Map<
    SourceCategory,
    { sessions: number; revenueMinorUnits: number; transactions: number }
  >();
  for (const r of sourceRows) {
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

  const devices = deviceRows
    .map((r) => ({
      device: r.device_category as string,
      sessions: Number(r.sessions),
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const topPages = pageRows
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
