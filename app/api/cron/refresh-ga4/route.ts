import { NextResponse } from "next/server";

// Vercel Cron endpoint — pulls GA4 reports into `ga4_daily`.
// Auth: requires `Authorization: Bearer <CRON_SECRET>`.
// Implementation lands in Phase 2.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { error: "Not implemented — Phase 2" },
    { status: 501 }
  );
}
