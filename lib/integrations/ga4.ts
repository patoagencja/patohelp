// GA4 integration via the `googleapis` package (Analytics Admin API for
// property discovery, Analytics Data API for reports). Two ways to
// authenticate, chosen per integration by its stored credentials:
//  - OAuth (default): offline access + refresh token stored encrypted per
//    client, same shape as Google Ads. Dies with the agency's Google login.
//  - Service account ({"mode":"service_account"}): a JWT signed with the key in
//    GOOGLE_SERVICE_ACCOUNT_JSON. Never expires; the client adds the service
//    account's email as a Viewer on their GA4 property.
import { google } from "googleapis";

import {
  emailFromIdToken,
  googleScopesFor,
  GOOGLE_SCOPE_GA4,
  type GoogleOAuthCredentials,
} from "@/lib/integrations/google-identity";

function clientId(): string {
  return process.env.GA4_CLIENT_ID!;
}
function clientSecret(): string {
  return process.env.GA4_CLIENT_SECRET!;
}
function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/ga4/callback`;
}

export interface Ga4ServiceAccountCredentials {
  mode: "service_account";
  /** Service account email at save time (display only - the key is in env). */
  client_email?: string | null;
}

export type Ga4OAuthCredentials = GoogleOAuthCredentials & { mode?: "oauth" };

/** Decrypted credential blob of a `ga4` integration row. */
export type Ga4Credentials = Ga4OAuthCredentials | Ga4ServiceAccountCredentials;

/**
 * Anything the report functions accept: a bare refresh token (legacy callers)
 * or the whole decrypted credential blob, which also covers service accounts.
 */
export type Ga4Auth = string | Ga4Credentials;

export function isServiceAccountCredentials(
  creds: unknown
): creds is Ga4ServiceAccountCredentials {
  return (
    !!creds &&
    typeof creds === "object" &&
    (creds as { mode?: unknown }).mode === "service_account"
  );
}

/** Parse a decrypted `ga4` credential JSON string. */
export function parseGa4Credentials(json: string): Ga4Credentials {
  return JSON.parse(json) as Ga4Credentials;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

/**
 * GOOGLE_SERVICE_ACCOUNT_JSON holds the downloaded JSON key. Accept it raw or
 * base64-encoded (some dashboards mangle multi-line values), and fix private
 * keys whose newlines arrived as literal "\n". Null when unset/unreadable.
 */
function readServiceAccountKey(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(text) as Partial<ServiceAccountKey>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

/** Email to add as Viewer in a GA4 property, or null when not configured. */
export function getServiceAccountEmail(): string | null {
  return readServiceAccountKey()?.client_email ?? null;
}

// One JWT client per warm instance: it caches its access token, so a cron
// running a dozen reports signs once instead of per request.
let jwtClient: InstanceType<typeof google.auth.JWT> | null = null;

function serviceAccountClient() {
  if (jwtClient) return jwtClient;
  const key = readServiceAccountKey();
  if (!key) {
    // Not a token problem - say exactly what is missing so the health banner
    // doesn't tell anyone to "reconnect".
    throw new Error(
      "GA4 ustawione na konto usługi, ale brak poprawnej zmiennej GOOGLE_SERVICE_ACCOUNT_JSON na serwerze."
    );
  }
  jwtClient = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [GOOGLE_SCOPE_GA4],
  });
  return jwtClient;
}

function authedClient(auth: Ga4Auth) {
  if (isServiceAccountCredentials(auth)) return serviceAccountClient();
  const refreshToken = typeof auth === "string" ? auth : auth?.refresh_token;
  if (!refreshToken) {
    throw new Error("Brak refresh_token GA4 - połącz GA4 ponownie.");
  }
  const oauth = new google.auth.OAuth2(clientId(), clientSecret(), redirectUri());
  oauth.setCredentials({ refresh_token: refreshToken });
  return oauth;
}

export interface Ga4Property {
  propertyId: string;
  displayName: string;
  accountName: string;
}

export interface DateRange {
  startDate: string; // yyyy-MM-dd
  endDate: string; // yyyy-MM-dd
}

/**
 * OAuth consent URL (analytics.readonly, offline, forced consent). Adds the
 * adwords scope when Google Ads shares this OAuth client - one consent then
 * revives both providers - plus `openid email` to record the account.
 */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: googleScopesFor("ga4"),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Exchange the OAuth code for a refresh token. */
export async function exchangeCodeForTokens(code: string): Promise<{
  refresh_token: string;
  access_token: string;
  expires_at: Date;
  id_token: string | null;
  scope: string | null;
  /** Google account email from the id_token, when `email` was granted. */
  account_email: string | null;
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
    console.error("[ga4] token exchange error", {
      status: res.status,
      error: body?.error,
      error_description: body?.error_description,
    });
    throw new Error(
      body?.error_description ??
        "GA4 token exchange failed (no refresh_token returned)"
    );
  }

  const idToken = typeof body.id_token === "string" ? body.id_token : null;
  return {
    refresh_token: body.refresh_token,
    access_token: body.access_token,
    expires_at: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000),
    id_token: idToken,
    scope: typeof body.scope === "string" ? body.scope : null,
    account_email: emailFromIdToken(idToken),
  };
}

/** All GA4 properties the credentials can read, via Admin API summaries. */
export async function listAccessibleProperties(
  auth: Ga4Auth
): Promise<Ga4Property[]> {
  const admin = google.analyticsadmin({
    version: "v1beta",
    auth: authedClient(auth),
  });
  const res = await admin.accountSummaries.list({ pageSize: 200 });

  const properties: Ga4Property[] = [];
  for (const account of res.data.accountSummaries ?? []) {
    for (const prop of account.propertySummaries ?? []) {
      const propertyId = (prop.property ?? "").split("/")[1];
      if (!propertyId) continue;
      properties.push({
        propertyId,
        displayName: prop.displayName ?? propertyId,
        accountName: account.displayName ?? "",
      });
    }
  }
  return properties;
}

// Row helper: GA4 returns dimensionValues[] / metricValues[] parallel arrays.
// googleapis' generated types are loose here, so we index defensively.
function rows(data: { rows?: unknown }): any[] {
  return (data.rows as any[]) ?? [];
}

function dim(row: any, i: number): string {
  return row?.dimensionValues?.[i]?.value ?? "";
}
function metric(row: any, i: number): number {
  return Number(row?.metricValues?.[i]?.value ?? 0);
}

/** GA4 dates come as "YYYYMMDD" - normalize to yyyy-MM-dd. */
function normalizeGa4Date(raw: string): string {
  if (raw.length === 8) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

async function runReport(
  auth: Ga4Auth,
  propertyId: string,
  requestBody: Record<string, unknown>
) {
  const dataApi = google.analyticsdata({
    version: "v1beta",
    auth: authedClient(auth),
  });
  const res = await dataApi.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody,
  });
  return res.data;
}

/**
 * The property's reporting currency (GA4 returns it with every report).
 * Several country properties of one client (Elfi: .de, .uk, .com.br) report
 * revenue in their own money, which must become złoty before it is summed.
 * null when GA4 doesn't say.
 */
export async function getPropertyCurrency(auth: Ga4Auth, propertyId: string): Promise<string | null> {
  const data = await runReport(auth, propertyId, {
    dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }],
    metrics: [{ name: "sessions" }],
    limit: 1,
  });
  const code = (data as { metadata?: { currencyCode?: string | null } }).metadata?.currencyCode;
  return code && /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : null;
}

export async function getSessionsBySourceMedium(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange
): Promise<
  Array<{
    sourceMedium: string;
    sessions: number;
    engagementRate: number;
    revenue: number; // property currency, major unit (0 for non-ecommerce)
    transactions: number;
  }>
> {
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "sessionSourceMedium" }],
    metrics: [
      { name: "sessions" },
      { name: "engagementRate" },
      { name: "totalRevenue" },
      { name: "transactions" },
    ],
    limit: 100,
  });
  return rows(data).map((r) => ({
    sourceMedium: dim(r, 0),
    sessions: metric(r, 0),
    engagementRate: metric(r, 1),
    revenue: metric(r, 2),
    transactions: metric(r, 3),
  }));
}

export async function getSessionsByDevice(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange
): Promise<Array<{ deviceCategory: string; sessions: number }>> {
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "deviceCategory" }],
    metrics: [{ name: "sessions" }],
  });
  return rows(data).map((r) => ({
    deviceCategory: dim(r, 0),
    sessions: metric(r, 0),
  }));
}

export async function getTopPages(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange,
  limit = 10
): Promise<
  Array<{
    pagePath: string;
    pageViews: number;
    engagementRate: number;
    avgSessionDuration: number;
  }>
> {
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "pagePath" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "engagementRate" },
      { name: "averageSessionDuration" },
    ],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });
  return rows(data).map((r) => ({
    pagePath: dim(r, 0),
    pageViews: metric(r, 0),
    engagementRate: metric(r, 1),
    avgSessionDuration: metric(r, 2),
  }));
}

export async function getNewVsReturning(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange
): Promise<Array<{ type: string; sessions: number }>> {
  // Users (not sessions) so "Nowi / Powracający" match GA4's user counts.
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "newVsReturning" }],
    metrics: [{ name: "activeUsers" }],
  });
  return rows(data)
    .map((r) => ({ type: dim(r, 0), sessions: metric(r, 0) }))
    .filter((r) => r.type);
}

export async function getAgeBrackets(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange
): Promise<Array<{ bucket: string; value: number }>> {
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "userAgeBracket" }],
    metrics: [{ name: "sessions" }],
  });
  return rows(data)
    .map((r) => ({ bucket: dim(r, 0), value: metric(r, 0) }))
    .filter((r) => r.bucket);
}

export async function getGenders(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange
): Promise<Array<{ bucket: string; value: number }>> {
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "userGender" }],
    metrics: [{ name: "sessions" }],
  });
  return rows(data)
    .map((r) => ({ bucket: dim(r, 0), value: metric(r, 0) }))
    .filter((r) => r.bucket);
}

export async function getRegions(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange,
  limit = 12
): Promise<Array<{ bucket: string; value: number }>> {
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "region" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  });
  return rows(data)
    .map((r) => ({ bucket: dim(r, 0), value: metric(r, 0) }))
    .filter((r) => r.bucket && r.bucket !== "(not set)");
}

/**
 * Daily per-product sales (SKU level): item name/id, units purchased and item
 * revenue. Empty for properties without e-commerce events.
 */
export async function getItemsDaily(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange
): Promise<
  Array<{
    date: string;
    itemId: string;
    itemName: string;
    quantity: number;
    revenue: number; // property currency, major unit
  }>
> {
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "date" }, { name: "itemId" }, { name: "itemName" }],
    metrics: [{ name: "itemsPurchased" }, { name: "itemRevenue" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 100000,
  });
  return rows(data)
    .map((r) => ({
      date: normalizeGa4Date(dim(r, 0)),
      itemId: dim(r, 1),
      itemName: dim(r, 2) || dim(r, 1) || "(bez nazwy)",
      quantity: metric(r, 0),
      revenue: metric(r, 1),
    }))
    .filter((r) => r.quantity > 0 || r.revenue > 0);
}

export async function getDailyMetrics(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange
): Promise<
  Array<{
    date: string;
    sessions: number;
    users: number;
    engagementRate: number;
    revenue: number; // property currency (major unit, e.g. PLN)
    purchaseRevenue: number; // purchase-event revenue only (for diagnostics)
    transactions: number;
  }>
> {
  // Revenue = totalRevenue, which is what GA4's "Łączne przychody" card shows.
  // purchaseRevenue only counts the standard `purchase` event, so stores that
  // record sales via a custom event report 0 there while totalRevenue is right.
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "engagementRate" },
      { name: "totalRevenue" },
      { name: "transactions" },
      { name: "purchaseRevenue" },
    ],
    orderBys: [{ dimension: { dimensionName: "date" } }],
  });
  return rows(data).map((r) => ({
    date: normalizeGa4Date(dim(r, 0)),
    sessions: metric(r, 0),
    users: metric(r, 1),
    engagementRate: metric(r, 2),
    revenue: metric(r, 3),
    transactions: metric(r, 4),
    purchaseRevenue: metric(r, 5),
  }));
}

/**
 * Sessions by day of week x hour of day ("when are visitors active").
 * GA4 reports both dimensions in the property's timezone; dayOfWeek is
 * "0".."6" with 0 = Sunday, hour is "00".."23". Defaults to the last 28 full
 * days so each weekday appears exactly 4 times and days compare fairly.
 */
export async function getSessionsByDayHour(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange = { startDate: "28daysAgo", endDate: "yesterday" }
): Promise<
  Array<{ dayOfWeek: number; hour: number; sessions: number; engagedSessions: number }>
> {
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "dayOfWeek" }, { name: "hour" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
    // 7 x 24 = 168 rows max; the limit just makes that explicit.
    limit: 200,
  });
  return rows(data)
    .map((r) => ({
      dayOfWeek: Number.parseInt(dim(r, 0), 10),
      hour: Number.parseInt(dim(r, 1), 10),
      sessions: metric(r, 0),
      engagedSessions: metric(r, 1),
    }))
    .filter(
      (r) =>
        Number.isInteger(r.dayOfWeek) &&
        r.dayOfWeek >= 0 &&
        r.dayOfWeek <= 6 &&
        Number.isInteger(r.hour) &&
        r.hour >= 0 &&
        r.hour <= 23
    );
}

/**
 * Revenue split between new and returning visitors (e-commerce properties).
 * GA4's newVsReturning is visitor-based: "new" = the user's first session on
 * the site, "returning" = any later session. It is the closest proxy GA4
 * offers per segment for first-time vs repeat buyers. Defaults to the last 30
 * full days so the numbers don't change within a day. Blank segment values
 * are folded into "(not set)" so storage keys stay stable.
 */
export async function getRevenueByNewVsReturning(
  auth: Ga4Auth,
  propertyId: string,
  range: DateRange = { startDate: "30daysAgo", endDate: "yesterday" }
): Promise<
  Array<{
    segment: "new" | "returning" | "(not set)";
    revenue: number; // property currency, major unit
    transactions: number;
    users: number;
    sessions: number;
  }>
> {
  const data = await runReport(auth, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "newVsReturning" }],
    metrics: [
      { name: "totalRevenue" },
      { name: "transactions" },
      { name: "totalUsers" },
      { name: "sessions" },
    ],
  });
  return rows(data).map((r) => {
    const raw = dim(r, 0);
    const segment: "new" | "returning" | "(not set)" =
      raw === "new" || raw === "returning" ? raw : "(not set)";
    return {
      segment,
      revenue: metric(r, 0),
      transactions: metric(r, 1),
      users: metric(r, 2),
      sessions: metric(r, 3),
    };
  });
}

/**
 * Cheapest possible proof that the credentials can read a property: a
 * one-row runReport. Throws the API error (e.g. PERMISSION_DENIED when the
 * service account was not added as a Viewer).
 */
export async function verifyPropertyAccess(
  auth: Ga4Auth,
  propertyId: string
): Promise<void> {
  await runReport(auth, propertyId, {
    dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
    metrics: [{ name: "sessions" }],
    limit: 1,
  });
}
