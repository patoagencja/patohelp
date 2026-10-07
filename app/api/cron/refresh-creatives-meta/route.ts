import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import { createFxConverter, normalizeCurrency } from "@/lib/integrations/fx";
import { hasClicksAllColumn, metaClickColumns } from "@/lib/integrations/link-clicks";
import {
  describeThrottle,
  getAdInsights,
  getAdThumbnails,
  MetaThrottledError,
} from "@/lib/integrations/meta-ads";
import {
  markAccountsProcessed,
  oldestAccountsFirst,
  readSyncStates,
  writeSyncState,
  type AccountRotationState,
} from "@/lib/integrations/sync-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

// Cron (Vercel every 6h, the GitHub scheduler every 30 min): pull Meta
// ad-level creative performance for the last 30 days into `creatives`.
// Google Ads creatives are a TODO (no thumbnails in their API; we skip them
// in this version).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WARSAW_TZ = "Europe/Warsaw";

// No account starts after ACCOUNT_BUDGET_MS and thumbnail lookups end at
// LOOKUP_BUDGET_MS. Not the 300 s maxDuration: the GitHub scheduler calls
// this endpoint every 30 minutes inside the data-sync job with a 90 s curl
// timeout, and a longer run there counts as failed, is retried while the
// first one still runs (both on the same Meta accounts) and turns the job
// red. 48 runs a day are plenty as long as every run continues where the
// last one stopped: ad ACCOUNTS (not clients) go least recently processed
// first, so DRE's ~46 accounts - most idle, one cheap call each - rotate
// through instead of every run restarting at its first account.
const ACCOUNT_BUDGET_MS = 50_000;
const LOOKUP_BUDGET_MS = 70_000;
/** A stored thumbnail is reused while its CDN link stays valid this long. */
const THUMB_MIN_VALIDITY_MS = 2 * 86_400_000;
const STATE_KEY = "meta_creatives";

interface MetaAccount {
  id: string;
  selected?: boolean;
  currency?: string;
}

// bigint columns reject "12.0"-style floats; keep null as "not reported".
function roundOrNull(v: number | null): number | null {
  return v != null ? Math.round(v) : null;
}

/**
 * Expiry of a Meta CDN link: `oe` is unix seconds in hex. undefined = the
 * link carries none (can't tell, assume it still works).
 */
function linkExpiry(url: string): number | null | undefined {
  try {
    const oe = new URL(url).searchParams.get("oe");
    if (!oe) return undefined;
    return /^[0-9a-f]+$/i.test(oe) ? parseInt(oe, 16) * 1000 : null;
  } catch {
    return null;
  }
}

interface ClientContext {
  accessToken: string;
  /**
   * Every stored picture, expired ones included: written back when this run
   * found no new one - never replaced with null.
   */
  stored: Map<string, string>;
  /** Stored pictures valid for a while yet: not looked up again. */
  keep: Set<string>;
}

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = createAdminClient();
  const now = new Date();
  const until = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(subDays(now, 29), WARSAW_TZ, "yyyy-MM-dd");

  const onlyClient = new URL(request.url).searchParams.get("client");
  let q = admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "meta_ads");
  if (onlyClient) q = q.eq("client_id", onlyClient);
  const { data: integrations } = await q;
  const clientIds = (integrations ?? []).map((i) => i.client_id as string);

  // Migration 0025 adds the diagnostic columns. Until it runs, PostgREST
  // rejects any upsert naming them, so probe once and omit them from every
  // row - bulk upserts union keys, so rows must all carry the same shape.
  const { error: probeError } = await admin
    .from("creatives")
    .select("video_3s_views")
    .limit(1);
  const hasMetricColumns = !probeError;
  if (probeError) {
    console.warn(
      "[cron/refresh-creatives-meta] creative metric columns missing - run migration 0025",
      probeError.message
    );
  }

  // Migration 0034: link clicks in `clicks`, clicks (all) in `clicks_all`.
  // The table holds one rolling 30-day row per ad, rewritten every run, so
  // no history re-pull is needed - the next run converts every live ad.
  const withClicksAll = await hasClicksAllColumn(admin, "creatives");

  type IntegrationRow = NonNullable<typeof integrations>[number];
  // One work item per selected account, least recently processed first.
  const items = (integrations ?? []).flatMap((integration) =>
    ((integration.account_ids ?? []) as MetaAccount[])
      .filter((a) => a.selected === true)
      .map((account) => ({
        clientId: integration.client_id as string,
        accountId: account.id,
        account,
        integration,
      }))
  );
  // Null = unreadable: input order, and no stamps written (a partial write
  // would reset every other account's place in the rotation).
  const states = await readSyncStates<AccountRotationState>(admin, clientIds, STATE_KEY);
  const ordered = oldestAccountsFirst(items, states);
  const fx = createFxConverter();
  const lookupsStop = () => Date.now() - startedAt > LOOKUP_BUDGET_MS;

  // Per client, loaded when its first account comes up; null = unusable
  // credentials.
  const contexts = new Map<string, ClientContext | null>();
  const loadContext = async (integration: IntegrationRow): Promise<ClientContext | null> => {
    const clientId = integration.client_id as string;
    let accessToken: string;
    try {
      accessToken = JSON.parse(decrypt(integration.credentials_encrypted as string)).access_token;
    } catch (err) {
      console.error("[cron/refresh-creatives-meta] integration failed", describeError(err));
      return null;
    }
    // Stored thumbnails: reused while valid (one call per video ad was
    // most of the cost) and kept rather than overwritten with null when
    // this run found no new one.
    const stored = new Map<string, string>();
    const keep = new Set<string>();
    try {
      const rows = await fetchAll<{ ad_id: string; thumbnail_url: string | null }>((from, to) =>
        admin
          .from("creatives")
          .select("ad_id, thumbnail_url")
          .eq("client_id", clientId)
          .eq("provider", "meta_ads")
          .not("thumbnail_url", "is", null)
          .order("ad_id", { ascending: true })
          .range(from, to)
      );
      const nowMs = Date.now();
      for (const r of rows) {
        if (!r.thumbnail_url) continue;
        stored.set(String(r.ad_id), r.thumbnail_url);
        const expiry = linkExpiry(r.thumbnail_url);
        // No expiry in the link: nothing says it is dead, keep it.
        if (expiry === undefined || (expiry != null && expiry - nowMs > THUMB_MIN_VALIDITY_MS)) {
          keep.add(String(r.ad_id));
        }
      }
    } catch (readErr) {
      console.warn("[cron/refresh-creatives-meta] stored thumbnails unreadable", describeError(readErr));
    }
    return { accessToken, stored, keep };
  };

  let creativesUpserted = 0;
  let accountsProcessed = 0;
  let accountsFailed = 0;
  let accountsThrottled = 0;
  let accountsSkipped = 0;
  let appThrottled = false;
  // A per-user limit (code 17 without the per-account subcode) covers every
  // account of that client's token.
  const throttledClients = new Set<string>();
  // client -> account -> when this run processed it.
  const stamps = new Map<string, Map<string, string>>();

  for (const { clientId, account, integration } of ordered) {
    if (appThrottled || throttledClients.has(clientId) || Date.now() - startedAt > ACCOUNT_BUDGET_MS) {
      // Not stamped: these lead the next run.
      accountsSkipped += 1;
      continue;
    }
    if (!contexts.has(clientId)) contexts.set(clientId, await loadContext(integration));
    const ctx = contexts.get(clientId);
    if (!ctx) {
      accountsFailed += 1;
      continue;
    }
    const stamp = () => {
      const map = stamps.get(clientId) ?? new Map<string, string>();
      map.set(account.id, new Date().toISOString());
      stamps.set(clientId, map);
    };
    const onThrottle = (err: MetaThrottledError) => {
      accountsThrottled += 1;
      if (err.scope === "app") appThrottled = true;
      else if (err.scope === "user") throttledClients.add(clientId);
      // A per-account limit skips only this account.
      console.warn(
        `[cron/refresh-creatives-meta] account ${account.id} throttled (${err.scope})`,
        describeThrottle(err)
      );
    };

    try {
      const insights = await getAdInsights(ctx.accessToken, account.id, since, until);
      if (!insights.length) {
        // Idle for 30 days (most of DRE's accounts): no pictures to look up.
        accountsProcessed += 1;
        stamp();
        continue;
      }

      // 30-day sums: converted at the period's mean NBP rate. No rate
      // -> the account keeps its last good rows instead of foreign
      // money stored as złoty.
      const currency =
        normalizeCurrency(insights.find((a) => a.account_currency)?.account_currency) ??
        normalizeCurrency(account.currency);
      const rate = await fx.averageRate(currency, since, until);
      if (rate == null) {
        accountsFailed += 1;
        stamp();
        console.error(
          `[cron/refresh-creatives-meta] account ${account.id} skipped: no exchange rate for ${currency ?? "unknown currency"}`
        );
        continue;
      }
      const scale = (v?: string) =>
        v != null && v !== "" && rate !== 1 ? String(parseFloat(v) * rate) : v;

      // Pictures only for ads that delivered and have no valid stored one,
      // biggest spend first: a pass cut short by the budget leaves the
      // least important for the next run.
      const need = [...insights]
        .sort((a, b) => (parseFloat(b.spend) || 0) - (parseFloat(a.spend) || 0))
        .map((ad) => ad.ad_id)
        .filter((id) => id && !ctx.keep.has(id));
      const { thumbnails, throttle } = await getAdThumbnails(ctx.accessToken, need, {
        shouldStop: lookupsStop,
      });

      // getAdInsights falls back to the base fields on ANY error (rate
      // limits included) and then reports every diagnostic as null.
      // Writing those nulls would wipe the last good values for 6h, so
      // only send the diagnostic columns when the extended call worked
      // (reach comes back for every ad that had impressions). Decided per
      // account, so each upsert batch still has one shape.
      const withMetrics =
        hasMetricColumns && insights.some((ad) => ad.reach != null);

      const rows = insights.map((ad) => ({
        client_id: clientId,
        provider: "meta_ads",
        ad_id: ad.ad_id,
        ad_name: ad.ad_name,
        campaign_id: ad.campaign_id,
        thumbnail_url: thumbnails.get(ad.ad_id) ?? ctx.stored.get(ad.ad_id) ?? null,
        spend_minor_units: Math.round((parseFloat(ad.spend) || 0) * rate * 100),
        impressions: parseInt(ad.impressions, 10) || 0,
        ...metaClickColumns(
          rate !== 1 ? { ...ad, cpc: scale(ad.cpc), link_cpc: scale(ad.link_cpc) } : ad,
          withClicksAll
        ),
        period_start: since,
        period_end: until,
        updated_at: new Date().toISOString(),
        ...(withMetrics
          ? {
              reach: roundOrNull(ad.reach),
              frequency: ad.frequency,
              quality_ranking: ad.quality_ranking,
              engagement_rate_ranking: ad.engagement_rate_ranking,
              conversion_rate_ranking: ad.conversion_rate_ranking,
              video_plays: roundOrNull(ad.video_plays),
              video_3s_views: roundOrNull(ad.video_3s_views),
              video_thruplays: roundOrNull(ad.video_thruplays),
              video_p25: roundOrNull(ad.video_p25),
              video_p50: roundOrNull(ad.video_p50),
              video_p75: roundOrNull(ad.video_p75),
              video_p100: roundOrNull(ad.video_p100),
              video_avg_watch_seconds: ad.video_avg_watch_seconds,
            }
          : {}),
      }));

      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);
        const { error } = await admin
          .from("creatives")
          .upsert(chunk, { onConflict: "client_id,provider,ad_id" });
        if (error) throw new Error(error.message);
        creativesUpserted += chunk.length;
      }
      accountsProcessed += 1;
      stamp();
      // The numbers are written; a limit hit while looking up pictures
      // still decides what else this run leaves alone.
      if (throttle) onThrottle(throttle);
    } catch (accErr) {
      if (accErr instanceof MetaThrottledError) {
        // Not stamped: the account leads the next run, once the block
        // has likely lifted.
        onThrottle(accErr);
        continue;
      }
      accountsFailed += 1;
      // Stamped anyway: an account that fails or hangs every time must not
      // sit at the head of the rotation eating each run's budget.
      stamp();
      console.error(
        `[cron/refresh-creatives-meta] account ${account.id} failed`,
        describeError(accErr)
      );
    }
  }

  if (states) {
    for (const [clientId, byAccount] of stamps) {
      await writeSyncState(
        admin,
        clientId,
        STATE_KEY,
        markAccountsProcessed(states.get(clientId), byAccount)
      );
    }
  }

  return NextResponse.json({
    ok: true,
    creatives_upserted: creativesUpserted,
    accounts_processed: accountsProcessed,
    accounts_failed: accountsFailed,
    accounts_throttled: accountsThrottled,
    accounts_skipped: accountsSkipped,
    metric_columns: hasMetricColumns,
    link_clicks: withClicksAll,
  });
}
