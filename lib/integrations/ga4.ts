// GA4 integration via the `googleapis` package (Analytics Admin API for
// property discovery, Analytics Data API for reports). Same OAuth shape as
// Google Ads - offline access + refresh token stored encrypted per client.
import { google } from "googleapis";

function clientId(): string {
  return process.env.GA4_CLIENT_ID!;
}
function clientSecret(): string {
  return process.env.GA4_CLIENT_SECRET!;
}
function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/ga4/callback`;
}

function authedClient(refreshToken: string) {
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

/** OAuth consent URL (analytics.readonly, offline, forced consent). */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/analytics.readonly",
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

  return {
    refresh_token: body.refresh_token,
    access_token: body.access_token,
    expires_at: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000),
  };
}

/** All GA4 properties the refresh token can read, via Admin API summaries. */
export async function listAccessibleProperties(
  refreshToken: string
): Promise<Ga4Property[]> {
  const admin = google.analyticsadmin({
    version: "v1beta",
    auth: authedClient(refreshToken),
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
  refreshToken: string,
  propertyId: string,
  requestBody: Record<string, unknown>
) {
  const dataApi = google.analyticsdata({
    version: "v1beta",
    auth: authedClient(refreshToken),
  });
  const res = await dataApi.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody,
  });
  return res.data;
}

export async function getSessionsBySourceMedium(
  refreshToken: string,
  propertyId: string,
  range: DateRange
): Promise<Array<{ sourceMedium: string; sessions: number; engagementRate: number }>> {
  const data = await runReport(refreshToken, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "sessionSourceMedium" }],
    metrics: [{ name: "sessions" }, { name: "engagementRate" }],
    limit: 100,
  });
  return rows(data).map((r) => ({
    sourceMedium: dim(r, 0),
    sessions: metric(r, 0),
    engagementRate: metric(r, 1),
  }));
}

export async function getSessionsByDevice(
  refreshToken: string,
  propertyId: string,
  range: DateRange
): Promise<Array<{ deviceCategory: string; sessions: number }>> {
  const data = await runReport(refreshToken, propertyId, {
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
  refreshToken: string,
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
  const data = await runReport(refreshToken, propertyId, {
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
  refreshToken: string,
  propertyId: string,
  range: DateRange
): Promise<Array<{ type: string; sessions: number }>> {
  // Users (not sessions) so "Nowi / Powracający" match GA4's user counts.
  const data = await runReport(refreshToken, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "newVsReturning" }],
    metrics: [{ name: "activeUsers" }],
  });
  return rows(data)
    .map((r) => ({ type: dim(r, 0), sessions: metric(r, 0) }))
    .filter((r) => r.type);
}

export async function getAgeBrackets(
  refreshToken: string,
  propertyId: string,
  range: DateRange
): Promise<Array<{ bucket: string; value: number }>> {
  const data = await runReport(refreshToken, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "userAgeBracket" }],
    metrics: [{ name: "sessions" }],
  });
  return rows(data)
    .map((r) => ({ bucket: dim(r, 0), value: metric(r, 0) }))
    .filter((r) => r.bucket);
}

export async function getGenders(
  refreshToken: string,
  propertyId: string,
  range: DateRange
): Promise<Array<{ bucket: string; value: number }>> {
  const data = await runReport(refreshToken, propertyId, {
    dateRanges: [range],
    dimensions: [{ name: "userGender" }],
    metrics: [{ name: "sessions" }],
  });
  return rows(data)
    .map((r) => ({ bucket: dim(r, 0), value: metric(r, 0) }))
    .filter((r) => r.bucket);
}

export async function getRegions(
  refreshToken: string,
  propertyId: string,
  range: DateRange,
  limit = 12
): Promise<Array<{ bucket: string; value: number }>> {
  const data = await runReport(refreshToken, propertyId, {
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

export async function getDailyMetrics(
  refreshToken: string,
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
  const data = await runReport(refreshToken, propertyId, {
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
