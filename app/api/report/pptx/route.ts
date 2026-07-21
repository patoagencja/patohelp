import { NextResponse } from "next/server";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { getOlxSmReportData } from "@/lib/report/olx-sm-data";
import { buildOlxSmDeck } from "@/lib/report/olx-sm-pptx";
import { createAdminClient } from "@/lib/supabase/admin";

// On-demand monthly PPTX report (agency only): the OLX Social Media template
// deck auto-filled with the given month's data. ?client=<slug>&month=YYYY-MM
// (month defaults to the previous calendar month).
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

  // ?month=2026-06 → any date inside that month; invalid/missing → previous month.
  const monthParam = searchParams.get("month");
  const monthDate =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? new Date(`${monthParam}-15T00:00:00`)
      : undefined;

  try {
    const data = await getOlxSmReportData(
      access.clientId,
      (client?.name as string) ?? clientSlug,
      monthDate
    );
    const buffer = await buildOlxSmDeck(data);

    const filename = `${clientSlug}-sm-report-${data.monthCode.toLowerCase()}.pptx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[report/pptx] failed", err);
    return NextResponse.json(
      { error: "Nie udało się wygenerować raportu PPTX" },
      { status: 500 }
    );
  }
}
