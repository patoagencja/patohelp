import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Anomaly } from "@/lib/alerts/anomalies";
import {
  UPTIME_DAYS,
  isSiteDownNow,
  siteDownAlertCopy,
  siteGuardLine,
  siteHost,
  siteNoticeKey,
  uptimePercent,
  type SiteLine,
  type SiteSnapshot,
} from "@/lib/alerts/site-guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Database side of the website guard for the panel: site_status (one row per
// client, kept by Supabase's site-guard job, migration 0045) and the 30-day
// uptime from site_checks. Reads only our own tables - the checks run in the
// database, never on page load. Until 0045 runs every reader returns
// "nothing" (no card, a hint in Ustawienia).
//
// Service-role reads: callers pass a client id they resolved through RLS
// (getClientBySlug) or an agency-guarded one (requireAgencyClientAccess).

const WARSAW_TZ = "Europe/Warsaw";

const STATUS_COLUMNS =
  "url, state, since, down_since, fail_streak, ok_streak, last_checked_at, last_ok, last_http_status, last_error, last_fail_status, last_fail_error";

const ms = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A site_status row as the pure module's snapshot; null if it doesn't parse. */
export function toSiteSnapshot(row: Record<string, unknown>): SiteSnapshot | null {
  const since = ms(row.since);
  const url = str(row.url);
  if (since === null || !url) return null;
  return {
    url,
    state: row.state === "down" ? "down" : "up",
    since,
    downSince: ms(row.down_since),
    failStreak: num(row.fail_streak) ?? 0,
    okStreak: num(row.ok_streak) ?? 0,
    lastCheckedAt: ms(row.last_checked_at),
    lastOk: typeof row.last_ok === "boolean" ? row.last_ok : null,
    lastHttpStatus: num(row.last_http_status),
    lastError: str(row.last_error),
    lastFailStatus: num(row.last_fail_status),
    lastFailError: str(row.last_fail_error),
  };
}

/** available = false: site_status unreadable (migration 0045 not run). */
export async function readSiteStatus(
  admin: SupabaseClient,
  clientId: string
): Promise<{ available: boolean; status: SiteSnapshot | null }> {
  const { data, error } = await admin
    .from("site_status")
    .select(STATUS_COLUMNS)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) return { available: false, status: null };
  return { available: true, status: data ? toSiteSnapshot(data as Record<string, unknown>) : null };
}

/** "10:05" today, "10:05 (06.11)" on an earlier day - Europe/Warsaw. */
export function warsawClockLabel(at: number, now: number): string {
  const day = (t: number) => formatInTimeZone(t, WARSAW_TZ, "yyyy-MM-dd");
  const clock = formatInTimeZone(at, WARSAW_TZ, "HH:mm");
  return day(at) === day(now) ? clock : `${clock} (${formatInTimeZone(at, WARSAW_TZ, "dd.MM")})`;
}

/**
 * The urgent Alerty card while the client's website is down: one
 * primary-key read on every render (the header bell counts it too), plus
 * the client type only when there is an outage to word. Never throws - the
 * rest of the alerts must not depend on it.
 */
export async function getSiteDownAlerts(clientId: string): Promise<Anomaly[]> {
  try {
    const admin = createAdminClient();
    const { status } = await readSiteStatus(admin, clientId);
    const now = Date.now();
    if (!status || !isSiteDownNow(status, now)) return [];
    const downSince = status.downSince ?? status.since;
    const { data: client } = await admin
      .from("clients")
      .select("client_type")
      .eq("id", clientId)
      .maybeSingle();
    const copy = siteDownAlertCopy({
      isShop: (client as { client_type?: string } | null)?.client_type === "ecommerce",
      downSince,
      now,
      failStatus: status.lastFailStatus,
      failError: status.lastFailError,
      startedLabel: warsawClockLabel(downSince, now),
    });
    return [
      {
        id: siteNoticeKey("down", new Date(downSince).toISOString()),
        severity: "critical",
        scope: "client",
        scopeLabel: siteHost(status.url),
        metric: "Dostępność strony",
        direction: "down",
        changePct: 0,
        ...copy,
      },
    ];
  } catch (err) {
    console.warn("[site-guard] status read failed", (err as Error)?.message);
    return [];
  }
}

/**
 * The line under "Strona klienta" in Ustawienia (agency only). Uptime =
 * good checks / checks with a verdict over 30 days, for the current
 * address - two head-only counts, no rows transferred.
 */
export async function getSiteGuardLine(
  admin: SupabaseClient,
  clientId: string,
  websiteUrl: string | null
): Promise<SiteLine | null> {
  if (!websiteUrl) return null;
  const now = Date.now();
  const { available, status } = await readSiteStatus(admin, clientId);
  let uptimePct: number | null = null;
  if (status && status.url === websiteUrl) {
    const from = new Date(now - UPTIME_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const count = () =>
      admin
        .from("site_checks")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("url", websiteUrl)
        .gte("checked_at", from);
    const [withVerdict, good] = await Promise.all([
      count().not("ok", "is", null),
      count().eq("ok", true),
    ]);
    if (!withVerdict.error && !good.error) {
      uptimePct = uptimePercent(good.count ?? 0, withVerdict.count ?? 0);
    }
  }
  return siteGuardLine({ available, websiteUrl, status, uptimePct, now });
}
