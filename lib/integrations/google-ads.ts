// Google Ads API client via the `google-ads-api` package. Handles OAuth,
// account discovery and campaign metrics. Google reports money in micros
// (1 unit = 1_000_000 micros); we convert to bigint minor units (grosze) with
// Math.round(micros / 10_000).
import { GoogleAdsApi } from "google-ads-api";

import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

function clientId(): string {
  return process.env.GOOGLE_ADS_CLIENT_ID!;
}
function clientSecret(): string {
  return process.env.GOOGLE_ADS_CLIENT_SECRET!;
}
function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/google-ads/callback`;
}

function apiClient(): GoogleAdsApi {
  return new GoogleAdsApi({
    client_id: clientId(),
    client_secret: clientSecret(),
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  });
}

// Which manager id to authenticate as (the `login-customer-id` header). An
// account that appears in listAccessibleCustomers is DIRECTLY accessible, so its
// own id works; a child account under a manager needs that manager's id. Since
// clients can sit under different managers, we try the account itself first,
// then the agency's configured MCC - the first that Google accepts wins.
function candidateLogins(customerId: string): string[] {
  const list = [customerId];
  const envMcc = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (envMcc && envMcc !== customerId) list.push(envMcc);
  return list;
}

// Run a GAQL query against a customer, trying each candidate login-customer-id
// until one is accepted. Throws the last error if all fail.
async function queryWithFallback(
  client: GoogleAdsApi,
  refreshToken: string,
  customerId: string,
  gaql: string
): Promise<Array<Record<string, unknown>>> {
  let lastErr: unknown;
  for (const login of candidateLogins(customerId)) {
    try {
      const customer = client.Customer({
        customer_id: customerId,
        login_customer_id: login,
        refresh_token: refreshToken,
      });
      return (await customer.query(gaql)) as Array<Record<string, unknown>>;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export interface GoogleAdsAccount {
  id: string;
  name: string;
  currency: string;
  timezone: string;
}

export interface GoogleCampaignMetric {
  campaign_id: string;
  campaign_name: string;
  status: string;
  date: string; // yyyy-MM-dd
  cost_micros: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  average_cpc: number | null;
  conversions: number | null;
}

/** OAuth consent URL. `prompt=consent` guarantees a refresh_token every time. */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Exchange the OAuth code for a refresh token (+ short-lived access token). */
export async function exchangeCodeForTokens(code: string): Promise<{
  refresh_token: string;
  access_token: string;
  expires_at: Date;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });

  const body = await res.json();
  if (!res.ok || !body.refresh_token) {
    console.error("[google-ads] token exchange error", {
      status: res.status,
      error: body?.error,
      error_description: body?.error_description,
    });
    throw new Error(
      body?.error_description ??
        "Google token exchange failed (no refresh_token returned)"
    );
  }

  const expiresInSeconds = Number(body.expires_in ?? 3600);
  return {
    refresh_token: body.refresh_token,
    access_token: body.access_token,
    expires_at: new Date(Date.now() + expiresInSeconds * 1000),
  };
}

/** All customer accounts the refresh token can reach, with basic metadata. */
export async function listAccessibleCustomers(
  refreshToken: string
): Promise<GoogleAdsAccount[]> {
  const client = apiClient();
  const { resource_names } = await client.listAccessibleCustomers(refreshToken);

  const accounts: GoogleAdsAccount[] = [];

  for (const resourceName of resource_names) {
    const customerId = resourceName.split("/")[1];
    try {
      const rows = await queryWithFallback(
        client,
        refreshToken,
        customerId,
        "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1"
      );
      const c = (rows[0] as { customer?: Record<string, unknown> })?.customer;

      accounts.push({
        id: customerId,
        name: String(c?.descriptive_name ?? customerId),
        currency: String(c?.currency_code ?? ""),
        timezone: String(c?.time_zone ?? ""),
      });
    } catch (err) {
      // A customer we can't query (e.g. cancelled) shouldn't drop the rest.
      console.error("[google-ads] failed to describe customer", customerId, err);
      accounts.push({ id: customerId, name: customerId, currency: "", timezone: "" });
    }
  }

  return accounts;
}

/**
 * Daily campaign metrics for [since, until]. `segments.date` yields one row per
 * day, so a single query covers the whole range.
 */
export async function getCampaignMetrics(
  refreshToken: string,
  customerId: string,
  since: string,
  until: string,
  videoOnly = false
): Promise<GoogleCampaignMetric[]> {
  const client = apiClient();

  // videoOnly: only YouTube (VIDEO) campaigns - used when another agency runs
  // the rest of the Google account and we must not report their spend.
  const gaql = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      segments.date
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND campaign.status != 'REMOVED'
      ${videoOnly ? "AND campaign.advertising_channel_type = 'VIDEO'" : ""}
  `;

  const rows = await queryWithFallback(client, refreshToken, customerId, gaql);

  return (rows as Array<Record<string, any>>).map((row) => ({
    campaign_id: String(row.campaign?.id ?? ""),
    campaign_name: String(row.campaign?.name ?? ""),
    status: String(row.campaign?.status ?? ""),
    date: String(row.segments?.date ?? since),
    cost_micros: Number(row.metrics?.cost_micros ?? 0),
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    ctr: row.metrics?.ctr != null ? Number(row.metrics.ctr) : null,
    average_cpc:
      row.metrics?.average_cpc != null ? Number(row.metrics.average_cpc) : null,
    conversions:
      row.metrics?.conversions != null ? Number(row.metrics.conversions) : null,
  }));
}

export interface GoogleAdGroupMetric {
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
  date: string;
  cost_micros: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

/**
 * Daily ad group metrics for [since, until] (ad group goals). Same account
 * rules as getCampaignMetrics (videoOnly = YouTube campaigns only).
 * Performance Max has no ad groups, so its goals stay campaign-level.
 */
export async function getAdGroupMetrics(
  refreshToken: string,
  customerId: string,
  since: string,
  until: string,
  videoOnly = false,
  /** Only this campaign's ad groups (the goal form's on-demand fetch). */
  campaignId?: string
): Promise<GoogleAdGroupMetric[]> {
  const client = apiClient();
  // Interpolated into GAQL: digits only.
  const onlyCampaign = campaignId && /^\d+$/.test(campaignId) ? campaignId : null;
  const gaql = `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      segments.date
    FROM ad_group
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND campaign.status != 'REMOVED'
      AND ad_group.status != 'REMOVED'
      AND metrics.impressions > 0
      ${videoOnly ? "AND campaign.advertising_channel_type = 'VIDEO'" : ""}
      ${onlyCampaign ? `AND campaign.id = ${onlyCampaign}` : ""}
  `;

  const rows = await queryWithFallback(client, refreshToken, customerId, gaql);

  return (rows as Array<Record<string, any>>).map((row) => ({
    campaign_id: String(row.campaign?.id ?? ""),
    campaign_name: String(row.campaign?.name ?? ""),
    ad_group_id: String(row.ad_group?.id ?? ""),
    ad_group_name: String(row.ad_group?.name ?? ""),
    date: String(row.segments?.date ?? since),
    cost_micros: Number(row.metrics?.cost_micros ?? 0),
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
  }));
}

export interface GoogleSearchTermMetric {
  search_term: string;
  campaign_name: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
}

/**
 * What people actually typed into Google before seeing the ads, aggregated
 * over the last 30 days. segments.date is only filtered on (not selected) so
 * Google returns one row per term instead of one per term per day - keeps the
 * payload small enough for the cron's time budget.
 *
 * search_term_view is keyed per ad group, so the same term can come back
 * several times within one campaign; we fold those into one row per
 * (term, campaign) because that's the grain we store.
 */
export async function getSearchTermMetrics(
  refreshToken: string,
  customerId: string
): Promise<GoogleSearchTermMetric[]> {
  const client = apiClient();
  const gaql = `
    SELECT
      search_term_view.search_term,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions
    FROM search_term_view
    WHERE segments.date DURING LAST_30_DAYS
      AND metrics.impressions > 0
    ORDER BY metrics.clicks DESC
    LIMIT 500
  `;

  const rows = await queryWithFallback(client, refreshToken, customerId, gaql);

  const byKey = new Map<string, GoogleSearchTermMetric>();
  for (const row of rows as Array<Record<string, any>>) {
    const term = String(row.search_term_view?.search_term ?? "").trim();
    if (!term) continue;
    const campaign = String(row.campaign?.name ?? "");
    const key = `${term}\u0000${campaign}`;
    const cur =
      byKey.get(key) ??
      ({
        search_term: term,
        campaign_name: campaign,
        impressions: 0,
        clicks: 0,
        cost_micros: 0,
        conversions: 0,
      } satisfies GoogleSearchTermMetric);
    cur.impressions += Number(row.metrics?.impressions ?? 0);
    cur.clicks += Number(row.metrics?.clicks ?? 0);
    cur.cost_micros += Number(row.metrics?.cost_micros ?? 0);
    cur.conversions += Number(row.metrics?.conversions ?? 0);
    byKey.set(key, cur);
  }
  return Array.from(byKey.values());
}

/**
 * Daily snapshot of search terms into google_search_terms for one client.
 * Returns the number of rows written, or null when skipped (already synced
 * today, table not migrated yet, or every account failed).
 *
 * Runs at most once per Warsaw day: the ads cron fires every 30 min and a
 * 30-day aggregate barely moves within a day, so re-pulling would only burn
 * API quota and cron time. When no account has any search terms we still
 * write a single empty-term marker row so the "already done today" check
 * holds; readers filter it out.
 */
export async function syncSearchTermsSnapshot(
  admin: AdminClient,
  clientId: string,
  refreshToken: string,
  accounts: Array<{ id: string; video_only?: boolean }>,
  periodEnd: string
): Promise<number | null> {
  // Doubles as a probe: an error here means migration 0023 hasn't run.
  const existing = await admin
    .from("google_search_terms")
    .select("id")
    .eq("client_id", clientId)
    .eq("period_end", periodEnd)
    .limit(1);
  if (existing.error) return null;
  if ((existing.data ?? []).length > 0) return null;

  const rows: Array<Record<string, unknown>> = [];
  let succeeded = 0;
  for (const account of accounts) {
    // video_only accounts are run by another agency except for YouTube, which
    // has no search terms - pulling them would leak someone else's campaigns.
    if (account.video_only === true) continue;
    try {
      const terms = await getSearchTermMetrics(refreshToken, account.id);
      succeeded += 1;
      for (const t of terms) {
        rows.push({
          client_id: clientId,
          customer_id: account.id,
          search_term: t.search_term,
          campaign_name: t.campaign_name,
          impressions: t.impressions,
          clicks: t.clicks,
          cost_minor_units: Math.round(t.cost_micros / 10_000),
          conversions: t.conversions,
          period_end: periodEnd,
        });
      }
    } catch (err) {
      console.error(
        "[google-ads] search terms failed",
        account.id,
        (err as Error)?.message ?? err
      );
    }
  }
  // Nothing fetched at all - leave the day open so the next run retries.
  if (succeeded === 0) return null;

  if (rows.length === 0) {
    rows.push({
      client_id: clientId,
      customer_id: "",
      search_term: "",
      campaign_name: "",
      impressions: 0,
      clicks: 0,
      cost_minor_units: 0,
      conversions: 0,
      period_end: periodEnd,
    });
  }

  // A manual sync can race the cron past the "already today" check; clearing
  // first keeps the snapshot whole instead of the unique key rejecting it.
  const del = await admin
    .from("google_search_terms")
    .delete()
    .eq("client_id", clientId)
    .eq("period_end", periodEnd);
  if (del.error) throw new Error(del.error.message);

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("google_search_terms")
      .insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

export interface GoogleImpressionShareMetric {
  campaign_id: string;
  campaign_name: string;
  /** Fractions 0-1 as Google reports them; null = too little data. */
  impression_share: number | null;
  budget_lost: number | null;
  rank_lost: number | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
}

// Google omits a share (or sends a non-number) when it lacks data; anything
// outside 0-1 would be a parsing surprise, so treat it as unknown too.
function shareOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/**
 * Search impression share per Search campaign, aggregated over the last 30
 * days. No segments.date in the SELECT, so Google returns one row per
 * campaign with the period-level share (shares can't be summed per day).
 *
 * Values are passed through untouched, including Google's capped 0.0999
 * ("<10%") and 0.9001 (">90%") - the reader decides how to present them.
 */
export async function getImpressionShareMetrics(
  refreshToken: string,
  customerId: string
): Promise<GoogleImpressionShareMetric[]> {
  const client = apiClient();
  const gaql = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
      AND campaign.advertising_channel_type = 'SEARCH'
      AND metrics.impressions > 0
  `;

  const rows = await queryWithFallback(client, refreshToken, customerId, gaql);

  return (rows as Array<Record<string, any>>)
    .map((row) => ({
      campaign_id: String(row.campaign?.id ?? ""),
      campaign_name: String(row.campaign?.name ?? ""),
      impression_share: shareOrNull(row.metrics?.search_impression_share),
      budget_lost: shareOrNull(row.metrics?.search_budget_lost_impression_share),
      rank_lost: shareOrNull(row.metrics?.search_rank_lost_impression_share),
      impressions: Number(row.metrics?.impressions ?? 0),
      clicks: Number(row.metrics?.clicks ?? 0),
      cost_micros: Number(row.metrics?.cost_micros ?? 0),
    }))
    .filter((m) => m.campaign_id !== "");
}

/**
 * Daily snapshot of Search impression share into google_impression_share for
 * one client. Same contract as syncSearchTermsSnapshot: returns rows written,
 * or null when skipped (already synced today, table not migrated yet, or
 * every account failed). Writes a campaign_id = '' marker row when no
 * account has Search campaigns so the once-a-day check still holds.
 */
export async function syncImpressionShareSnapshot(
  admin: AdminClient,
  clientId: string,
  refreshToken: string,
  accounts: Array<{ id: string; video_only?: boolean }>,
  periodEnd: string
): Promise<number | null> {
  // Doubles as a probe: an error here means migration 0027 hasn't run.
  const existing = await admin
    .from("google_impression_share")
    .select("campaign_id")
    .eq("client_id", clientId)
    .eq("period_end", periodEnd)
    .limit(1);
  if (existing.error) return null;
  if ((existing.data ?? []).length > 0) return null;

  const rows: Array<Record<string, unknown>> = [];
  let succeeded = 0;
  for (const account of accounts) {
    // video_only accounts are run by another agency except for YouTube; their
    // Search campaigns aren't ours to report on.
    if (account.video_only === true) continue;
    try {
      const metrics = await getImpressionShareMetrics(refreshToken, account.id);
      succeeded += 1;
      for (const m of metrics) {
        rows.push({
          client_id: clientId,
          customer_id: account.id,
          campaign_id: m.campaign_id,
          campaign_name: m.campaign_name,
          impression_share: m.impression_share,
          budget_lost: m.budget_lost,
          rank_lost: m.rank_lost,
          impressions: m.impressions,
          clicks: m.clicks,
          cost_minor_units: Math.round(m.cost_micros / 10_000),
          period_end: periodEnd,
        });
      }
    } catch (err) {
      console.error(
        "[google-ads] impression share failed",
        account.id,
        (err as Error)?.message ?? err
      );
    }
  }
  // Nothing fetched at all - leave the day open so the next run retries.
  if (succeeded === 0) return null;

  if (rows.length === 0) {
    rows.push({
      client_id: clientId,
      customer_id: "",
      campaign_id: "",
      campaign_name: "",
      impression_share: null,
      budget_lost: null,
      rank_lost: null,
      impressions: 0,
      clicks: 0,
      cost_minor_units: 0,
      period_end: periodEnd,
    });
  }

  // A manual sync can race the cron past the "already today" check; clearing
  // first keeps the snapshot whole instead of the primary key rejecting it.
  const del = await admin
    .from("google_impression_share")
    .delete()
    .eq("client_id", clientId)
    .eq("period_end", periodEnd);
  if (del.error) throw new Error(del.error.message);

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("google_impression_share")
      .insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return rows.length;
}
