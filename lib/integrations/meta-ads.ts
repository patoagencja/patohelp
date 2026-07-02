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

/**
 * Campaign-level daily insights for [since, until]. `time_increment=1` forces
 * one row per campaign per day so we can upsert by date.
 */
export async function getCampaignInsights(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<MetaCampaignInsight[]> {
  const rows: MetaCampaignInsight[] = [];

  const body = await graphGet<{
    data: Array<Record<string, unknown>>;
  }>(`/${adAccountId}/insights`, {
    fields:
      "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions",
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    limit: "500",
  });

  for (const row of body.data ?? []) {
    rows.push({
      campaign_id: String(row.campaign_id ?? ""),
      campaign_name: String(row.campaign_name ?? ""),
      date: String(row.date_start ?? since),
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

  return rows;
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
