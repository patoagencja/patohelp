// Google Ads API client via the `google-ads-api` package. Handles OAuth,
// account discovery and campaign metrics. Google reports money in micros
// (1 unit = 1_000_000 micros); we convert to bigint minor units (grosze) with
// Math.round(micros / 10_000).
import { GoogleAdsApi } from "google-ads-api";

function clientId(): string {
  return process.env.GOOGLE_ADS_CLIENT_ID!;
}
function clientSecret(): string {
  return process.env.GOOGLE_ADS_CLIENT_SECRET!;
}
function loginCustomerId(): string {
  return process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!;
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
      const customer = client.Customer({
        customer_id: customerId,
        login_customer_id: loginCustomerId(),
        refresh_token: refreshToken,
      });

      const rows = await customer.query(
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
  until: string
): Promise<GoogleCampaignMetric[]> {
  const client = apiClient();
  const customer = client.Customer({
    customer_id: customerId,
    login_customer_id: loginCustomerId(),
    refresh_token: refreshToken,
  });

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
  `;

  const rows = await customer.query(gaql);

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
