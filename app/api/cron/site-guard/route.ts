import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FLAP_GUARD_MIN,
  SITE_DOWN_KEY_PREFIX,
  planSiteNotice,
  siteNoticeKey,
  siteNoticeMessage,
  type SiteEvent,
} from "@/lib/alerts/site-guard";
import { toSiteSnapshot, warsawClockLabel } from "@/lib/alerts/site-guard-read";
import { isCronAuthorized } from "@/lib/integrations/cron-auth";
import { describeError } from "@/lib/integrations/errors";
import { sendEmail, sendTelegram, sendWhatsApp } from "@/lib/notify/send";
import { createAdminClient } from "@/lib/supabase/admin";

// Website guard e-mails. Not on any schedule: Supabase's site-guard job
// (migration 0045, pg_cron every 5 min) checks the sites itself and POSTs
// here only when a site CHANGES state - down, or up again - so on a normal
// day this never runs (the Vercel plan's function limits are why the checks
// live in the database). The body is only a wake-up call; everything is read
// back from site_status. A change that couldn't be announced yet stays
// pending there and the database calls again with backoff.
//
// Dedup in notifications_sent: at most one DOWN e-mail per outage (keyed by
// its first failed check, any day), no new DOWN e-mail within 2 h of the
// previous one (a flapping site), a recovery e-mail only after a DOWN one.
// Urgent: quiet hours don't apply. Same recipients and channels as the
// other alerts (notification_settings).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WARSAW_TZ = "Europe/Warsaw";

type Outcome = "sent" | "deferred" | "dropped" | "failed";

export async function POST(request: Request) {
  return run(request);
}

// The same by hand (curl with the cron secret), e.g. after fixing e-mail settings.
export async function GET(request: Request) {
  return run(request);
}

async function run(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("site_status")
    .select(
      "client_id, url, state, since, down_since, fail_streak, ok_streak, last_checked_at, last_ok, last_http_status, last_error, last_fail_status, last_fail_error, notify_event, notify_event_at"
    )
    .not("notify_event", "is", null);
  if (error) {
    console.warn("[cron/site-guard] site_status unreadable (migration 0045?)", error.message);
    return NextResponse.json({ ok: false, error: "site_status unreadable" }, { status: 500 });
  }

  const now = Date.now();
  const counts: Record<Outcome, number> = { sent: 0, deferred: 0, dropped: 0, failed: 0 };
  const errors: string[] = [];
  for (const row of (rows ?? []) as Record<string, unknown>[]) {
    // One client's failure must not cost the others their e-mail.
    try {
      counts[await announce(admin, row, now, errors)] += 1;
    } catch (err) {
      const message = describeError(err);
      console.error(`[cron/site-guard] client ${String(row.client_id)} failed`, message);
      errors.push(`${String(row.client_id)}: ${message}`);
      counts.failed += 1;
    }
  }

  return NextResponse.json({ ok: true, pending: rows?.length ?? 0, ...counts, errors });
}

async function announce(
  admin: SupabaseClient,
  row: Record<string, unknown>,
  now: number,
  errors: string[]
): Promise<Outcome> {
  const clientId = String(row.client_id);
  const event = row.notify_event as SiteEvent;
  const status = toSiteSnapshot(row);

  // Announced (or deliberately skipped): clear the event - unless the
  // database recorded a newer change meanwhile, which stays for its own call.
  const clear = async () => {
    const { error } = await admin
      .from("site_status")
      .update({
        notify_event: null,
        notify_event_at: null,
        notify_attempts: 0,
        notify_last_attempt_at: null,
        notified_at: new Date(now).toISOString(),
      })
      .eq("client_id", clientId)
      .eq("notify_event", event)
      .eq("notify_event_at", row.notify_event_at as string);
    if (error) console.warn(`[cron/site-guard] clear failed for ${clientId}`, error.message);
  };

  if (!status || status.downSince === null || (event !== "down" && event !== "up")) {
    await clear();
    return "dropped";
  }

  const downSinceIso = new Date(status.downSince).toISOString();
  const downKey = siteNoticeKey("down", downSinceIso);
  const upKey = siteNoticeKey("up", downSinceIso);
  const [announced, recentDown, settingsRes, clientRes] = await Promise.all([
    // Any day: an outage can cross midnight between the DOWN and UP e-mails.
    admin
      .from("notifications_sent")
      .select("alert_key")
      .eq("client_id", clientId)
      .in("alert_key", [downKey, upKey]),
    admin
      .from("notifications_sent")
      .select("created_at")
      .eq("client_id", clientId)
      .like("alert_key", `${SITE_DOWN_KEY_PREFIX}%`)
      .gte("created_at", new Date(now - FLAP_GUARD_MIN * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1),
    admin
      .from("notification_settings")
      .select(
        "email_enabled, emails, whatsapp_enabled, whatsapp_numbers, telegram_enabled, telegram_chat_ids"
      )
      .eq("client_id", clientId)
      .maybeSingle(),
    admin.from("clients").select("name, client_type").eq("id", clientId).maybeSingle(),
  ]);
  // Without the sent-log we can't dedup: wait for the next call, never risk a repeat.
  if (announced.error) throw new Error(`notifications_sent: ${announced.error.message}`);
  const keys = new Set((announced.data ?? []).map((r) => String(r.alert_key)));
  const lastDown = recentDown.data?.[0]?.created_at;

  const plan = planSiteNotice({
    event,
    state: status.state,
    okStreak: status.okStreak,
    downAnnounced: keys.has(downKey),
    upAnnounced: keys.has(upKey),
    lastDownAnnouncedAt: typeof lastDown === "string" ? Date.parse(lastDown) : null,
    now,
  });
  if (plan.action === "defer") return "deferred";
  if (plan.action === "drop") {
    await clear();
    return "dropped";
  }

  const s = settingsRes.data as {
    email_enabled: boolean;
    emails: string[] | null;
    whatsapp_enabled: boolean;
    whatsapp_numbers: string[] | null;
    telegram_enabled: boolean;
    telegram_chat_ids: string[] | null;
  } | null;
  // Nobody to tell: the Alerty card still shows it.
  if (!s || (!s.email_enabled && !s.whatsapp_enabled && !s.telegram_enabled)) {
    await clear();
    return "dropped";
  }

  // Claim before sending (unique per day): a parallel call that got here
  // first has already sent it. Any other insert error must not lose an
  // outage e-mail, so it goes out unclaimed.
  const key = event === "down" ? downKey : upKey;
  const today = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const claim = await admin
    .from("notifications_sent")
    .insert({ client_id: clientId, alert_key: key, sent_on: today });
  if (claim.error?.code === "23505") {
    await clear();
    return "dropped";
  }
  if (claim.error) console.warn(`[cron/site-guard] claim failed for ${clientId}/${key}`, claim.error.message);

  const client = clientRes.data as { name?: string; client_type?: string } | null;
  const message = siteNoticeMessage({
    event,
    clientName: client?.name ?? "Klient",
    isShop: client?.client_type === "ecommerce",
    url: status.url,
    now,
    downSince: status.downSince,
    upSince: event === "up" ? status.since : null,
    failStatus: status.lastFailStatus,
    failError: status.lastFailError,
    failStreak: status.failStreak,
    startedLabel: warsawClockLabel(status.downSince, now),
    endedLabel: event === "up" ? warsawClockLabel(status.since, now) : null,
  });

  const results = await Promise.all([
    s.email_enabled ? sendEmail(s.emails ?? [], message.subject, message.html, message.text) : null,
    s.whatsapp_enabled ? sendWhatsApp(s.whatsapp_numbers ?? [], message.text) : null,
    s.telegram_enabled ? sendTelegram(s.telegram_chat_ids ?? [], message.telegram) : null,
  ]);
  const tried = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (tried.length > 0 && tried.every((r) => !r.ok)) {
    // Reached nobody: release the claim and leave the event pending - the
    // database calls again (10, 20, 40 min...).
    if (!claim.error) {
      await admin
        .from("notifications_sent")
        .delete()
        .eq("client_id", clientId)
        .eq("alert_key", key)
        .eq("sent_on", today);
    }
    errors.push(`${clientId}: ${tried.map((r) => r.error ?? "wysyłka nie powiodła się").join(" | ")}`);
    return "failed";
  }

  await clear();
  return "sent";
}
