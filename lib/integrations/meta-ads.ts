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
  /** Clicks (all): likes, comments, profile, "see more" AND link clicks. */
  clicks: string;
  ctr?: string;
  cpc?: string;
  /** inline_link_clicks - Ads Manager's "Kliknięcia linku". */
  link_clicks?: string;
  /** inline_link_click_ctr (percent). */
  link_ctr?: string;
  /** cost_per_inline_link_click (major units). */
  link_cpc?: string;
  reach?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
  /** Value per action type (account currency) - purchase value for shops. */
  action_values?: Array<{ action_type: string; value: string }>;
}

/** Paging URLs are fetched raw (not via graphGet): surface their errors too. */
function throwOnPageError(body: unknown): void {
  const err = (body as { error?: { message?: string } } | null)?.error;
  if (err) throw new Error(err.message ?? "Meta Graph API paging error");
}

/** Link-click insight fields, requested next to `clicks` everywhere. */
const LINK_CLICK_FIELDS = "inline_link_clicks,inline_link_click_ctr,cost_per_inline_link_click";

const strOrUndef = (v: unknown): string | undefined => (v != null ? String(v) : undefined);

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

// Meta returns rich error bodies - surface them instead of swallowing.
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
/**
 * Validate a pasted token and read its real expiry via /debug_token (app token
 * auth). Business Manager System User tokens can be issued with no expiry
 * (expires_at = 0), which is what stops Meta from disconnecting every 60 days.
 */
export async function inspectMetaToken(
  accessToken: string
): Promise<{ valid: boolean; expiresAt: Date | null; type: string | null }> {
  const body = await graphGet<{
    data?: { is_valid?: boolean; expires_at?: number; type?: string };
  }>("/debug_token", {
    input_token: accessToken,
    access_token: `${appId()}|${appSecret()}`,
  });
  const d = body.data ?? {};
  return {
    valid: d.is_valid === true,
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
    type: d.type ?? null,
  };
}

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

/** Who a token belongs to (a person, or a Business Manager system user). */
export interface MetaIdentity {
  id: string;
  name: string | null;
}

/**
 * /me for a token. Stored next to the token so a later reconnect with the same
 * login can be matched to every client that used it.
 */
export async function getMetaIdentity(accessToken: string): Promise<MetaIdentity> {
  const body = await graphGet<{ id?: string; name?: string }>("/me", {
    fields: "id,name",
    access_token: accessToken,
  });
  if (!body.id) throw new Error("Meta /me returned no id");
  return { id: String(body.id), name: body.name ?? null };
}

/**
 * Cheap access probe for one ad account (`act_<id>`): a field-less read that
 * fails unless the token can see the account. Used before reusing a token for
 * another client, so a login that lacks that client's accounts is never saved.
 */
export async function canAccessAdAccount(
  accessToken: string,
  adAccountId: string
): Promise<boolean> {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  try {
    const body = await graphGet<{ id?: string }>(`/${id}`, {
      fields: "id",
      access_token: accessToken,
    });
    return !!body.id;
  } catch {
    return false;
  }
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
        "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,action_values," +
        LINK_CLICK_FIELDS,
      level: "campaign",
      time_range: JSON.stringify({ since: day, until: day }),
      access_token: accessToken,
      limit: "500",
    });

    const dayRows: Array<Record<string, unknown>> = [...(body.data ?? [])];

    // One day of a big account can still span several pages - follow them all.
    let guard = 0;
    while (body.paging?.next && guard < 50) {
      guard += 1;
      const res = await fetch(body.paging.next, { cache: "no-store" });
      body = await res.json();
      // A failed page (rate limit mid-pagination) used to end the loop with a
      // partial day that was upserted as if complete - and a backfilled day
      // with rows is never re-pulled, so its spend stayed too low for good.
      throwOnPageError(body);
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
        link_clicks: strOrUndef(row.inline_link_clicks),
        link_ctr: strOrUndef(row.inline_link_click_ctr),
        link_cpc: strOrUndef(row.cost_per_inline_link_click),
        reach: row.reach != null ? String(row.reach) : undefined,
        frequency: row.frequency != null ? String(row.frequency) : undefined,
        actions: row.actions as MetaCampaignInsight["actions"],
        action_values: row.action_values as MetaCampaignInsight["action_values"],
      });
    }
  }

  return rows;
}

/**
 * Days in [since, until] on which the ad account delivered anything (Meta
 * only returns insight rows for days with activity). Account level gives at
 * most one row per day, so this is a few cheap requests; the range goes out
 * in 92-day slices to stay well clear of wide-query truncation.
 */
export async function getActiveDays(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<Set<string>> {
  const days = eachDay(since, until);
  const active = new Set<string>();
  for (let i = 0; i < days.length; i += 92) {
    const slice = days.slice(i, i + 92);
    let body = await graphGet<{
      data: Array<Record<string, unknown>>;
      paging?: { next?: string };
    }>(`/${adAccountId}/insights`, {
      fields: "impressions,spend",
      level: "account",
      time_increment: "1",
      time_range: JSON.stringify({ since: slice[0], until: slice[slice.length - 1] }),
      access_token: accessToken,
      limit: "500",
    });
    const raw: Array<Record<string, unknown>> = [...(body.data ?? [])];
    let guard = 0;
    while (body.paging?.next && guard < 10) {
      guard += 1;
      const res = await fetch(body.paging.next, { cache: "no-store" });
      body = await res.json();
      throwOnPageError(body);
      if (body?.data?.length) raw.push(...body.data);
      else break;
    }
    for (const row of raw) {
      if (row.date_start) active.add(String(row.date_start));
    }
  }
  return active;
}

export interface MetaAdsetInsight {
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  date: string;
  spend: string;
  impressions: string;
  /** Clicks (all). */
  clicks: string;
  /** inline_link_clicks. */
  link_clicks?: string;
  reach?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

/**
 * Ad-set-level daily insights (time_increment=1) for [since, until], for ad
 * set goals. Wide multi-day queries get silently truncated on big accounts
 * (see getCampaignInsights), so the range goes out in 7-day slices, each
 * fully paginated. `shouldStop` lets the cron cut the work short at its time
 * budget; slices already fetched are returned.
 */
export async function getAdsetInsights(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string,
  shouldStop: () => boolean = () => false,
  /** Only this campaign's ad sets (the goal form's on-demand fetch). */
  campaignId?: string
): Promise<MetaAdsetInsight[]> {
  const days = eachDay(since, until);
  const rows: MetaAdsetInsight[] = [];
  for (let i = 0; i < days.length; i += 7) {
    if (shouldStop()) break;
    const slice = days.slice(i, i + 7);
    let body = await graphGet<{
      data: Array<Record<string, unknown>>;
      paging?: { next?: string };
    }>(`/${adAccountId}/insights`, {
      fields: "adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,reach,actions",
      level: "adset",
      time_increment: "1",
      time_range: JSON.stringify({ since: slice[0], until: slice[slice.length - 1] }),
      ...(campaignId
        ? {
            filtering: JSON.stringify([
              { field: "campaign.id", operator: "IN", value: [campaignId] },
            ]),
          }
        : {}),
      access_token: accessToken,
      limit: "500",
    });
    const raw: Array<Record<string, unknown>> = [...(body.data ?? [])];
    let guard = 0;
    while (body.paging?.next && guard < 50) {
      guard += 1;
      const res = await fetch(body.paging.next, { cache: "no-store" });
      body = await res.json();
      // A failed page used to end the loop silently with partial data.
      throwOnPageError(body);
      if (body?.data?.length) raw.push(...body.data);
      else break;
    }
    for (const row of raw) {
      if (!row.adset_id) continue;
      rows.push({
        adset_id: String(row.adset_id),
        adset_name: String(row.adset_name ?? ""),
        campaign_id: String(row.campaign_id ?? ""),
        campaign_name: String(row.campaign_name ?? ""),
        date: String(row.date_start ?? slice[0]),
        spend: String(row.spend ?? "0"),
        impressions: String(row.impressions ?? "0"),
        clicks: String(row.clicks ?? "0"),
        link_clicks: strOrUndef(row.inline_link_clicks),
        reach: row.reach != null ? String(row.reach) : undefined,
        actions: row.actions as MetaAdsetInsight["actions"],
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
  /** Clicks (all). */
  clicks: string;
  ctr?: string;
  cpc?: string;
  link_clicks?: string;
  link_ctr?: string;
  link_cpc?: string;
  /**
   * Creative diagnostics. All null when Meta omits them (static ads have no
   * video metrics; rankings need 500+ impressions) or when the extended
   * request had to fall back to the base fields.
   */
  reach: number | null;
  frequency: number | null;
  quality_ranking: string | null;
  engagement_rate_ranking: string | null;
  conversion_rate_ranking: string | null;
  /** video_play_actions - plays started; autoplay makes this ~= impressions. */
  video_plays: number | null;
  /** actions[video_view] - what Ads Manager calls "3-second video plays". */
  video_3s_views: number | null;
  video_thruplays: number | null;
  video_p25: number | null;
  video_p50: number | null;
  video_p75: number | null;
  video_p100: number | null;
  /** Seconds. */
  video_avg_watch_seconds: number | null;
}

type MetaActionList = Array<{ action_type?: string; value?: string }>;

const AD_BASE_FIELDS = `ad_id,ad_name,campaign_id,spend,impressions,clicks,ctr,cpc,${LINK_CLICK_FIELDS}`;

// `video_play_actions` only counts plays *started* (autoplay included), so it
// cannot measure a "hook". Meta exposes 3-second plays as the `video_view`
// entry of `actions`, which is why `actions` is requested here too.
const AD_EXTENDED_FIELDS = [
  AD_BASE_FIELDS,
  "reach",
  "frequency",
  "quality_ranking",
  "engagement_rate_ranking",
  "conversion_rate_ranking",
  "actions",
  "video_play_actions",
  "video_thruplay_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
  "video_avg_time_watched_actions",
].join(",");

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Video metrics arrive as action lists (normally one `video_view` entry).
 * A missing list means "not a video" and must stay null, not 0.
 */
function sumActions(v: unknown, actionType?: string): number | null {
  if (!Array.isArray(v)) return null;
  let total: number | null = null;
  for (const a of v as MetaActionList) {
    if (actionType && a.action_type !== actionType) continue;
    const n = num(a.value);
    if (n != null) total = (total ?? 0) + n;
  }
  return total;
}

function rankingOf(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null;
}

async function fetchAdInsightRows(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string,
  fields: string
): Promise<Array<Record<string, unknown>>> {
  let body = await graphGet<{
    data: Array<Record<string, unknown>>;
    paging?: { next?: string };
  }>(`/${adAccountId}/insights`, {
    fields,
    level: "ad",
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    limit: "500",
  });
  const rows: Array<Record<string, unknown>> = [...(body.data ?? [])];

  // Accounts with many ads span several pages; a single page silently
  // dropped every ad past the 500th.
  let guard = 0;
  while (body.paging?.next && guard < 50) {
    guard += 1;
    const res = await fetch(body.paging.next, { cache: "no-store" });
    body = await res.json();
    throwOnPageError(body);
    if (body?.data?.length) rows.push(...body.data);
    else break;
  }
  return rows;
}

/** Ad-level insights aggregated over [since, until] (one row per ad). */
export async function getAdInsights(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<MetaAdInsight[]> {
  let raw: Array<Record<string, unknown>>;
  try {
    raw = await fetchAdInsightRows(accessToken, adAccountId, since, until, AD_EXTENDED_FIELDS);
  } catch (err) {
    // A renamed/deprecated diagnostic field must not cost the client their
    // whole Kreacje tab: retry with the fields that have always worked.
    console.warn(
      "[meta-ads] extended ad insights failed, retrying with base fields",
      err instanceof Error ? err.message : err
    );
    raw = await fetchAdInsightRows(accessToken, adAccountId, since, until, AD_BASE_FIELDS);
  }

  return raw.map((row) => ({
    ad_id: String(row.ad_id ?? ""),
    ad_name: String(row.ad_name ?? ""),
    campaign_id: String(row.campaign_id ?? ""),
    spend: String(row.spend ?? "0"),
    impressions: String(row.impressions ?? "0"),
    clicks: String(row.clicks ?? "0"),
    ctr: row.ctr != null ? String(row.ctr) : undefined,
    cpc: row.cpc != null ? String(row.cpc) : undefined,
    link_clicks: strOrUndef(row.inline_link_clicks),
    link_ctr: strOrUndef(row.inline_link_click_ctr),
    link_cpc: strOrUndef(row.cost_per_inline_link_click),
    reach: num(row.reach),
    frequency: num(row.frequency),
    quality_ranking: rankingOf(row.quality_ranking),
    engagement_rate_ranking: rankingOf(row.engagement_rate_ranking),
    conversion_rate_ranking: rankingOf(row.conversion_rate_ranking),
    video_plays: sumActions(row.video_play_actions),
    video_3s_views: sumActions(row.actions, "video_view"),
    video_thruplays: sumActions(row.video_thruplay_watched_actions),
    video_p25: sumActions(row.video_p25_watched_actions),
    video_p50: sumActions(row.video_p50_watched_actions),
    video_p75: sumActions(row.video_p75_watched_actions),
    video_p100: sumActions(row.video_p100_watched_actions),
    // An average must not be summed across entries - take the first one.
    video_avg_watch_seconds: Array.isArray(row.video_avg_time_watched_actions)
      ? num((row.video_avg_time_watched_actions as MetaActionList)[0]?.value)
      : null,
  }));
}

interface Creative {
  image_url?: string;
  thumbnail_url?: string;
  video_id?: string;
  object_type?: string;
  object_story_spec?: {
    link_data?: {
      picture?: string;
      child_attachments?: Array<{ picture?: string }>;
    };
    video_data?: { image_url?: string; video_id?: string };
  };
}

/** The video id attached to a creative, wherever Meta chose to put it. */
function creativeVideoId(c?: Creative): string | undefined {
  return c?.video_id ?? c?.object_story_spec?.video_data?.video_id ?? undefined;
}

/**
 * Best NON-video source for a creative (full image or the story-spec picture).
 * `thumbnail_url` is deliberately last — it is the tiny ~64px frame that looks
 * blurry when rendered larger, so we only fall back to it when nothing else is
 * available.
 */
function bestStaticUrl(c?: Creative): string | undefined {
  return (
    c?.image_url ||
    c?.object_story_spec?.video_data?.image_url ||
    c?.object_story_spec?.link_data?.picture ||
    // Carousels: first card's picture (link_data.picture is empty for them).
    c?.object_story_spec?.link_data?.child_attachments?.find((a) => a.picture)
      ?.picture ||
    c?.thumbnail_url
  );
}

/**
 * Resolve a full-resolution cover frame for a video by asking the video node
 * directly. Meta exposes several thumbnail sizes here; the small `thumbnail_url`
 * on the creative is not one we want. Prefer the `is_preferred` frame, else the
 * widest. Returns undefined on any error so the caller can fall back.
 */
async function resolveVideoThumbnail(
  accessToken: string,
  videoId: string
): Promise<string | undefined> {
  try {
    const body = await graphGet<{
      picture?: string;
      thumbnails?: {
        data?: Array<{
          uri?: string;
          width?: number;
          is_preferred?: boolean;
        }>;
      };
    }>(`/${videoId}`, {
      // `picture` is a single decent-size frame that works even when the
      // thumbnails edge is empty; thumbnails give us the highest-res option.
      fields: "picture,thumbnails{uri,width,height,is_preferred}",
      access_token: accessToken,
    });

    const frames = body.thumbnails?.data ?? [];
    const preferred = frames.find((f) => f.is_preferred && f.uri);
    if (preferred?.uri) return preferred.uri;

    const widest = [...frames]
      .filter((f) => f.uri)
      .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
    if (widest?.uri) return widest.uri;

    return body.picture || undefined;
  } catch {
    return undefined;
  }
}

/** Run async tasks with a small concurrency cap (Meta rate-limits hard). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Map of ad_id -> creative thumbnail URL for an ad account.
 *
 * Video ads are the tricky case: their creative only carries a tiny ~64px
 * `thumbnail_url`, so we resolve a sharp cover frame from the video node
 * (`/{video_id}?fields=thumbnails`). Static ads keep using `image_url` /
 * story-spec picture, which are already full-size.
 */
export async function getAdThumbnails(
  accessToken: string,
  adAccountId: string
): Promise<Map<string, string>> {
  // Rich query first. We request object_story_spec WHOLESALE (not sub-selected)
  // because sub-selecting a field Meta doesn't recognise makes the entire query
  // throw - which previously dropped us to BASIC and left every video ad on its
  // blurry 64px thumbnail_url. If it still fails, BASIC keeps the sync alive.
  // thumbnail_width/height must be applied AS FIELD MODIFIERS on the nested
  // creative request - as top-level query params on /ads they are silently
  // ignored and thumbnail_url stays at its blurry ~64px default. With the
  // modifier Meta renders the thumbnail at the requested size for EVERY
  // creative type: static, video, carousel and catalog/DPA (where it picks a
  // sample product image - the only image such creatives have).
  const MOD = "creative.thumbnail_width(1080).thumbnail_height(1080)";
  const RICH = `id,${MOD}{id,object_type,image_url,thumbnail_url,video_id,object_story_spec}`;
  const BASIC = `id,${MOD}{id,image_url,thumbnail_url}`;

  let data: Array<{ id?: string; creative?: Creative }> = [];
  try {
    const body = await graphGet<{ data: typeof data }>(`/${adAccountId}/ads`, {
      fields: RICH,
      access_token: accessToken,
      limit: "500",
    });
    data = body.data ?? [];
  } catch {
    const body = await graphGet<{ data: typeof data }>(`/${adAccountId}/ads`, {
      fields: BASIC,
      access_token: accessToken,
      limit: "500",
    });
    data = body.data ?? [];
  }

  const map = new Map<string, string>();

  // First pass: static sources we already have, and collect the video ads that
  // need a follow-up lookup (dedup by video id to avoid re-fetching shared
  // videos across many ads).
  const videoAds: Array<{ adId: string; videoId: string }> = [];
  const seenVideoIds = new Set<string>();
  for (const ad of data) {
    if (!ad.id) continue;
    const videoId = creativeVideoId(ad.creative);
    if (videoId) {
      videoAds.push({ adId: ad.id, videoId });
      seenVideoIds.add(videoId);
      // Seed with the static fallback in case the video lookup fails.
      const fallback = bestStaticUrl(ad.creative);
      if (fallback) map.set(ad.id, fallback);
    } else {
      const url = bestStaticUrl(ad.creative);
      if (url) map.set(ad.id, url);
    }
  }

  // Second pass: resolve sharp frames for each unique video, then apply to ads.
  const uniqueVideoIds = [...seenVideoIds];
  const resolved = await mapLimit(uniqueVideoIds, 6, async (videoId) => ({
    videoId,
    uri: await resolveVideoThumbnail(accessToken, videoId),
  }));
  const videoThumb = new Map<string, string>();
  for (const { videoId, uri } of resolved) {
    if (uri) videoThumb.set(videoId, uri);
  }
  for (const { adId, videoId } of videoAds) {
    const sharp = videoThumb.get(videoId);
    if (sharp) map.set(adId, sharp);
  }

  return map;
}

/**
 * Age & gender breakdown for [since, until], by impressions. Two calls (Meta
 * only allows one primary breakdown cleanly here). Buckets: age "25-34", gender
 * "male"/"female"/"unknown".
 */
export async function getDemographics(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<{
  age: Array<{ bucket: string; value: number }>;
  gender: Array<{ bucket: string; value: number }>;
}> {
  const query = (breakdown: "age" | "gender") =>
    graphGet<{ data: Array<Record<string, unknown>> }>(
      `/${adAccountId}/insights`,
      {
        fields: "impressions",
        level: "account",
        breakdowns: breakdown,
        time_range: JSON.stringify({ since, until }),
        access_token: accessToken,
        limit: "100",
      }
    );

  const [ageBody, genderBody] = await Promise.all([query("age"), query("gender")]);

  return {
    age: (ageBody.data ?? []).map((r) => ({
      bucket: String(r.age ?? ""),
      value: parseInt(String(r.impressions ?? "0"), 10) || 0,
    })),
    gender: (genderBody.data ?? []).map((r) => ({
      bucket: String(r.gender ?? ""),
      value: parseInt(String(r.impressions ?? "0"), 10) || 0,
    })),
  };
}

// Meta reports one purchase under several overlapping action types (omni =
// web + app + on-Facebook; the pixel one is web only). Take the broadest one
// present - summing them would count every order two or three times.
const PURCHASE_TYPES = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
];

/**
 * Purchases and their value (account currency, major units) for shop
 * clients' sales-from-ads numbers. Zero when the account tracks no purchases.
 */
export function extractPurchases(
  actions?: Array<{ action_type: string; value: string }>,
  actionValues?: Array<{ action_type: string; value: string }>
): { purchases: number; value: number } {
  const pick = (list?: Array<{ action_type: string; value: string }>) => {
    for (const type of PURCHASE_TYPES) {
      const hit = list?.find((a) => a.action_type === type);
      if (hit) return parseFloat(hit.value || "0") || 0;
    }
    return 0;
  };
  return { purchases: Math.round(pick(actions)), value: pick(actionValues) };
}

/** Sum conversion-like actions. Tracked only - never displayed as ROAS. */
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
