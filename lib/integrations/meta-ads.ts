// Meta Marketing API client via raw Graph API fetch (the SDK is finicky; the
// Graph endpoints we need are simple). Handles OAuth, ad-account listing and
// campaign insights. Amounts arrive as strings in the major unit (e.g. "12.34"
// PLN) and are converted to bigint minor units (grosze) by the caller.

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function appId(): string {
  return process.env.META_APP_ID!;
}
function appSecret(): string {
  return process.env.META_APP_SECRET!;
}
function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/meta/callback`;
}

export interface MetaAdAccount {
  id: string; // includes the `act_` prefix
  name: string;
  account_status: number;
  currency: string;
}

export interface MetaCampaignInsight {
  campaign_id: string;
  campaign_name: string;
  date: string; // yyyy-MM-dd (from date_start)
  spend: string;
  impressions: string;
  clicks: string;
  ctr?: string;
  cpc?: string;
  reach?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

/** OAuth dialog URL. `state` is a CSRF/one-time token we persist server-side. */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri(),
    state,
    scope: "ads_read,business_management",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

// Meta returns rich error bodies — surface them instead of swallowing.
async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${GRAPH_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json();

  if (!res.ok || body?.error) {
    const err = body?.error ?? {};
    console.error("[meta-ads] Graph API error", {
      path,
      status: res.status,
      message: err.message,
      code: err.code,
      error_subcode: err.error_subcode,
    });
    throw new Error(err.message ?? `Meta Graph API error (${res.status})`);
  }

  return body as T;
}

/**
 * Exchange an OAuth code for a long-lived (~60 day) user access token.
 * Two hops: code -> short-lived token -> long-lived token.
 */
export async function exchangeCodeForLongLivedToken(
  code: string
): Promise<{ access_token: string; expires_at: Date }> {
  const short = await graphGet<{ access_token: string }>("/oauth/access_token", {
    client_id: appId(),
    client_secret: appSecret(),
    redirect_uri: redirectUri(),
    code,
  });

  const long = await graphGet<{ access_token: string; expires_in?: number }>(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: appId(),
      client_secret: appSecret(),
      fb_exchange_token: short.access_token,
    }
  );

  // Default to 60 days if Meta omits expires_in.
  const expiresInSeconds = long.expires_in ?? 60 * 24 * 60 * 60;
  const expires_at = new Date(Date.now() + expiresInSeconds * 1000);

  return { access_token: long.access_token, expires_at };
}

/** List ad accounts the token can read. Ids keep their `act_` prefix. */
export async function listAdAccounts(
  accessToken: string
): Promise<MetaAdAccount[]> {
  const body = await graphGet<{ data: MetaAdAccount[] }>("/me/adaccounts", {
    fields: "id,name,account_status,currency",
    access_token: accessToken,
    limit: "200",
  });
  return body.data ?? [];
}

/** Inclusive list of yyyy-MM-dd strings between `since` and `until` (UTC). */
function eachDay(since: string, until: string): string[] {
  const days: string[] = [];
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Campaign-level daily insights for [since, until].
 *
 * We deliberately fetch ONE DAY AT A TIME rather than a single wide query with
 * `time_increment=1`. For large accounts (DRE has ~1900 campaigns) Meta silently
 * caps the row count of a wide multi-day query, so a 30-day pull returned only a
 * fraction of the spend. A single-day, fully-paginated query is small enough to
 * come back complete, and we tag every row with that day's date.
 */
export async function getCampaignInsights(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<MetaCampaignInsight[]> {
  const rows: MetaCampaignInsight[] = [];

  for (const day of eachDay(since, until)) {
    let body = await graphGet<{
      data: Array<Record<string, unknown>>;
      paging?: { next?: string };
    }>(`/${adAccountId}/insights`, {
      fields:
        "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions",
      level: "campaign",
      time_range: JSON.stringify({ since: day, until: day }),
      access_token: accessToken,
      limit: "500",
    });

    const dayRows: Array<Record<string, unknown>> = [...(body.data ?? [])];

    // One day of a big account can still span several pages — follow them all.
    let guard = 0;
    while (body.paging?.next && guard < 50) {
      guard += 1;
      const res = await fetch(body.paging.next, { cache: "no-store" });
      body = await res.json();
      if (body?.data?.length) dayRows.push(...body.data);
      else break;
    }

    for (const row of dayRows) {
      rows.push({
        campaign_id: String(row.campaign_id ?? ""),
        campaign_name: String(row.campaign_name ?? ""),
        date: String(row.date_start ?? day),
        spend: String(row.spend ?? "0"),
        impressions: String(row.impressions ?? "0"),
        clicks: String(row.clicks ?? "0"),
        ctr: row.ctr != null ? String(row.ctr) : undefined,
        cpc: row.cpc != null ? String(row.cpc) : undefined,
        reach: row.reach != null ? String(row.reach) : undefined,
        frequency: row.frequency != null ? String(row.frequency) : undefined,
        actions: row.actions as MetaCampaignInsight["actions"],
      });
    }
  }

  return rows;
}

export interface MetaAdInsight {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr?: string;
  cpc?: string;
}

/** Ad-level insights aggregated over [since, until] (one row per ad). */
export async function getAdInsights(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<MetaAdInsight[]> {
  const body = await graphGet<{ data: Array<Record<string, unknown>> }>(
    `/${adAccountId}/insights`,
    {
      fields: "ad_id,ad_name,campaign_id,spend,impressions,clicks,ctr,cpc",
      level: "ad",
      time_range: JSON.stringify({ since, until }),
      access_token: accessToken,
      limit: "500",
    }
  );

  return (body.data ?? []).map((row) => ({
    ad_id: String(row.ad_id ?? ""),
    ad_name: String(row.ad_name ?? ""),
    campaign_id: String(row.campaign_id ?? ""),
    spend: String(row.spend ?? "0"),
    impressions: String(row.impressions ?? "0"),
    clicks: String(row.clicks ?? "0"),
    ctr: row.ctr != null ? String(row.ctr) : undefined,
    cpc: row.cpc != null ? String(row.cpc) : undefined,
  }));
}

/** Map of ad_id -> creative thumbnail URL for an ad account. */
export async function getAdThumbnails(
  accessToken: string,
  adAccountId: string
): Promise<Map<string, string>> {
  const body = await graphGet<{
    data: Array<{ id?: string; creative?: { thumbnail_url?: string } }>;
  }>(`/${adAccountId}/ads`, {
    fields: "id,creative{thumbnail_url}",
    access_token: accessToken,
    limit: "500",
  });

  const map = new Map<string, string>();
  for (const ad of body.data ?? []) {
    if (ad.id && ad.creative?.thumbnail_url) {
      map.set(ad.id, ad.creative.thumbnail_url);
    }
  }
  return map;
}

/** Sum conversion-like actions. Tracked only — never displayed as ROAS. */
export function extractConversions(
  actions?: Array<{ action_type: string; value: string }>
): number {
  if (!actions?.length) return 0;
  return actions
    .filter(
      (a) => a.action_type.includes("conversion") || a.action_type === "lead"
    )
    .reduce((sum, a) => sum + Math.round(parseFloat(a.value || "0")), 0);
}
