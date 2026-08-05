import { NextResponse } from "next/server";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { getOlxSmReportData } from "@/lib/report/olx-sm-data";
import { buildV3Tokens, fillV3Template } from "@/lib/report/olx-v3-fill";
import type { CampaignFilter } from "@/lib/report/segment-data";
import { createAdminClient } from "@/lib/supabase/admin";

// Downloads a filled OLX SM Report v3 deck (official template, bundled) for
// one segment - entirely server-side, no Google APIs.
// GET /api/report/olx-v3?client=olx&template=<report_templates.id>[&month=YYYY-MM]
// or ad-hoc: ?client=olx&all_of=GOODS,CEP[&any_of=...]
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client");
  if (!clientSlug) {
    return NextResponse.json({ error: "Missing client" }, { status: 400 });
  }

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    return NextResponse.json({ error: "Brak dostępu" }, { status: access.status });
  }

  const admin = createAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("name")
    .eq("id", access.clientId)
    .single();

  // Resolve the segment filter: saved template row or ad-hoc query params.
  let filter: CampaignFilter | undefined;
  let reportName = clientSlug;
  const templateId = searchParams.get("template");
  if (templateId) {
    // Accept a row id or a (case-insensitive) template name - easier to link.
    const isUuid = /^[0-9a-f-]{36}$/i.test(templateId);
    const { data: t } = await admin
      .from("report_templates")
      .select("name, campaign_filter")
      .eq("client_id", access.clientId)
      [isUuid ? "eq" : "ilike"](isUuid ? "id" : "name", templateId)
      .limit(1)
      .maybeSingle();
    if (!t) {
      const { data: names } = await admin
        .from("report_templates")
        .select("name")
        .eq("client_id", access.clientId)
        .order("sort_order");
      return NextResponse.json(
        {
          error: "Nieznany szablon",
          hint: names?.length
            ? `Dostępne: ${names.map((n) => n.name).join(", ")}`
            : "Brak szablonów - uruchom migrację 0019 (zasieje 14 raportów OLX) albo użyj ?all_of=GOODS,CEP",
        },
        { status: 404 }
      );
    }
    filter = t.campaign_filter as CampaignFilter;
    reportName = t.name as string;
  } else {
    const split = (v: string | null) =>
      (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const allOf = split(searchParams.get("all_of"));
    const anyOf = split(searchParams.get("any_of"));
    if (allOf.length || anyOf.length) {
      filter = { all_of: allOf, any_of: anyOf };
      reportName = allOf.join("-") || anyOf.join("-");
    }
  }

  const monthParam = searchParams.get("month");
  const monthDate =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? new Date(`${monthParam}-15T00:00:00`)
      : undefined;

  try {
    const data = await getOlxSmReportData(
      access.clientId,
      (client?.name as string) ?? clientSlug,
      monthDate,
      filter
    );
    const tokens = buildV3Tokens(data);
    const buffer = await fillV3Template(tokens);

    const fname = `OLX_SM_${reportName.replace(/[^\w-]+/g, "_")}_${data.monthCode}.pptx`;
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[report/olx-v3] failed", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
