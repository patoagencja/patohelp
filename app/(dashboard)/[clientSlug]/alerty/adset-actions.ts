"use server";

import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";

import type { AdsetOption } from "@/components/dashboard/goal-target-fields";
import { hasAdsetTable, listCampaignAdsets } from "@/lib/integrations/adset-sync";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

const input = z.object({
  clientSlug: z.string().min(1).max(64),
  campaignId: z.string().min(1).max(64),
  provider: z.enum(["meta_ads", "google_ads"]),
});

export type CampaignAdsetsResult = { options: AdsetOption[]; error?: string };

/**
 * One campaign's ad sets / ad groups for the goal form, fetched when the
 * campaign is picked. The list comes from the platform's structure, so ad
 * sets that never delivered (new, scheduled, paused early) show up too - the
 * picker used to know only ad sets with delivery rows, and a fresh OLX
 * campaign showed a handful of its ad sets. Spend comes from our own table.
 * Agency only.
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

  const since = formatInTimeZone(subDays(new Date(), 60), "Europe/Warsaw", "yyyy-MM-dd");
  const [listed, delivery] = await Promise.all([
    listCampaignAdsets(admin, access.clientId, provider, campaignId),
    admin
      .from("ads_adset_daily")
      .select("adset_id, adset_name, spend_minor_units")
      .eq("client_id", access.clientId)
      .eq("provider", provider)
      .eq("campaign_id", campaignId)
      .gte("date", since)
      .order("date", { ascending: true })
      .limit(5000),
  ]);

  const byId = new Map<string, AdsetOption & { spend: number }>();
  for (const r of delivery.data ?? []) {
    const id = r.adset_id as string;
    const cur = byId.get(id);
    const spend = Number(r.spend_minor_units ?? 0);
    if (cur) {
      cur.spend += spend;
      cur.name = (r.adset_name as string) || cur.name;
    } else {
      byId.set(id, { id, name: (r.adset_name as string) || id, campaignId, provider, spend });
    }
  }
  for (const a of listed.adsets) {
    const cur = byId.get(a.id);
    if (cur) {
      // The platform has the current name (renames) and status.
      cur.name = a.name || cur.name;
      cur.status = a.status;
    } else {
      byId.set(a.id, { id: a.id, name: a.name, campaignId, provider, spend: 0, status: a.status });
    }
  }
  const options = Array.from(byId.values()).sort(
    (a, b) => b.spend - a.spend || a.name.localeCompare(b.name, "pl")
  );

  const platform = provider === "meta_ads" ? "Meta" : "Google";
  const kind = provider === "google_ads" ? "grup reklam" : "zestawów";
  if (listed.errors.length && listed.adsets.length === 0) {
    return {
      options,
      error: options.length
        ? `${platform} nie oddał pełnej listy (${listed.errors[0]}) - widać tylko ${kind} z wyświetleniami.`
        : `${platform} odrzucił pobieranie: ${listed.errors[0]}`,
    };
  }
  if (options.length === 0) {
    return { options, error: `Ta kampania nie ma ${kind}.` };
  }
  return { options };
}
