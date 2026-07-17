// TikTok Marketing API (v1.3) client: OAuth + advertiser listing + campaign
// reporting. Spend arrives as a decimal string in the advertiser currency and
// is converted to bigint minor units (grosze) by the caller.

const BASE = "https://business-api.tiktok.com/open_api/v1.3";

function appId(): string {
  return process.env.TIKTOK_APP_ID!;
}
function appSecret(): string {
  return process.env.TIKTOK_APP_SECRET!;
}
function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/tiktok/callback`;
}

export interface TikTokAdvertiser {
  id: string;
  name: string;
}

export interface TikTokCampaignMetric {
  campaign_id: string;
  campaign_name: string;
  date: string; // yyyy-MM-dd
  spend: string;
  impressions: string;
  clicks: string;
  ctr?: string;
  cpc?: string;
  reach?: string;
  video_views?: string;
}

/** OAuth authorization URL. `state` is our one-time CSRF token. */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    app_id: appId(),
    state,
    redirect_uri: redirectUri(),
  });
  return `https://business-api.tiktok.com/portal/auth?${params.toString()}`;
}

// TikTok wraps every response in { code, message, data }. code 0 = success.
async function ttPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json();
  if (json.code !== 0) {
    console.error("[tiktok] API error", { path, code: json.code, message: json.message });
    throw new Error(json.message ?? `TikTok API error (code ${json.code})`);
  }
  return json.data as T;
}

async function ttGet<T>(
  path: string,
  params: Record<string, string>,
  accessToken?: string
): Promise<T> {
  const url = `${BASE}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: accessToken ? { "Access-Token": accessToken } : {},
    cache: "no-store",
  });
  const json = await res.json();
  if (json.code !== 0) {
    console.error("[tiktok] API error", { path, code: json.code, message: json.message });
    throw new Error(json.message ?? `TikTok API error (code ${json.code})`);
  }
  return json.data as T;
}

/** Exchange the auth code for a long-lived access token + advertiser ids. */
export async function exchangeCodeForToken(authCode: string): Promise<{
  access_token: string;
  advertiser_ids: string[];
}> {
  const data = await ttPost<{ access_token: string; advertiser_ids?: string[] }>(
    "/oauth2/access_token/",
    { app_id: appId(), secret: appSecret(), auth_code: authCode }
  );
  return {
    access_token: data.access_token,
    advertiser_ids: data.advertiser_ids ?? [],
  };
}

/** Names for the authorized advertiser accounts. */
export async function listAdvertisers(
  accessToken: string,
  advertiserIds: string[]
): Promise<TikTokAdvertiser[]> {
  const data = await ttGet<{ list: Array<{ advertiser_id: string; advertiser_name: string }> }>(
    "/oauth2/advertiser/get/",
    { app_id: appId(), secret: appSecret(), access_token: accessToken }
  );
  const named = new Map(
    (data.list ?? []).map((a) => [a.advertiser_id, a.advertiser_name])
  );
  // Fall back to ids we know about even if the list endpoint omits them.
  const ids = named.size ? Array.from(named.keys()) : advertiserIds;
  return ids.map((id) => ({ id, name: named.get(id) ?? id }));
}

/** Daily campaign metrics for [since, until] via the integrated report. */
export async function getCampaignMetrics(
  accessToken: string,
  advertiserId: string,
  since: string,
  until: string
): Promise<TikTokCampaignMetric[]> {
  const rows: TikTokCampaignMetric[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await ttGet<{
      list: Array<{
        dimensions: Record<string, string>;
        metrics: Record<string, string>;
      }>;
      page_info?: { total_page?: number };
    }>(
      "/report/integrated/get/",
      {
        advertiser_id: advertiserId,
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
        metrics: JSON.stringify([
          "campaign_name",
          "spend",
          "impressions",
          "clicks",
          "ctr",
          "cpc",
          "reach",
          "video_play_actions",
        ]),
        start_date: since,
        end_date: until,
        page: String(page),
        page_size: "1000",
      },
      accessToken
    );

    for (const row of data.list ?? []) {
      const d = row.dimensions ?? {};
      const m = row.metrics ?? {};
      rows.push({
        campaign_id: String(d.campaign_id ?? ""),
        campaign_name: String(m.campaign_name ?? ""),
        date: String(d.stat_time_day ?? `${since} 00:00:00`).slice(0, 10),
        spend: String(m.spend ?? "0"),
        impressions: String(m.impressions ?? "0"),
        clicks: String(m.clicks ?? "0"),
        ctr: m.ctr != null ? String(m.ctr) : undefined,
        cpc: m.cpc != null ? String(m.cpc) : undefined,
        reach: m.reach != null ? String(m.reach) : undefined,
        video_views: m.video_play_actions != null ? String(m.video_play_actions) : undefined,
      });
    }

    totalPages = data.page_info?.total_page ?? 1;
    page += 1;
  } while (page <= totalPages && page <= 50);

  return rows;
}
