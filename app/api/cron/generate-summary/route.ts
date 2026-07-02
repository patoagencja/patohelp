import { NextResponse } from "next/server";

// Vercel Cron endpoint — generates the daily Polish AI summary via Claude.
// Auth: requires `Authorization: Bearer <CRON_SECRET>`.
// Implementation lands in Phase 3.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { error: "Not implemented — Phase 3" },
    { status: 501 }
  );
}
