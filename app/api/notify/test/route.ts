import { NextResponse } from "next/server";

import { detectAnomalies } from "@/lib/alerts/anomalies";
import { getPacing } from "@/lib/alerts/pacing";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { buildDigest, sendEmail, sendWhatsApp, type AlertItem } from "@/lib/notify/send";
import { createAdminClient } from "@/lib/supabase/admin";

// On-demand test notification (agency only). Sends the current alerts (or a
// placeholder if none) to the configured channels immediately — bypasses the
// quiet-hours window and daily dedup so you can verify delivery.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client");
  if (!clientSlug) {
    return NextResponse.json({ ok: false, error: "Missing client" }, { status: 400 });
  }

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "Brak dostępu" }, { status: access.status });
  }

  const admin = createAdminClient();
  const { data: s } = await admin
    .from("notification_settings")
    .select("email_enabled, emails, whatsapp_enabled, whatsapp_numbers")
    .eq("client_id", access.clientId)
    .maybeSingle();

  if (!s || (!s.email_enabled && !s.whatsapp_enabled)) {
    return NextResponse.json(
      { ok: false, error: "Włącz i zapisz kanał (e-mail/WhatsApp) przed testem." },
      { status: 400 }
    );
  }

  const { data: client } = await admin
    .from("clients")
    .select("name")
    .eq("id", access.clientId)
    .single();
  const clientName = (client?.name as string) ?? "Klient";

  // Real alerts if any, otherwise a placeholder so delivery can be verified.
  const [anomalies, pacing] = await Promise.all([
    detectAnomalies(access.clientId, admin),
    getPacing(access.clientId),
  ]);
  const items: AlertItem[] = [
    ...anomalies.map((a) => ({
      key: a.id,
      title: a.title,
      detail: a.description,
      scope: a.scopeLabel,
    })),
    ...pacing
      .filter((f) => f.status === "behind")
      .map((f) => ({
        key: `pacing-${f.id}`,
        title: `Nie dowozi: ${f.campaignName}`,
        detail: `Realizacja ${(f.realizedPct * 100).toFixed(0)}% celu.`,
        scope: "Pacing",
      })),
  ];
  if (items.length === 0) {
    items.push({
      key: "test",
      title: "Test powiadomień",
      detail: "Konfiguracja działa — tak będą wyglądać alerty. Brak aktywnych anomalii.",
      scope: "Test",
    });
  }

  const digest = buildDigest(clientName, items);
  const subject = `[TEST] Alerty — ${clientName}`;

  const results: Record<string, boolean> = {};
  const errors: string[] = [];
  if (s.email_enabled) {
    const r = await sendEmail(s.emails ?? [], subject, digest.html);
    results.email = r.ok;
    if (!r.ok && r.error) errors.push(`Mail: ${r.error}`);
  }
  if (s.whatsapp_enabled) {
    const r = await sendWhatsApp(s.whatsapp_numbers ?? [], digest.text);
    results.whatsapp = r.ok;
    if (!r.ok && r.error) errors.push(`WhatsApp: ${r.error}`);
  }

  const anySent = Object.values(results).some(Boolean);
  return NextResponse.json({
    ok: anySent,
    results,
    error: anySent ? undefined : errors.join(" · ") || "Nie wysłano.",
  });
}
