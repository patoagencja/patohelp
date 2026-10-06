"use server";

import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";

import type { AdsetOption } from "@/components/dashboard/goal-target-fields";
import { hasAdsetTable, syncAdsetsForClient } from "@/lib/integrations/adset-sync";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

const input = z.object({
  clientSlug: z.string().min(1).max(64),
  campaignId: z.string().min(1).max(64),
  provider: z.enum(["meta_ads", "google_ads"]),
});

export type CampaignAdsetsResult = { options: AdsetOption[]; error?: string };

/**
 * Pulls one campaign's ad sets / ad groups right now, for the goal form's
 * "Pobierz zestawy tej kampanii". Without it the picker stayed empty until
 * the next cron got to the client - and when the API refused (expired token,
 * missing permission) nobody saw why. Agency only.
 */
export async function fetchCampaignAdsets(raw: unknown): Promise<CampaignAdsetsResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { options: [], error: "Nieprawidłowa kampania." };
  const { clientSlug, campaignId, provider } = parsed.data;

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return { options: [], error: "Brak dostępu." };

  const admin = createAdminClient();
  if (!(await hasAdsetTable(admin))) {
    return { options: [], error: "Najpierw uruchom migrację ALL_RECENT_3.sql w Supabase." };
  }

  // A server action shares the page's time limit: stop between slices well
  // before it, keeping whatever was written.
  const startedAt = Date.now();
  const sync = await syncAdsetsForClient(admin, access.clientId, {
    provider,
    campaignId,
    shouldStop: () => Date.now() - startedAt > 45_000,
  });

  const since = formatInTimeZone(subDays(new Date(), 60), "Europe/Warsaw", "yyyy-MM-dd");
  const { data, error } = await admin
    .from("ads_adset_daily")
    .select("adset_id, adset_name, campaign_id, provider, spend_minor_units, date")
    .eq("client_id", access.clientId)
    .eq("provider", provider)
    .eq("campaign_id", campaignId)
    .gte("date", since)
    .order("date", { ascending: true })
    .limit(5000);
  if (error) return { options: [], error: error.message };

  const byId = new Map<string, AdsetOption & { spend: number }>();
  for (const r of data ?? []) {
    const id = r.adset_id as string;
    const cur = byId.get(id);
    const spend = Number(r.spend_minor_units ?? 0);
    if (cur) {
      cur.spend += spend;
      cur.name = (r.adset_name as string) || cur.name;
    } else {
      byId.set(id, {
        id,
        name: (r.adset_name as string) || id,
        campaignId,
        provider,
        spend,
      });
    }
  }
  const options = Array.from(byId.values()).sort((a, b) => b.spend - a.spend);

  if (options.length === 0) {
    const reason = sync.errors[0];
    return {
      options,
      error: reason
        ? `${provider === "meta_ads" ? "Meta" : "Google"} odrzucił pobieranie: ${reason}`
        : `Ta kampania nie ma ${provider === "google_ads" ? "grup reklam" : "zestawów"} z wyświetleniami w ostatnich 35 dniach.`,
    };
  }
  return { options };
}
