import { NextResponse } from "next/server";

import { getDemoAbView } from "@/lib/demo/ab";
import { getDemoSeasonView } from "@/lib/demo/season";
import { buildSeasonPulse, buildSeasonPulseEmail } from "@/lib/notify/season-pulse";

export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// The morning e-mail as the demo client would get it - the same builder as
// the real cron (app/api/cron/season-pulse). ?dzien= pins "today".
export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("dzien");
  const day = raw && ISO_DAY.test(raw) ? raw : "2026-12-10";
  const pulse = buildSeasonPulse({
    clientName: "Sklep z prezentami (demo)",
    view: getDemoSeasonView(day),
    ab: getDemoAbView("7d", day),
    showRevenue: true,
    dashboardUrl: "/demo-full/sezon",
  });
  if (!pulse) return new NextResponse("Poza sezonem - wybierz dzień między 2.10 a 24.12.", { status: 404 });
  return new NextResponse(buildSeasonPulseEmail(pulse).html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
