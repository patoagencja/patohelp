import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { detectAnomalies } from "@/lib/alerts/anomalies";
import { detectBudgetSpikes, type BudgetConfig } from "@/lib/alerts/budget";
import { getPacing } from "@/lib/alerts/pacing";
import {
  buildDigest,
  sendEmail,
  sendTelegram,
  sendWhatsApp,
  type AlertItem,
} from "@/lib/notify/send";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron: detect anomalies + pacing shortfalls and notify each client's
// configured recipients (email / WhatsApp), respecting their allowed hours and
// deduplicating so each alert is sent at most once per day.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WARSAW_TZ = "Europe/Warsaw";

interface Settings {
  client_id: string;
  email_enabled: boolean;
  emails: string[];
  whatsapp_enabled: boolean;
  whatsapp_numbers: string[];
  telegram_enabled: boolean;
  telegram_chat_ids: string[];
  hour_start: number;
  hour_end: number;
  min_severity: string;
  daily_spend_cap_minor_units: number | null;
  account_daily_spend_cap_minor_units: number | null;
  spike_multiplier: number | null;
}

export async function GET(request: Request) {
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const today = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const hour = Number(formatInTimeZone(now, WARSAW_TZ, "H"));

  const { data: settingsRows } = await admin
    .from("notification_settings")
    .select(
      "client_id, email_enabled, emails, whatsapp_enabled, whatsapp_numbers, telegram_enabled, telegram_chat_ids, hour_start, hour_end, min_severity, daily_spend_cap_minor_units, account_daily_spend_cap_minor_units, spike_multiplier"
    );

  let notified = 0;

  for (const s of (settingsRows ?? []) as Settings[]) {
    if (!s.email_enabled && !s.whatsapp_enabled && !s.telegram_enabled) continue;

    // Critical budget spikes ignore quiet hours; everything else waits for the
    // allowed window. We still evaluate budget spikes every run so an overspend
    // is caught the moment fresh data lands, day or night.
    const inWindow = hour >= s.hour_start && hour < s.hour_end;

    const { data: client } = await admin
      .from("clients")
      .select("name")
      .eq("id", s.client_id)
      .single();
    const clientName = (client?.name as string) ?? "Klient";

    const budgetConfig: BudgetConfig = {
      campaignCap: s.daily_spend_cap_minor_units ?? null,
      accountCap: s.account_daily_spend_cap_minor_units ?? null,
      multiplier: s.spike_multiplier && s.spike_multiplier > 0 ? s.spike_multiplier : 3,
    };

    const [spikes, anomalies, pacing] = await Promise.all([
      detectBudgetSpikes(s.client_id, admin, budgetConfig),
      detectAnomalies(s.client_id, admin),
      getPacing(s.client_id),
    ]);

    const items: AlertItem[] = [];

    // Budget spikes are always critical and always eligible to send.
    for (const a of spikes) {
      items.push({
        key: a.id,
        title: a.title,
        detail: a.description,
        scope: a.scopeLabel,
        critical: true,
      });
    }

    // Regular anomalies + pacing only inside the allowed hours.
    if (inWindow) {
      for (const a of anomalies) {
        if (s.min_severity === "high" && a.severity !== "high") continue;
        items.push({
          key: a.id,
          title: a.title,
          detail: a.description,
          scope: a.scopeLabel,
        });
      }
      for (const f of pacing) {
        if (f.status !== "behind") continue;
        items.push({
          key: `pacing-${f.id}`,
          title: `Nie dowozi: ${f.campaignName}`,
          detail: `Realizacja ${(f.realizedPct * 100).toFixed(0)}% celu, ${Math.max(
            f.daysLeft,
            0
          )} dni do końca.`,
          scope: "Pacing",
        });
      }
    }

    if (items.length === 0) continue;

    // Deduplicate: only keep items not already sent today (unique constraint).
    const fresh: AlertItem[] = [];
    for (const item of items) {
      const { error } = await admin
        .from("notifications_sent")
        .insert({ client_id: s.client_id, alert_key: item.key, sent_on: today });
      if (!error) fresh.push(item); // no conflict => first time today
    }

    if (fresh.length === 0) continue;

    const digest = buildDigest(clientName, fresh);
    const subject = `Alerty — ${clientName} (${fresh.length})`;

    if (s.email_enabled) await sendEmail(s.emails ?? [], subject, digest.html);
    if (s.whatsapp_enabled)
      await sendWhatsApp(s.whatsapp_numbers ?? [], digest.text);
    if (s.telegram_enabled)
      await sendTelegram(s.telegram_chat_ids ?? [], digest.text);

    notified += 1;
  }

  return NextResponse.json({ ok: true, clients_notified: notified });
}
