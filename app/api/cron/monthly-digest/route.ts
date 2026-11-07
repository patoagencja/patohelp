import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/integrations/cron-auth";
import { describeError } from "@/lib/integrations/errors";
import {
  buildMonthlyDigestEmail,
  loadMonthlyDigest,
} from "@/lib/notify/monthly-digest";
import {
  isMonthlyDigestDue,
  previousMonth,
  warsawClock,
} from "@/lib/notify/monthly-digest-core";
import { sendEmail } from "@/lib/notify/send";
import { createAdminClient } from "@/lib/supabase/admin";

// "Twój <miesiąc> w skrócie" - the previous calendar month by e-mail on the
// 1st (lib/notify/monthly-digest.ts). The external scheduler pings this
// every 30 minutes (.github/workflows/cron.yml, "ai" job), so the route gates
// itself: days 1-3 of the month, 8:00-19:59 Warsaw (isMonthlyDigestDue) -
// a run missed on the 1st still goes out on the 2nd. Dedupe per client and
// month through notifications_sent (key monthly-digest-YYYY-MM, sent_on
// fixed to the 1st), so any number of ticks sends each client one e-mail.
//
// Recipients and consent are the weekly digest's: the client's
// "podsumowanie e-mail" switch (weekly_digest_enabled) and its list, with
// the alert e-mails as fallback - no new setting, no migration.
//
// Testing: ?force=1&client=<slug> sends now, ignoring the window, the opt-in
// flag and the dedupe (and doesn't record a send, so the 1st still goes out).
// Add &dry=1 to get the rendered HTML back instead of sending anything.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  // Forcing without a client would e-mail every client mid-month - refuse.
  if ((force || dry) && !onlySlug) {
    return NextResponse.json(
      { error: "force/dry wymaga parametru client=<slug>" },
      { status: 400 }
    );
  }

  const clock = warsawClock(new Date());
  const month = previousMonth(clock.date);

  if (!force && !dry && !isMonthlyDigestDue(clock)) {
    return NextResponse.json({ ok: true, skipped: "outside send window", month: month.key });
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
      skipped: "digest columns missing (run migration 0022)",
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
    // alert list is the fallback, exactly as for the weekly digest.
    const digestList = (s?.weekly_digest_emails ?? []).filter(looksLikeEmail);
    const recipients = digestList.length
      ? digestList
      : (s?.emails ?? []).filter(looksLikeEmail);
    if (!dry && recipients.length === 0) {
      skipped.push(`${client.slug}: brak adresów e-mail`);
      continue;
    }

    // Claim the month BEFORE the slow part: the unique constraint makes two
    // overlapping ticks race safely - only one insert wins. sent_on is the
    // 1st on every day of the window (DigestMonth.claimDate), so the 2nd and
    // 3rd see the claim of the 1st.
    const claim = !force && !dry;
    if (claim) {
      const { error } = await admin
        .from("notifications_sent")
        .insert({ client_id: client.id, alert_key: month.key, sent_on: month.claimDate });
      if (error) {
        skipped.push(`${client.slug}: już wysłane (${month.key})`);
        continue;
      }
    }
    // Releasing the claim lets the next tick in the window retry (the last
    // day hadn't synced yet, or Resend had a hiccup).
    const release = async () => {
      if (!claim) return;
      await admin
        .from("notifications_sent")
        .delete()
        .eq("client_id", client.id)
        .eq("alert_key", month.key);
    };

    try {
      const content = await loadMonthlyDigest(
        admin,
        {
          id: client.id,
          name: client.name,
          slug: client.slug,
          ecommerce: client.client_type === "ecommerce",
        },
        clock.date,
        appUrl
      );
      if (!content) {
        await release();
        skipped.push(`${client.slug}: brak danych za ${month.start}..${month.end}`);
        continue;
      }

      const email = buildMonthlyDigestEmail(content);
      if (dry) {
        return new NextResponse(email.html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      const res = await sendEmail(recipients, email.subject, email.html, email.text);
      if (!res.ok) {
        await release();
        errors.push(`${client.slug}: ${res.error ?? "wysyłka nie powiodła się"}`);
        continue;
      }
      sent += 1;
    } catch (err) {
      await release();
      const message = describeError(err);
      console.error(`[cron/monthly-digest] ${client.slug} failed`, message);
      errors.push(`${client.slug}: ${message}`);
    }
  }

  return NextResponse.json({ ok: true, month: month.key, sent, skipped, errors });
}
