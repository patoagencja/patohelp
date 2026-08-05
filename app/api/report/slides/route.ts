import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import {
  copyPresentation,
  fillPlaceholders,
} from "@/lib/integrations/google-slides";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import {
  buildTokenValues,
  getSegmentMonthData,
  type CampaignFilter,
} from "@/lib/report/segment-data";
import { createAdminClient } from "@/lib/supabase/admin";

// Generates the monthly Google Slides decks: copies each active template,
// fills its {{tokens}} with the month's segment numbers, records the run.
// POST /api/report/slides?client=olx[&month=YYYY-MM][&template=<id>]
// Agency session or CRON_SECRET bearer (so the monthly cron can call it).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client");
  if (!clientSlug) {
    return NextResponse.json({ ok: false, error: "Missing client" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Auth: cron bearer or agency session.
  const bearer = request.headers.get("authorization");
  const bearerOk =
    !!process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`;
  let clientId: string;
  if (bearerOk) {
    const { data: c } = await admin
      .from("clients")
      .select("id")
      .eq("slug", clientSlug)
      .single();
    if (!c) {
      return NextResponse.json({ ok: false, error: "Unknown client" }, { status: 404 });
    }
    clientId = c.id as string;
  } else {
    const access = await requireAgencyClientAccess(clientSlug);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: "Brak dostępu" }, { status: access.status });
    }
    clientId = access.clientId;
  }

  // Slides refresh token (per-client integration).
  const { data: integ } = await admin
    .from("integrations")
    .select("credentials_encrypted")
    .eq("client_id", clientId)
    .eq("provider", "google_slides")
    .single();
  if (!integ?.credentials_encrypted) {
    return NextResponse.json(
      { ok: false, error: "Google Slides nie połączony (Ustawienia → Połącz Slides)" },
      { status: 400 }
    );
  }
  const { refresh_token } = JSON.parse(decrypt(integ.credentials_encrypted as string));

  // Month: ?month=YYYY-MM or previous calendar month.
  const monthParam = searchParams.get("month");
  const monthDate =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? new Date(`${monthParam}-15T00:00:00`)
      : undefined;

  // Templates: one (?template=) or all active for the client.
  const templateId = searchParams.get("template");
  let query = admin
    .from("report_templates")
    .select("id, name, template_presentation_id, campaign_filter, drive_folder_id")
    .eq("client_id", clientId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (templateId) query = query.eq("id", templateId);
  const { data: templates } = await query;

  // Rows without a Slides file use the built-in PPTX engine (/api/report/olx-v3)
  // and are not generated here.
  const slidesTemplates = (templates ?? []).filter(
    (t) => !!t.template_presentation_id
  );
  if (!slidesTemplates.length) {
    return NextResponse.json(
      { ok: false, error: "Brak szablonów Google Slides dla tego klienta (raporty PPTX pobierasz przyciskiem Pobierz PPTX)" },
      { status: 404 }
    );
  }

  const results: Array<Record<string, unknown>> = [];
  for (const t of slidesTemplates) {
    try {
      const data = await getSegmentMonthData(
        clientId,
        t.campaign_filter as CampaignFilter,
        monthDate
      );
      const values = buildTokenValues(data);
      const copy = await copyPresentation(
        refresh_token,
        t.template_presentation_id as string,
        `${t.name} — ${data.monthLabel}`,
        t.drive_folder_id as string | null
      );
      const replaced = await fillPlaceholders(refresh_token, copy.id, values);

      await admin.from("report_runs").upsert(
        {
          template_id: t.id,
          client_id: clientId,
          month: data.month,
          presentation_id: copy.id,
          presentation_url: copy.url,
          status: "ok",
          error: null,
        },
        { onConflict: "template_id,month" }
      );
      results.push({
        template: t.name,
        ok: true,
        url: copy.url,
        tokens_replaced: replaced,
        spend: values.spend,
        campaigns: data.campaignCount,
      });
    } catch (e) {
      const msg = (e as Error).message;
      await admin.from("report_runs").upsert(
        {
          template_id: t.id,
          client_id: clientId,
          month: monthParam ?? new Date().toISOString().slice(0, 7),
          status: "error",
          error: msg,
        },
        { onConflict: "template_id,month" }
      );
      results.push({ template: t.name, ok: false, error: msg });
    }
  }

  return NextResponse.json({ ok: true, results });
}
