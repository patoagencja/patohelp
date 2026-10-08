import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/integrations/cron-auth";
import { generateWeeklySummary } from "@/lib/ai/summary";
import { describeError } from "@/lib/integrations/errors";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron (daily, 7:00 Warsaw): generate the Polish AI summary for every
// client that has ad data. Idempotent per day - skips clients already
// summarized today.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // Warsaw midnight as a UTC instant. A hard-coded "+02:00" is only right in
  // summer: in winter (CET, +01:00) it put "today" an hour early.
  const todayStart = fromZonedTime(
    `${formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd")}T00:00:00`,
    "Europe/Warsaw"
  ).toISOString();

  const { data: clients } = await admin.from("clients").select("id, slug");

  let generated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const client of clients ?? []) {
    try {
      // Skip clients with no ad data at all.
      const { count: adRows } = await admin
        .from("ads_daily")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id);
      if (!adRows) {
        skipped += 1;
        continue;
      }

      // Idempotence: one summary per day.
      const { count: todayCount } = await admin
        .from("ai_summaries")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id)
        .gte("generated_at", todayStart);
      if (todayCount) {
        skipped += 1;
        continue;
      }

      await generateWeeklySummary(admin, client.id);
      generated += 1;
    } catch (err) {
      const message = describeError(err);
      console.error(`[cron/generate-summary] ${client.slug} failed`, message);
      errors.push(`${client.slug}: ${message}`);
    }
  }

  return NextResponse.json({ ok: true, generated, skipped, errors });
}
