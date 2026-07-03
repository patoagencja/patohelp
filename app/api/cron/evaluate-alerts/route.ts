import { NextResponse } from "next/server";

import { evaluateAlerts } from "@/lib/alerts/rules";
import { describeError } from "@/lib/integrations/errors";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron (every 6h): evaluate alert rules per client and persist new
// alerts. Dedup: skip when the same category+campaign fired in the last 24h.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALERT_TTL_DAYS = 7;

export async function GET(request: Request) {
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: clients } = await admin.from("clients").select("id, slug");

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const expiresAt = new Date(
    Date.now() + ALERT_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  let created = 0;
  let deduped = 0;
  const errors: string[] = [];

  for (const client of clients ?? []) {
    try {
      const candidates = await evaluateAlerts(admin, client.id);
      if (!candidates.length) continue;

      const { data: recent } = await admin
        .from("client_alerts")
        .select("category, campaign_id")
        .eq("client_id", client.id)
        .gte("generated_at", since24h);

      const seen = new Set(
        (recent ?? []).map((a) => `${a.category}:${a.campaign_id ?? ""}`)
      );

      const fresh = candidates.filter(
        (c) => !seen.has(`${c.category}:${c.campaignId ?? ""}`)
      );
      deduped += candidates.length - fresh.length;

      if (fresh.length) {
        const { error } = await admin.from("client_alerts").insert(
          fresh.map((c) => ({
            client_id: client.id,
            severity: c.severity,
            category: c.category,
            title: c.title,
            description: c.description,
            campaign_id: c.campaignId,
            provider: c.provider,
            auto_expires_at: expiresAt,
          }))
        );
        if (error) throw new Error(error.message);
        created += fresh.length;
      }
    } catch (err) {
      const message = describeError(err);
      console.error(`[cron/evaluate-alerts] ${client.slug} failed`, message);
      errors.push(`${client.slug}: ${message}`);
    }
  }

  return NextResponse.json({ ok: true, created, deduped, errors });
}
