import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/integrations/cron-auth";
import { describeError } from "@/lib/integrations/errors";
import { sendEmail } from "@/lib/notify/send";
import {
  buildWeeklyDigestEmail,
  loadWeeklyDigest,
  previousFullWeek,
} from "@/lib/notify/weekly-digest";
import { createAdminClient } from "@/lib/supabase/admin";

// "Twój tydzień w skrócie" - Monday-morning e-mail summarising the previous
// Mon-Sun week. The external scheduler pings this every 30 minutes, so the
// route gates itself to Monday 8:00-10:59 Warsaw (a slightly wider window than
// "about 8-10" because GitHub cron ticks are often late) and dedupes per ISO
// week through notifications_sent - each client gets at most one per week.
//
// Testing: ?force=1&client=<slug> sends now, ignoring the window, the opt-in
// flag and the dedupe (and doesn't record a send, so Monday still goes out).
// Add &dry=1 to get the rendered HTML back instead of sending anything.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WARSAW_TZ = "Europe/Warsaw";
const WINDOW_START_HOUR = 8;
const WINDOW_END_HOUR = 11; // exclusive

interface DigestSettings {
  client_id: string;
  emails: string[] | null;
  weekly_digest_enabled: boolean;
  weekly_digest_emails: string[] | null;
}

interface ClientRow {
  id: string;
  slug: string;
  name: string;
  client_type?: string | null;
}

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";
  const onlySlug = url.searchParams.get("client");
  // Forcing without a client would e-mail every client mid-week - refuse.
  if ((force || dry) && !onlySlug) {
    return NextResponse.json(
      { error: "force/dry wymaga parametru client=<slug>" },
      { status: 400 }
    );
  }

  const now = new Date();
  const today = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const isoDow = Number(formatInTimeZone(now, WARSAW_TZ, "i")); // 1 = Monday
  const hour = Number(formatInTimeZone(now, WARSAW_TZ, "H"));
  const week = previousFullWeek(today);

  if (
    !force &&
    !dry &&
    (isoDow !== 1 || hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR)
  ) {
    return NextResponse.json({ ok: true, skipped: "outside Monday window", week: week.key });
  }

  const admin = createAdminClient();

  // Defensive: before migration 0022 the columns don't exist - skip quietly
  // instead of failing the scheduler run.
  const { data: settingsRows, error: settingsError } = await admin
    .from("notification_settings")
    .select("client_id, emails, weekly_digest_enabled, weekly_digest_emails");
  if (settingsError) {
    return NextResponse.json({
      ok: true,
      skipped: "weekly digest columns missing (run migration 0022)",
      detail: settingsError.message,
    });
  }
  const settingsByClient = new Map(
    ((settingsRows ?? []) as DigestSettings[]).map((s) => [s.client_id, s])
  );

  // client_type arrives with migration 0016; fall back to engagement without it
  // (the safe default - engagement clients never see revenue).
  let clientsRes = await admin.from("clients").select("id, slug, name, client_type");
  if (clientsRes.error) clientsRes = await admin.from("clients").select("id, slug, name");
  let clients = (clientsRes.data ?? []) as ClientRow[];
  if (onlySlug) clients = clients.filter((c) => c.slug === onlySlug);
  if (onlySlug && clients.length === 0) {
    return NextResponse.json({ error: `Nie znaleziono klienta ${onlySlug}` }, { status: 404 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/+$/, "");

  let sent = 0;
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const client of clients) {
    const s = settingsByClient.get(client.id);
    if (!force && !dry && !s?.weekly_digest_enabled) continue;

    // Dedicated digest recipients (the client's marketing team) win; the
    // alert list is the fallback so turning the digest on "just works".
    const digestList = (s?.weekly_digest_emails ?? []).filter(looksLikeEmail);
    const recipients = digestList.length
      ? digestList
      : (s?.emails ?? []).filter(looksLikeEmail);
    if (!dry && recipients.length === 0) {
      skipped.push(`${client.slug}: brak adresów e-mail`);
      continue;
    }

    // Claim the week BEFORE the slow part: the unique constraint makes two
    // overlapping ticks race safely - only one insert wins.
    const claim = !force && !dry;
    if (claim) {
      const { error } = await admin
        .from("notifications_sent")
        .insert({ client_id: client.id, alert_key: week.key, sent_on: today });
      if (error) {
        skipped.push(`${client.slug}: już wysłane (${week.key})`);
        continue;
      }
    }
    // Releasing the claim lets the next tick in the window retry (e.g. the
    // Sunday data hadn't synced yet, or Resend had a hiccup).
    const release = async () => {
      if (!claim) return;
      await admin
        .from("notifications_sent")
        .delete()
        .eq("client_id", client.id)
        .eq("alert_key", week.key);
    };

    try {
      const content = await loadWeeklyDigest(
        admin,
        {
          id: client.id,
          name: client.name,
          slug: client.slug,
          ecommerce: client.client_type === "ecommerce",
        },
        today,
        appUrl
      );
      if (!content) {
        await release();
        skipped.push(`${client.slug}: brak danych za ${week.start}..${week.end}`);
        continue;
      }

      const email = buildWeeklyDigestEmail(content);
      if (dry) {
        return new NextResponse(email.html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
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
      console.error(`[cron/weekly-digest] ${client.slug} failed`, message);
      errors.push(`${client.slug}: ${message}`);
    }
  }

  return NextResponse.json({ ok: true, week: week.key, sent, skipped, errors });
}
