// Google Ads API client via the `google-ads-api` package. Handles OAuth,
// account discovery and campaign metrics. Google reports money in micros
// (1 unit = 1_000_000 micros); we convert to bigint minor units (grosze) with
// Math.round(micros / 10_000).
import { AsyncLocalStorage } from "node:async_hooks";

import { GoogleAdsApi } from "google-ads-api";

import { googleScopesFor } from "@/lib/integrations/google-identity";
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

/**
 * Per-GAQL-query cap, set only by callers with a hard clock (the 60 s ads
 * cron: without a cap one slow history query held it until Vercel killed
 * it - nothing written, its sync_runs row stuck on "running", the same heavy
 * range retried and killed on every run). Everything else - the ad set
 * sync's 35-120-day query inside a 300 s function, settings, OAuth - runs
 * uncapped: a global 25 s cap made those fail every time on big accounts.
 * Kept in async context so the cron sets it once for every query it makes.
 */
const queryCap = new AsyncLocalStorage<number>();

/** Run `work` with every GAQL query inside it capped at `ms`. */
export function withQueryTimeout<T>(ms: number, work: () => Promise<T>): Promise<T> {
  return queryCap.run(ms, work);
}

/** A GAQL query that did not answer within the cap (withQueryTimeout). */
export class GoogleAdsTimeoutError extends Error {
  constructor(customerId: string, ms: number) {
    super(`Google Ads nie odpowiedział w ${Math.round(ms / 1000)} s (konto ${customerId})`);
    this.name = "GoogleAdsTimeoutError";
  }
}

/**
 * `work`, or a GoogleAdsTimeoutError after `ms`. The library offers no way
 * to cancel the request itself; the late answer is simply ignored (the race
 * keeps its rejection handled).
 */
function withTimeout<T>(work: Promise<T>, ms: number, customerId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new GoogleAdsTimeoutError(customerId, ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
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
      const cap = queryCap.getStore();
      const work = customer.query(gaql);
      return (await (cap ? withTimeout(work, cap, customerId) : work)) as Array<
        Record<string, unknown>
      >;
    } catch (err) {
      // A timeout is not a rejected login: the next login-customer-id would
      // only spend the same time again.
      if (err instanceof GoogleAdsTimeoutError) throw err;
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
  /**
   * Value of those conversions (account currency, major units). Every
   * PRIMARY conversion action counts here - micro conversions, engaged
   * views, an imported GA4 purchase next to the tag's own - so it is NOT a
   * shop's purchase value; see getPurchaseMetrics.
   */
  conversions_value: number | null;
  /** customer.currency_code - every money field above is in it. */
  currency: string | null;
}

/**
 * OAuth consent URL. `prompt=consent` guarantees a refresh_token every time.
 * Also asks for analytics.readonly when GA4 shares this OAuth client (one
 * reconnect then revives both providers) and for `openid email`, so we know
 * which Google account the token belongs to.
 */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: googleScopesFor("google_ads"),
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
  /** OpenID id_token (present when `openid` was granted). */
  id_token: string | null;
  /** Space-separated scopes actually granted. */
  scope: string | null;
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
    id_token: typeof body.id_token === "string" ? body.id_token : null,
    scope: typeof body.scope === "string" ? body.scope : null,
  };
}

/**
 * Ids of the customers the refresh token reaches directly - a single cheap
 * call (no per-customer query), used to verify access before reusing a token
 * for another client.
 */
export async function listAccessibleCustomerIds(
  refreshToken: string
): Promise<string[]> {
  const { resource_names } = await apiClient().listAccessibleCustomers(refreshToken);
  return resource_names.map((r) => r.split("/")[1]).filter(Boolean);
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
      customer.currency_code,
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value,
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
    conversions_value:
      row.metrics?.conversions_value != null ? Number(row.metrics.conversions_value) : null,
    currency: row.customer?.currency_code ? String(row.customer.currency_code) : null,
  }));
}

export interface GooglePurchaseMetric {
  campaign_id: string;
  date: string;
  /** Primary purchase conversions (fractional under data-driven attribution). */
  purchases: number;
  /** Their value, account currency, major units. */
  value: number;
}

/**
 * Purchases only, per campaign and day: conversions / conversions_value
 * segmented by conversion_action_category = PURCHASE. Conversion segments
 * only combine with conversion metrics, hence a query of its own. Unlike
 * getCampaignMetrics it keeps REMOVED campaigns: their rows stay in
 * ads_daily from before the removal and need the same purchase-only value.
 */
export async function getPurchaseMetrics(
  refreshToken: string,
  customerId: string,
  since: string,
  until: string,
  videoOnly = false
): Promise<GooglePurchaseMetric[]> {
  const gaql = `
    SELECT
      campaign.id,
      segments.date,
      segments.conversion_action_category,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND segments.conversion_action_category = 'PURCHASE'
      ${videoOnly ? "AND campaign.advertising_channel_type = 'VIDEO'" : ""}
  `;
  const rows = await queryWithFallback(apiClient(), refreshToken, customerId, gaql);
  const byKey = new Map<string, GooglePurchaseMetric>();
  for (const row of rows as Array<Record<string, any>>) {
    const campaignId = String(row.campaign?.id ?? "");
    const date = String(row.segments?.date ?? "");
    if (!campaignId || !date) continue;
    const key = `${campaignId}|${date}`;
    const cur = byKey.get(key) ?? { campaign_id: campaignId, date, purchases: 0, value: 0 };
    cur.purchases += Number(row.metrics?.conversions ?? 0) || 0;
    cur.value += Number(row.metrics?.conversions_value ?? 0) || 0;
    byKey.set(key, cur);
  }
  return [...byKey.values()];
}

/**
 * Days in [since, until] on which the account delivered - the light probe
 * behind the gap logic: account level, at most one row per day. Video-only
 * accounts ask at campaign level for their VIDEO campaigns instead, since
 * the rest of such an account is another agency's and must not make days
 * look active. (A day where only a since-REMOVED campaign ran still counts
 * as active here; the cron remembers such days once fetched empty.)
 */
export async function getDeliveryDays(
  refreshToken: string,
  customerId: string,
  since: string,
  until: string,
  videoOnly = false
): Promise<Set<string>> {
  const gaql = videoOnly
    ? `
    SELECT
      segments.date,
      metrics.impressions
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND campaign.status != 'REMOVED'
      AND campaign.advertising_channel_type = 'VIDEO'
  `
    : `
    SELECT
      segments.date,
      metrics.impressions
    FROM customer
    WHERE segments.date BETWEEN '${since}' AND '${until}'
  `;
  const rows = await queryWithFallback(apiClient(), refreshToken, customerId, gaql);
  const days = new Set<string>();
  for (const row of rows as Array<Record<string, any>>) {
    const d = row.segments?.date;
    if (d && Number(row.metrics?.impressions ?? 0) > 0) days.add(String(d));
  }
  return days;
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

/**
 * Every ad group of one campaign (structure, no metrics): groups that
 * haven't served yet have no metrics rows. Empty when the campaign lives in
 * another of the client's accounts.
 */
export async function getCampaignAdGroupList(
  refreshToken: string,
  customerId: string,
  campaignId: string
): Promise<Array<{ id: string; name: string; status: string | null }>> {
  // Interpolated into GAQL: digits only.
  if (!/^\d+$/.test(campaignId)) return [];
  const gaql = `
    SELECT ad_group.id, ad_group.name, ad_group.status
    FROM ad_group
    WHERE campaign.id = ${campaignId}
      AND ad_group.status != 'REMOVED'
  `;
  const rows = await queryWithFallback(apiClient(), refreshToken, customerId, gaql);
  return (rows as Array<Record<string, any>>)
    .filter((row) => row.ad_group?.id != null)
    .map((row) => ({
      id: String(row.ad_group.id),
      name: String(row.ad_group?.name ?? row.ad_group.id),
      status: row.ad_group?.status != null ? String(row.ad_group.status) : null,
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
  periodEnd: string,
  /**
   * PLN per account-currency unit over the 30-day period, per account id.
   * null = foreign currency without a rate: that account is skipped rather
   * than stored as złoty. Absent = PLN (the old behaviour).
   */
  pricePerUnit?: Map<string, number | null>
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
    const rate = pricePerUnit?.has(account.id) ? pricePerUnit.get(account.id) ?? null : 1;
    if (rate == null) {
      console.error("[google-ads] search terms skipped: no exchange rate", account.id);
      continue;
    }
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
          cost_minor_units: Math.round((t.cost_micros * rate) / 10_000),
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
  periodEnd: string,
  /** As in syncSearchTermsSnapshot. */
  pricePerUnit?: Map<string, number | null>
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
    const rate = pricePerUnit?.has(account.id) ? pricePerUnit.get(account.id) ?? null : 1;
    if (rate == null) {
      console.error("[google-ads] impression share skipped: no exchange rate", account.id);
      continue;
    }
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
          cost_minor_units: Math.round((m.cost_micros * rate) / 10_000),
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
