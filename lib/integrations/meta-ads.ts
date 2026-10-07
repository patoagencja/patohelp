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
  /**
   * Value per action type (account currency) - purchase value for shops.
   * Only requested for seasonal / shop clients (see getCampaignInsights).
   */
  action_values?: Array<{ action_type: string; value: string }>;
  /** ISO code of the ad account's currency; every amount above is in it. */
  account_currency?: string;
}

// ---------------------------------------------------------------- errors

/**
 * Who a throttle applies to. Meta counts some limits per app (code 4), some
 * per user token (17) and most per ad account / business (business use case
 * 80000-80014, 613 call-type limits, 32 page limits, and code 17 with
 * subcode 2446079). The crons stop only what the limit covers: one
 * throttled market account must not cost the other six their fresh numbers.
 */
export type MetaThrottleScope = "app" | "user" | "account";

/**
 * Meta said "too many calls". Retrying right away only extends the block,
 * so callers skip the remaining work it covers for the rest of the run.
 */
export class MetaThrottledError extends Error {
  readonly code: number;
  readonly subcode: number | null;
  readonly scope: MetaThrottleScope;
  /** When Meta expects access back (headers), in ms; null if it didn't say. */
  readonly retryAfterMs: number | null;
  constructor(
    message: string,
    code: number,
    scope: MetaThrottleScope,
    retryAfterMs: number | null,
    subcode: number | null = null
  ) {
    super(message);
    this.name = "MetaThrottledError";
    this.code = code;
    this.subcode = subcode;
    this.scope = scope;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * "Please reduce the amount of data you're asking for, then retry your
 * request": the query itself is too big. Narrower slices go through.
 */
export class MetaDataVolumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaDataVolumeError";
  }
}

/** Short, log-safe text for a throttle (no ids, no token). */
export function describeThrottle(err: MetaThrottledError): string {
  const wait =
    err.retryAfterMs != null && err.retryAfterMs > 0
      ? `, dostęp za ~${Math.max(1, Math.round(err.retryAfterMs / 60_000))} min`
      : "";
  const code = err.subcode != null ? `${err.code}/${err.subcode}` : String(err.code);
  return `limit zapytań Meta (kod ${code}${wait}) - pominięte do następnego przebiegu`;
}

/**
 * "Ad Account Has Too Many API Calls": arrives as code 17 - the per-user
 * code - but counts calls to ONE ad account. Read as user-level it stopped
 * every other account of the token (DRE has ~46) for one busy account.
 */
export const AD_ACCOUNT_TOO_MANY_CALLS = 2446079;

/**
 * Insights throttling of ONE ad account: code 4 (normally the app-wide
 * limit) with these subcodes. Read as app-wide, one busy account stopped
 * every client of the run.
 */
const INSIGHTS_ACCOUNT_SUBCODES = new Set([1504022, 1504039]);

/** Null = not a throttle. Exported for the unit tests. */
export function throttleScope(
  code: number,
  httpStatus: number,
  subcode: number | null = null
): MetaThrottleScope | null {
  if (code === 4) return subcode != null && INSIGHTS_ACCOUNT_SUBCODES.has(subcode) ? "account" : "app";
  if (code === 17) return subcode === AD_ACCOUNT_TOO_MANY_CALLS ? "account" : "user";
  if (subcode === AD_ACCOUNT_TOO_MANY_CALLS) return "account";
  if (code === 32 || code === 613 || (code >= 80000 && code <= 80014)) return "account";
  if (httpStatus === 429) return "account";
  return null;
}

/**
 * Wait time from Meta's usage headers: x-business-use-case-usage carries
 * estimated_time_to_regain_access (minutes) per business use case,
 * x-ad-account-usage a reset_time_duration (seconds). The longest wins.
 */
function retryAfterFromHeaders(headers: Headers): number | null {
  let best: number | null = null;
  const take = (ms: number) => {
    if (Number.isFinite(ms) && ms > 0) best = Math.max(best ?? 0, ms);
  };
  const buc = headers.get("x-business-use-case-usage");
  if (buc) {
    try {
      const parsed = JSON.parse(buc) as Record<string, Array<{ estimated_time_to_regain_access?: unknown }>>;
      for (const list of Object.values(parsed ?? {})) {
        for (const entry of Array.isArray(list) ? list : []) {
          take(Number(entry?.estimated_time_to_regain_access) * 60_000);
        }
      }
    } catch {
      /* malformed header: no hint */
    }
  }
  const account = headers.get("x-ad-account-usage");
  if (account) {
    try {
      take(Number((JSON.parse(account) as { reset_time_duration?: unknown })?.reset_time_duration) * 1000);
    } catch {
      /* malformed header: no hint */
    }
  }
  return best;
}

// ---------------------------------------------------------------- transport

/**
 * Per request. Without it one hung insights call held a cron until Vercel
 * killed it - sync_runs stuck on "running", every later client skipped.
 */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Insights requests: a day of a ~1900-campaign account (DRE) or of OLX can
 * take Meta longer than 30 s to build. Cut at 30 s, such a day failed on
 * every run and was never stored; light calls (ids, /me, video frames)
 * keep the short limit.
 */
const INSIGHTS_TIMEOUT_MS = 60_000;
/** Page size retried when Meta asks for less data per request. */
const SMALL_PAGE = 100;

const timeoutFor = (path: string) =>
  path.endsWith("/insights") ? INSIGHTS_TIMEOUT_MS : REQUEST_TIMEOUT_MS;

/**
 * GET one Graph URL (built by graphGet, or a `paging.next` link, which
 * already carries the token). `context` is what gets logged - never the URL,
 * it contains the access token.
 */
async function graphFetch<T>(url: string, context: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const timedOut = (err: unknown) => (err as { name?: string })?.name === "TimeoutError";
  const timeoutError = () =>
    new Error(`Meta Graph API timeout after ${timeoutMs / 1000}s (${context})`);
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw timedOut(err) ? timeoutError() : err;
  }
  let body: { error?: { message?: string; code?: unknown; error_subcode?: unknown } } | null = null;
  try {
    body = await res.json();
  } catch (err) {
    // The timeout also covers reading the body.
    if (timedOut(err)) throw timeoutError();
    body = null; // an HTML error page from a proxy: handled below
  }

  if (!res.ok || !body || body.error) {
    const err = body?.error ?? {};
    const code = Number(err.code ?? 0);
    const subcode = err.error_subcode != null && Number.isFinite(Number(err.error_subcode))
      ? Number(err.error_subcode)
      : null;
    const message = err.message ?? `Meta Graph API error (${res.status})`;
    const scope = throttleScope(code, res.status, subcode);
    if (scope) {
      const retryAfterMs = retryAfterFromHeaders(res.headers);
      console.warn("[meta-ads] Graph API throttled", {
        context,
        status: res.status,
        code,
        error_subcode: subcode,
        scope,
        retryAfterMs,
      });
      throw new MetaThrottledError(message, code, scope, retryAfterMs, subcode);
    }
    console.error("[meta-ads] Graph API error", {
      path: context,
      status: res.status,
      message: err.message,
      code: err.code,
      error_subcode: err.error_subcode,
    });
    if (/reduce the amount of data/i.test(message)) throw new MetaDataVolumeError(message);
    throw new Error(message);
  }
  return body as T;
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
  return graphFetch<T>(url, path, timeoutFor(path));
}

type GraphRow = Record<string, unknown>;
interface GraphPage {
  data?: GraphRow[];
  paging?: { next?: string };
}

/**
 * The first page of `path` and every `paging.next` after it.
 * - maxPages: pages read at most, the first included;
 * - onCap "throw" where a partial result would be stored as complete (a
 *   day with half its spend is never re-pulled), "stop" where partial is
 *   fine - `complete` then says so;
 * - done: checked before each further page; true ends the listing early
 *   (e.g. every wanted ad seen). `complete` is false then too.
 * Any failed page throws: rows of a rate-limited page used to vanish
 * silently and the day was stored as if whole.
 */
async function graphGetAll(
  path: string,
  params: Record<string, string>,
  opts: { maxPages: number; onCap: "throw" | "stop"; done?: (rows: GraphRow[]) => boolean }
): Promise<{ rows: GraphRow[]; complete: boolean }> {
  let body: GraphPage;
  try {
    body = await graphGet<GraphPage>(path, params);
  } catch (err) {
    // A smaller page is often enough for "reduce the amount of data".
    if (err instanceof MetaDataVolumeError && Number(params.limit ?? 0) > SMALL_PAGE) {
      body = await graphGet<GraphPage>(path, { ...params, limit: String(SMALL_PAGE) });
    } else {
      throw err;
    }
  }
  const rows: GraphRow[] = [...(body.data ?? [])];
  let pages = 1;
  while (body.paging?.next) {
    if (opts.done?.(rows)) return { rows, complete: false };
    if (pages >= opts.maxPages) {
      if (opts.onCap === "throw") throw new Error(`Meta ${path}: more than ${opts.maxPages} pages`);
      return { rows, complete: false };
    }
    pages += 1;
    body = await graphFetch<GraphPage>(body.paging.next, `${path} (page ${pages})`, timeoutFor(path));
    if (body?.data?.length) rows.push(...body.data);
    else break;
  }
  return { rows, complete: true };
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
 *
 * `actionValues` adds purchase values (action_values): only seasonal and
 * shop clients use them, and for an engagement client with ~1900 campaigns
 * they only bloated every stored raw_data row.
 */
export async function getCampaignInsights(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string,
  opts: { actionValues?: boolean } = {}
): Promise<MetaCampaignInsight[]> {
  const rows: MetaCampaignInsight[] = [];

  for (const day of eachDay(since, until)) {
    // One day of a big account can still span several pages - follow them
    // all. A failed page throws (it used to end the loop with a partial day
    // that was upserted as if complete - and a backfilled day with rows is
    // never re-pulled, so its spend stayed too low for good); so does a day
    // past the page cap.
    const { rows: dayRows } = await graphGetAll(
      `/${adAccountId}/insights`,
      {
        fields:
          "campaign_id,campaign_name,account_currency,spend,impressions,clicks,ctr,cpc,reach,frequency,actions," +
          (opts.actionValues ? "action_values," : "") +
          LINK_CLICK_FIELDS,
        level: "campaign",
        time_range: JSON.stringify({ since: day, until: day }),
        access_token: accessToken,
        limit: "500",
      },
      { maxPages: 51, onCap: "throw" }
    );

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
        ...(opts.actionValues
          ? { action_values: row.action_values as MetaCampaignInsight["action_values"] }
          : {}),
        account_currency: strOrUndef(row.account_currency),
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
    const { rows: raw } = await graphGetAll(
      `/${adAccountId}/insights`,
      {
        fields: "impressions,spend",
        level: "account",
        time_increment: "1",
        time_range: JSON.stringify({ since: slice[0], until: slice[slice.length - 1] }),
        access_token: accessToken,
        limit: "500",
      },
      { maxPages: 11, onCap: "stop" }
    );
    for (const row of raw) {
      if (row.date_start) active.add(String(row.date_start));
    }
  }
  return active;
}

/**
 * Rows for a multi-day slice. When Meta answers "reduce the amount of data"
 * the same days go out one by one - a single day is the narrowest a daily
 * query gets, so if that still fails the error stands.
 */
async function bySliceOrDay(
  days: string[],
  fetchRange: (since: string, until: string) => Promise<GraphRow[]>
): Promise<GraphRow[]> {
  try {
    return await fetchRange(days[0], days[days.length - 1]);
  } catch (err) {
    if (!(err instanceof MetaDataVolumeError) || days.length <= 1) throw err;
    const out: GraphRow[] = [];
    for (const day of days) out.push(...(await fetchRange(day, day)));
    return out;
  }
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
    const raw = await bySliceOrDay(slice, async (from, to) =>
      (
        await graphGetAll(
          `/${adAccountId}/insights`,
          {
            fields:
              "adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,reach,actions",
            level: "adset",
            time_increment: "1",
            time_range: JSON.stringify({ since: from, until: to }),
            ...(campaignId
              ? {
                  filtering: JSON.stringify([
                    { field: "campaign.id", operator: "IN", value: [campaignId] },
                  ]),
                }
              : {}),
            access_token: accessToken,
            limit: "500",
          },
          { maxPages: 51, onCap: "stop" }
        )
      ).rows
    );
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
  /** ISO code of the ad account's currency (spend / CPC are in it). */
  account_currency: string | null;
}

type MetaActionList = Array<{ action_type?: string; value?: string }>;

const AD_BASE_FIELDS = `ad_id,ad_name,campaign_id,account_currency,spend,impressions,clicks,ctr,cpc,${LINK_CLICK_FIELDS}`;

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
  // Accounts with many ads span several pages; a single page silently
  // dropped every ad past the 500th.
  const { rows } = await graphGetAll(
    `/${adAccountId}/insights`,
    {
      fields,
      level: "ad",
      time_range: JSON.stringify({ since, until }),
      access_token: accessToken,
      limit: "500",
    },
    { maxPages: 51, onCap: "stop" }
  );
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
    // Throttled: the base fields would only be one more rejected call.
    if (err instanceof MetaThrottledError) throw err;
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
    account_currency: strOrUndef(row.account_currency) ?? null,
  }));
}

export interface MetaAdDailyInsight {
  ad_id: string;
  ad_name: string;
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  /** yyyy-MM-dd (the row's date_start). */
  date: string;
  /** Major units (account currency), as Meta sends it. */
  spend: number;
  impressions: number;
  /** clicks (all). */
  clicks_all: number;
  /** inline_link_clicks - 0 when Meta omits it (no link clicks that day). */
  link_clicks: number;
  reach: number | null;
  frequency: number | null;
  purchases: number;
  /** Purchase value, major units. */
  purchase_value: number;
  /** actions[video_view] (3-second plays); null for non-video ads. */
  video_3s_views: number | null;
  /** ISO code of the ad account's currency (spend / purchase value). */
  currency: string | null;
}

/**
 * Days per ad-level daily request. A shop running dozens of ads per ad set
 * has thousands of ad-days a week; wide ad x day queries are where Meta
 * truncates silently or times out ("reduce the amount of data"), so ad
 * level goes out in much narrower slices than ad sets (7 days).
 */
const AD_DAILY_SLICE_DAYS = 3;

const AD_DAILY_FIELDS =
  "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,account_currency,spend,impressions,clicks," +
  "inline_link_clicks,reach,frequency,actions,action_values";

/**
 * Ad-level DAILY insights (time_increment=1) for [since, until], with
 * purchases and their value - the input of the creative test view. Every
 * slice is fully paginated and a failed page throws: a partial day stored
 * as complete would make a losing ad look like it stopped selling. A slice
 * Meta finds too big ("reduce the amount of data") is retried day by day.
 * `shouldStop` lets a cron end between slices; slices already fetched are
 * returned.
 */
export async function getAdDailyInsights(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string,
  shouldStop: () => boolean = () => false
): Promise<MetaAdDailyInsight[]> {
  const days = eachDay(since, until);
  const rows: MetaAdDailyInsight[] = [];
  for (let i = 0; i < days.length; i += AD_DAILY_SLICE_DAYS) {
    if (i > 0 && shouldStop()) break;
    const slice = days.slice(i, i + AD_DAILY_SLICE_DAYS);
    const raw = await bySliceOrDay(slice, async (from, to) =>
      (
        await graphGetAll(
          `/${adAccountId}/insights`,
          {
            fields: AD_DAILY_FIELDS,
            level: "ad",
            time_increment: "1",
            time_range: JSON.stringify({ since: from, until: to }),
            access_token: accessToken,
            limit: "500",
          },
          // 200 pages x 500 rows = 100 000 ad-days in 3 days: far past any
          // real account. Stopping there would store a partial slice as
          // complete, so the cap throws.
          { maxPages: 200, onCap: "throw" }
        )
      ).rows
    );
    for (const row of raw) {
      if (!row.ad_id) continue;
      const actions = row.actions as Array<{ action_type: string; value: string }> | undefined;
      const values = row.action_values as Array<{ action_type: string; value: string }> | undefined;
      const sale = extractPurchases(actions, values);
      rows.push({
        ad_id: String(row.ad_id),
        ad_name: String(row.ad_name ?? ""),
        adset_id: String(row.adset_id ?? ""),
        adset_name: String(row.adset_name ?? ""),
        campaign_id: String(row.campaign_id ?? ""),
        campaign_name: String(row.campaign_name ?? ""),
        date: String(row.date_start ?? slice[0]),
        spend: num(row.spend) ?? 0,
        impressions: Math.round(num(row.impressions) ?? 0),
        clicks_all: Math.round(num(row.clicks) ?? 0),
        link_clicks: Math.round(num(row.inline_link_clicks) ?? 0),
        reach: num(row.reach),
        frequency: num(row.frequency),
        purchases: sale.purchases,
        purchase_value: sale.value,
        video_3s_views: sumActions(row.actions, "video_view"),
        currency: strOrUndef(row.account_currency) ?? null,
      });
    }
  }
  return rows;
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
 * widest. Returns undefined on any error so the caller can fall back - except
 * a throttle, which must stop the remaining lookups instead of hammering.
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
  } catch (err) {
    if (err instanceof MetaThrottledError) throw err;
    return undefined;
  }
}

/** Ids per `GET /?ids=` request - the Graph API's batch read limit. */
const IDS_PER_REQUEST = 50;
/** Failed by-id requests one thumbnail pass tolerates before giving up. */
const MAX_FAILED_LOOKUPS = 8;
/**
 * Ads looked up per call unless the caller says otherwise (20 requests). A
 * huge account's first fill - thousands of delivering ads, none stored yet -
 * spreads over a few runs instead of eating one run's whole budget.
 */
const MAX_THUMBNAIL_IDS = 1000;

export interface AdThumbnails {
  /** ad_id -> picture URL, for the ads a picture was found for. */
  thumbnails: Map<string, string>;
  /**
   * The throttle that ended the lookups early, if any. Returned rather than
   * thrown: the caller already holds the insights these pictures belong to
   * and must still write them; `scope` tells it what else to skip.
   */
  throttle: MetaThrottledError | null;
}

/**
 * Creative pictures for the given ads, read by id, 50 per request.
 *
 * Video ads are the tricky case: their creative only carries a tiny ~64px
 * `thumbnail_url`, so we resolve a sharp cover frame from the video node
 * (`/{video_id}?fields=thumbnails`). Static ads keep using `image_url` /
 * story-spec picture, which are already full-size.
 *
 * Never by listing the account's ads: a listing walks every ad the account
 * still has, newest first - thousands at OLX - to find the few dozen that
 * delivered. One page missed older delivering ads; twenty pages took
 * minutes and starved the clients after it. Callers pass only ads that
 * delivered and have no valid stored picture, most important first, so a
 * pass cut short (maxIds, shouldStop, a throttle) leaves the least
 * important ones for the next run.
 */
export async function getAdThumbnails(
  accessToken: string,
  adIds: Iterable<string>,
  opts: { maxIds?: number; shouldStop?: () => boolean } = {}
): Promise<AdThumbnails> {
  const shouldStop = opts.shouldStop ?? (() => false);
  const ids = [...new Set(adIds)].filter(Boolean).slice(0, opts.maxIds ?? MAX_THUMBNAIL_IDS);
  const map = new Map<string, string>();
  let throttle: MetaThrottledError | null = null;
  if (!ids.length) return { thumbnails: map, throttle };

  // Rich query first. We request object_story_spec WHOLESALE (not sub-selected)
  // because sub-selecting a field Meta doesn't recognise makes the entire query
  // throw - which previously dropped us to BASIC and left every video ad on its
  // blurry 64px thumbnail_url. If it still fails, BASIC keeps the sync alive.
  // thumbnail_width/height must be applied AS FIELD MODIFIERS on the nested
  // creative request - as top-level query params they are silently ignored
  // and thumbnail_url stays at its blurry ~64px default. With the modifier
  // Meta renders the thumbnail at the requested size for EVERY creative
  // type: static, video, carousel and catalog/DPA (where it picks a sample
  // product image - the only image such creatives have).
  const MOD = "creative.thumbnail_width(1080).thumbnail_height(1080)";
  const RICH = `id,${MOD}{id,object_type,image_url,thumbnail_url,video_id,object_story_spec}`;
  const BASIC = `id,${MOD}{id,image_url,thumbnail_url}`;

  type AdRow = { id?: string; creative?: Creative };
  let fields = RICH;
  let basicTried = false;
  let failures = 0;
  const read = async (batch: string[], f: string): Promise<AdRow[]> => {
    const body = await graphGet<Record<string, AdRow>>("/", {
      ids: batch.join(","),
      fields: f,
      access_token: accessToken,
    });
    return Object.values(body ?? {}).filter((n): n is AdRow => !!n && typeof n === "object");
  };
  // A batch with one deleted / foreign ad fails as a whole: split it until
  // the bad id stands alone, within a small failure budget (a systematic
  // error must not turn into one call per ad).
  const lookup = async (batch: string[]): Promise<AdRow[]> => {
    if (!batch.length || throttle || failures >= MAX_FAILED_LOOKUPS) return [];
    try {
      return await read(batch, fields);
    } catch (err) {
      if (err instanceof MetaThrottledError) {
        throttle = err;
        return [];
      }
      failures += 1;
      // A creative field Meta stopped accepting fails EVERY request; the
      // basic fields still give a (blurrier) picture. Tried once per pass.
      if (fields === RICH && !basicTried) {
        basicTried = true;
        try {
          const rows = await read(batch, BASIC);
          fields = BASIC;
          return rows;
        } catch (basicErr) {
          if (basicErr instanceof MetaThrottledError) {
            throttle = basicErr;
            return [];
          }
        }
      }
      if (batch.length === 1) return [];
      const mid = Math.ceil(batch.length / 2);
      return [...(await lookup(batch.slice(0, mid))), ...(await lookup(batch.slice(mid)))];
    }
  };

  // Video ads that need a follow-up lookup (dedup by video id to avoid
  // re-fetching shared videos across many ads).
  const videoAds: Array<{ adId: string; videoId: string }> = [];
  const videoIds = new Set<string>();
  const take = (ad: AdRow) => {
    if (!ad.id) return;
    const videoId = creativeVideoId(ad.creative);
    if (videoId) {
      videoAds.push({ adId: ad.id, videoId });
      videoIds.add(videoId);
    }
    // Video ads: the static fallback in case the video lookup fails.
    const url = bestStaticUrl(ad.creative);
    if (url) map.set(ad.id, url);
  };
  for (let i = 0; i < ids.length && !throttle && !shouldStop(); i += IDS_PER_REQUEST) {
    for (const ad of await lookup(ids.slice(i, i + IDS_PER_REQUEST))) take(ad);
  }

  // Sharp frames for each unique video, 6 at a time; a throttle or the
  // budget ends the pass and the remaining ads keep their fallback.
  const queue = [...videoIds];
  const videoThumb = new Map<string, string>();
  const worker = async () => {
    while (queue.length && !throttle && !shouldStop()) {
      const videoId = queue.shift() as string;
      try {
        const uri = await resolveVideoThumbnail(accessToken, videoId);
        if (uri) videoThumb.set(videoId, uri);
      } catch (err) {
        // resolveVideoThumbnail rethrows nothing but throttles.
        if (err instanceof MetaThrottledError) throttle = err;
        else break;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  for (const { adId, videoId } of videoAds) {
    const sharp = videoThumb.get(videoId);
    if (sharp) map.set(adId, sharp);
  }

  return { thumbnails: map, throttle };
}

/** Cap for paged /ads listings: 20 x 500 = the newest 10 000 ads. */
const ADS_LIST_MAX_PAGES = 20;

export interface MetaAdMeta {
  id: string;
  name: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  /** e.g. ACTIVE, PAUSED, ADSET_PAUSED, CAMPAIGN_PAUSED, DISAPPROVED. */
  effective_status: string | null;
  /** ISO timestamp. */
  created_time: string | null;
}

/**
 * Light metadata for the ads of an account (no creative, no insights): ad
 * set, delivery status and creation time - so the creative test view can
 * leave out ads the owner already switched off. Meta lists non-archived,
 * non-deleted ads by default.
 * - wanted: the ads the caller needs; the listing stops as soon as all of
 *   them were seen (the newest ads come first, so usually page 1-2).
 * - maxPages: cap, ADS_LIST_MAX_PAGES by default.
 * `complete` is true only when the listing ran to its end - then an ad
 * missing from it really is archived or deleted; otherwise "absent" means
 * nothing.
 */
export async function getAdsMeta(
  accessToken: string,
  adAccountId: string,
  opts: { wanted?: Set<string>; maxPages?: number } = {}
): Promise<{ ads: MetaAdMeta[]; complete: boolean }> {
  const unseen = opts.wanted ? new Set(opts.wanted) : null;
  let checked = 0;
  const { rows: raw, complete } = await graphGetAll(
    `/${adAccountId}/ads`,
    {
      fields: "id,name,adset_id,campaign_id,effective_status,created_time",
      access_token: accessToken,
      limit: "500",
    },
    {
      maxPages: opts.maxPages ?? ADS_LIST_MAX_PAGES,
      onCap: "stop",
      done: unseen
        ? (rows) => {
            for (; checked < rows.length; checked += 1) unseen.delete(String(rows[checked].id));
            return unseen.size === 0;
          }
        : undefined,
    }
  );
  const str = (v: unknown): string | null => (v != null && v !== "" ? String(v) : null);
  return {
    ads: raw
      .filter((r) => r.id)
      .map((r) => ({
        id: String(r.id),
        name: str(r.name),
        adset_id: str(r.adset_id),
        campaign_id: str(r.campaign_id),
        effective_status: str(r.effective_status),
        created_time: str(r.created_time),
      })),
    complete,
  };
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
