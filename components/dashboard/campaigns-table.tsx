"use client";

import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import type { CampaignRow } from "@/lib/dashboard/metrics";

/**
 * Legacy name kept for any old imports. The combined Meta/Google campaign list
 * now lives in CampaignPositions - plain-language column names, statuses in
 * words, whole-złoty spend and a card layout on phones - so there is a single
 * implementation to keep in sync instead of two diverging tables.
 */
export function CampaignsTable({
  campaigns,
  lang = "pl",
}: {
  campaigns: CampaignRow[];
  lang?: "pl" | "en";
}) {
  return <CampaignPositions campaigns={campaigns} lang={lang} />;
}
