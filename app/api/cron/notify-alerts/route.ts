import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { detectAnomalies, type Anomaly } from "@/lib/alerts/anomalies";
import { detectBudgetSpikes, type BudgetConfig } from "@/lib/alerts/budget";
import { detectCreativeAlerts } from "@/lib/alerts/creative-tests";
import { getPacing, type FlightMetric } from "@/lib/alerts/pacing";
import { describeError } from "@/lib/integrations/errors";
import {
  getExpiringTokens,
  getUnhealthyIntegrations,
} from "@/lib/dashboard/integration-health";
import { isMetaSessionInvalidated } from "@/lib/integrations/errors";
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

const plusDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const GOAL_UNIT: Record<FlightMetric, string> = {
  clicks: "kliknięć w link",
  clicks_all: "kliknięć",
  impressions: "wyświetleń",
  spend: "zł",
  conversions: "konwersji",
};

/** "1 240 kliknięć w link", "5 300 zł" (spend is stored in grosze). */
function goalValue(metric: FlightMetric, value: number): string {
  const n = metric === "spend" ? Math.round(value / 100) : Math.round(value);
  return `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${GOAL_UNIT[metric]}`;
}

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
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
  const errors: string[] = [];

  for (const s of (settingsRows ?? []) as Settings[]) {
    if (!s.email_enabled && !s.whatsapp_enabled && !s.telegram_enabled) continue;
    // One client's failure (a detector throwing on odd data, a send error)
    // used to abort the whole run with a 500 - nobody after it was notified.
    try {
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

      const [spikes, anomalies, pacing, creativeAlerts] = await Promise.all([
        detectBudgetSpikes(s.client_id, admin, budgetConfig),
        detectAnomalies(s.client_id, admin),
        getPacing(s.client_id),
        // Creative tests (seasonal / e-commerce clients only - the detector
        // checks); warnings only, so not even read in quiet hours. Best
        // effort: a failure here must not cost the client every other alert.
        inWindow
          ? detectCreativeAlerts(s.client_id, admin).catch((err): Anomaly[] => {
              console.warn(
                `[cron/notify-alerts] creative tests for ${s.client_id} failed`,
                describeError(err)
              );
              return [];
            })
          : Promise.resolve([] as Anomaly[]),
      ]);

      const items: AlertItem[] = [];

      // A dead integration is urgent and self-hiding: the dashboard keeps looking
      // "LIVE" off the other providers while one source silently stops (SUNEW's
      // GA4 went unnoticed for 19 days). Critical, so it ignores quiet hours, and
      // deduped to once per day per provider by the notifications_sent key below.
      for (const h of await getUnhealthyIntegrations(s.client_id)) {
        const downFor =
          h.hoursSinceSuccess === null
            ? "nigdy się nie zsynchronizowało"
            : h.hoursSinceSuccess >= 24
              ? `brak danych od ${Math.floor(h.hoursSinceSuccess / 24)} dni`
              : `brak danych od ${Math.max(1, Math.round(h.hoursSinceSuccess))} godz.`;
        items.push({
          key: `integration-down-${h.provider}`,
          title: `${h.label} nie dostarcza danych`,
          detail: h.tokenExpired
            ? h.provider === "meta_ads"
              ? isMetaSessionInvalidated(h.lastError)
                ? `${downFor}. Facebook unieważnił sesję (zmiana hasła lub reset bezpieczeństwa) - wklej w Ustawieniach token System User, który nie zależy od hasła, albo połącz ponownie (naprawi wszystkich klientów z tym logowaniem).`
                : `${downFor}. Token wygasł - połącz ponownie albo wklej w Ustawieniach token System User, który nie wygasa.`
              : h.testingModeSuspected
                ? `${downFor}. Aplikacja Google jest w trybie Testing - tokeny wygasają po 7 dniach. Napraw: Google Cloud Console → APIs & Services → OAuth consent screen → Publish app, potem połącz ponownie.`
                : `${downFor}. Token wygasł - połącz ponownie w Ustawieniach.`
            : `${downFor}.${h.lastError ? ` Błąd: ${h.lastError}` : ""}`,
          scope: "Integracje",
          critical: true,
        });
      }

      // Heads-up before a token dies, so the data never has a gap. Not
      // critical - waits for the allowed window, once per day.
      if (inWindow) {
        for (const e of await getExpiringTokens(s.client_id)) {
          items.push({
            key: `token-expiring-${e.provider}`,
            title: `${e.label}: token wygaśnie za ${e.daysLeft} dni`,
            detail:
              "Wklej w Ustawieniach → Połączenia token System User, który nie wygasa.",
            scope: "Integracje",
          });
        }
      }

      // Single-day blowouts (critical) always fire, even outside the window.
      // Weekly elevated-spend (high) is a slower signal - respect the window.
      for (const a of spikes) {
        if (a.severity === "critical") {
          items.push({
            key: a.id,
            title: a.title,
            detail: a.description,
            scope: a.scopeLabel,
            critical: true,
          });
        } else if (inWindow) {
          items.push({
            key: a.id,
            title: a.title,
            detail: a.description,
            scope: a.scopeLabel,
          });
        }
      }

      // Critical anomalies (e.g. a shop taking zero orders on normal traffic)
      // cost money every hour they go unnoticed - they ignore quiet hours.
      for (const a of anomalies) {
        if (a.severity !== "critical") continue;
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
          if (a.severity === "critical") continue; // already queued above
          if (s.min_severity === "high" && a.severity !== "high") continue;
          items.push({
            key: a.id,
            title: a.title,
            detail: a.description,
            scope: a.scopeLabel,
          });
        }
        // Losing / wearing-out ads: warnings, so they respect quiet hours.
        for (const a of creativeAlerts) {
          if (s.min_severity === "high" && a.severity !== "high") continue;
          items.push({
            key: a.id,
            title: a.title,
            detail: a.description,
            scope: a.scopeLabel,
          });
        }
        // Goal reached: once per goal ever (not once a day like the rest),
        // the moment it crosses 100% - the agency wants to know an ad set
        // has done its job so the budget can move. A goal that finished
        // reached more than 2 days ago is old news, not sent.
        for (const f of pacing) {
          if (f.target <= 0 || f.realized < f.target) continue;
          if (f.status === "upcoming") continue;
          if (f.status === "ended" && f.endDate < plusDaysIso(today, -2)) continue;
          const key = `goal-done-${f.id}`;
          const { data: already } = await admin
            .from("notifications_sent")
            .select("id")
            .eq("client_id", s.client_id)
            .eq("alert_key", key)
            .limit(1);
          if (already && already.length > 0) continue;
          const left = Math.max(f.daysLeft, 0);
          items.push({
            key,
            success: true,
            title: `Cel osiągnięty: ${f.adsetName ?? f.campaignName}`,
            detail: `${goalValue(f.metric, f.realized)} z ${goalValue(f.metric, f.target)} (${Math.round(
              f.realizedPct * 100
            )}% celu)${
              f.status === "ended"
                ? "."
                : left > 0
                  ? `, ${left} ${left === 1 ? "dzień" : "dni"} przed końcem - można przesunąć budżet.`
                  : " - ostatni dzień."
            }`,
            scope: f.adsetName ? `Zestaw w kampanii ${f.campaignName}` : "Cel kampanii",
          });
        }
        for (const f of pacing) {
          if (f.status !== "behind") continue;
          // Reached goals are reported above, never as "nie dowozi".
          if (f.target > 0 && f.realized >= f.target) continue;
          items.push({
            key: `pacing-${f.id}`,
            title: `Nie dowozi: ${f.adsetName ? `${f.adsetName} (${f.campaignName})` : f.campaignName}`,
            detail: `Realizacja ${(f.realizedPct * 100).toFixed(0)}% celu, ${Math.max(
              f.daysLeft,
              0
            )} ${f.daysLeft === 1 ? "dzień" : "dni"} do końca.`,
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
      const reached = fresh.filter((i) => i.success).length;
      const subject =
        reached === fresh.length
          ? reached === 1
            ? `Cel osiągnięty — ${clientName}: ${fresh[0].title.replace(/^Cel osiągnięty: /, "")}`
            : `Cele osiągnięte — ${clientName} (${reached})`
          : `Alerty — ${clientName} (${fresh.length})`;

      if (s.email_enabled) await sendEmail(s.emails ?? [], subject, digest.html);
      if (s.whatsapp_enabled)
        await sendWhatsApp(s.whatsapp_numbers ?? [], digest.text);
      if (s.telegram_enabled)
        await sendTelegram(s.telegram_chat_ids ?? [], digest.telegram);

      notified += 1;
    } catch (err) {
      const message = describeError(err);
      console.error(`[cron/notify-alerts] client ${s.client_id} failed`, message);
      errors.push(`${s.client_id}: ${message}`);
    }
  }

  return NextResponse.json({ ok: true, clients_notified: notified, errors });
}
