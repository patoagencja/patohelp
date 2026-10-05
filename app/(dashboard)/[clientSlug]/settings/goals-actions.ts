"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { GOAL_METRICS, type GoalMetric } from "@/lib/dashboard/goals";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

const MONTH = z.string().regex(/^\d{4}-\d{2}-01$/);
// Accepts "40 000", "40000", "40.000"; goals are whole counts.
const TARGET = z
  .string()
  .transform((s) => s.replace(/[\s .]/g, ""))
  .pipe(z.coerce.number().int().positive().max(1e12));

/**
 * Save monthly engagement goals (agency only). An emptied field deletes that
 * metric's goal for the month; an unparseable one is left untouched rather
 * than wiping a goal over a typo. No redirect: revalidation re-renders the
 * settings page in place, and the section shows the fresh "zapisano" stamp.
 */
export async function saveEngagementGoals(formData: FormData) {
  const clientSlug = String(formData.get("client"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const upserts: {
    client_id: string;
    month: string;
    metric: GoalMetric;
    target: number;
    updated_at: string;
  }[] = [];
  const deletes = new Map<string, GoalMetric[]>();

  for (const rawMonth of formData.getAll("goal_month").map(String)) {
    const month = MONTH.safeParse(rawMonth);
    if (!month.success) continue;
    for (const metric of GOAL_METRICS) {
      const raw = String(formData.get(`target_${month.data}_${metric}`) ?? "").trim();
      if (!raw) {
        deletes.set(month.data, [...(deletes.get(month.data) ?? []), metric]);
        continue;
      }
      const target = TARGET.safeParse(raw);
      if (!target.success) continue;
      upserts.push({
        client_id: access.clientId,
        month: month.data,
        metric,
        target: target.data,
        updated_at: now,
      });
    }
  }

  if (upserts.length > 0) {
    await admin
      .from("engagement_goals")
      .upsert(upserts, { onConflict: "client_id,month,metric" });
  }
  for (const [month, metrics] of Array.from(deletes)) {
    await admin
      .from("engagement_goals")
      .delete()
      .eq("client_id", access.clientId)
      .eq("month", month)
      .in("metric", metrics);
  }

  revalidatePath(`/${clientSlug}`, "layout");
  redirect(`/${clientSlug}/settings?saved=goals#cele`);
}
