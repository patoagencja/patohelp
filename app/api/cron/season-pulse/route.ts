import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/integrations/cron-auth";
import { loadAbView } from "@/lib/ab/load";
import { describeError } from "@/lib/integrations/errors";
import { buildSeasonPulse, buildSeasonPulseEmail } from "@/lib/notify/season-pulse";
import { sendEmail } from "@/lib/notify/send";
import { parseSeason, seasonState } from "@/lib/season/config";
import { loadSeasonView } from "@/lib/season/load";
import { createAdminClient } from "@/lib/supabase/admin";

// "Puls sezonu" - every morning of a client's season, yesterday's numbers
// and today's creative decisions by e-mail (lib/notify/season-pulse.ts).
// Pinged every 30 minutes by the external scheduler like the weekly digest;
// gates itself to 7:00-9:59 Warsaw and dedupes per day through
// notifications_sent. Opt-in: the client's "podsumowanie e-mail" switch
// (weekly_digest_enabled) covers it - no new consent to manage.
//
// Testing: ?force=1&client=<slug> sends now (window, opt-in and dedupe
// ignored, nothing recorded); add &dry=1 to get the HTML back instead.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WARSAW_TZ = "Europe/Warsaw";
const WINDOW_START_HOUR = 7;
const WINDOW_END_HOUR = 10; // exclusive

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const onlySlug = url.searchParams.get("client");
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";
  if ((force || dry) && !onlySlug) {
    return NextResponse.json({ error: "force/dry wymaga parametru client=<slug>" }, { status: 400 });
  }

  const now = new Date();
  const today = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const hour = Number(formatInTimeZone(now, WARSAW_TZ, "H"));
  if (!force && !dry && (hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR)) {
    return NextResponse.json({ ok: true, skipped: "outside morning window" });
  }

  const admin = createAdminClient();
  // Before migration 0037 there is no season column: nobody is seasonal.
  const clientsRes = await admin.from("clients").select("id, slug, name, client_type, season");
  if (clientsRes.error) {
    return NextResponse.json({ ok: true, skipped: "season column missing (run ALL_RECENT_7.sql)" });
  }
  let clients = (clientsRes.data ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    client_type: string | null;
    season: unknown;
  }>;
  if (onlySlug) clients = clients.filter((c) => c.slug === onlySlug);

  const { data: settingsRows } = await admin
    .from("notification_settings")
    .select("client_id, emails, weekly_digest_enabled, weekly_digest_emails");
  const settings = new Map(
    ((settingsRows ?? []) as Array<{
      client_id: string;
      emails: string[] | null;
      weekly_digest_enabled: boolean | null;
      weekly_digest_emails: string[] | null;
    }>).map((s) => [s.client_id, s])
  );

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/+$/, "");
  let sent = 0;
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const client of clients) {
    const cfg = parseSeason(client.season);
    if (!cfg) continue;
    const state = seasonState(cfg, today);
    if (state.phase !== "in" || (state.day ?? 0) < 2) {
      if (onlySlug) skipped.push(`${client.slug}: poza sezonem lub pierwszy dzień`);
      continue;
    }
    const s = settings.get(client.id);
    if (!force && !dry && !s?.weekly_digest_enabled) continue;
    const digestList = (s?.weekly_digest_emails ?? []).filter(looksLikeEmail);
    const recipients = digestList.length ? digestList : (s?.emails ?? []).filter(looksLikeEmail);
    if (!dry && recipients.length === 0) {
      skipped.push(`${client.slug}: brak adresów e-mail`);
      continue;
    }

    const key = `season-pulse-${today}`;
    const claim = !force && !dry;
    if (claim) {
      const { error } = await admin
        .from("notifications_sent")
        .insert({ client_id: client.id, alert_key: key, sent_on: today });
      if (error) {
        skipped.push(`${client.slug}: już wysłane dziś`);
        continue;
      }
    }
    const release = async () => {
      if (!claim) return;
      await admin.from("notifications_sent").delete().eq("client_id", client.id).eq("alert_key", key);
    };

    try {
      const shop = client.client_type === "ecommerce";
      const [view, ab] = await Promise.all([
        loadSeasonView(client.id, cfg, today),
        shop ? loadAbView(client.id, "7d", today).catch(() => null) : Promise.resolve(null),
      ]);
      const pulse = buildSeasonPulse({
        clientName: client.name,
        view,
        ab,
        showRevenue: shop,
        dashboardUrl: `${appUrl}/${client.slug}/sezon`,
      });
      if (!pulse) {
        await release();
        skipped.push(`${client.slug}: brak danych`);
        continue;
      }
      const email = buildSeasonPulseEmail(pulse);
      if (dry) {
        return new NextResponse(email.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      const res = await sendEmail(recipients, email.subject, email.html);
      if (!res.ok) {
        await release();
        errors.push(`${client.slug}: ${res.error ?? "wysyłka nie powiodła się"}`);
        continue;
      }
      sent += 1;
    } catch (err) {
      await release();
      const message = describeError(err);
      console.error(`[cron/season-pulse] ${client.slug} failed`, message);
      errors.push(`${client.slug}: ${message}`);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors });
}
