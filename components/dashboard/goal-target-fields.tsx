"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Campaign + optional ad set (Meta) / ad group (Google) pickers for the
 * "Nowy cel kampanii" form. The page hands over every recent ad set; once a
 * campaign is picked, only its ad sets are offered. Without JS (or before
 * hydration) the ad set list shows them all, grouped by campaign - the
 * server action rejects an ad set that doesn't belong to the campaign.
 */

export type CampaignOption = { id: string; name: string; provider?: string | null };
export type AdsetOption = {
  id: string;
  name: string;
  campaignId: string;
  provider: string;
};

export function GoalTargetFields({
  campaignOptions,
  adsetOptions,
  fieldClass,
  labelClass,
  className,
}: {
  campaignOptions: CampaignOption[];
  /** null = ad set level not available yet (migration not run): hide it. */
  adsetOptions: AdsetOption[] | null;
  fieldClass: string;
  labelClass: string;
  className?: string;
}) {
  const [campaign, setCampaign] = useState("");
  const [adset, setAdset] = useState("");
  const selected = campaignOptions.find((c) => c.id === campaign);
  const google = selected?.provider === "google_ads";

  const forCampaign = campaign ? (adsetOptions ?? []).filter((a) => a.campaignId === campaign) : [];
  // No campaign yet: every ad set, grouped (also the no-JS rendering).
  const groups = new Map<string, AdsetOption[]>();
  if (!campaign) {
    for (const a of adsetOptions ?? []) {
      const list = groups.get(a.campaignId) ?? [];
      list.push(a);
      groups.set(a.campaignId, list);
    }
  }
  const campaignName = (id: string) => campaignOptions.find((c) => c.id === id)?.name ?? id;
  const noAdsets = Boolean(campaign) && forCampaign.length === 0;

  return (
    <>
      <label className={cn("flex min-w-0 flex-col gap-2", className)}>
        <span className={labelClass}>Kampania</span>
        <select
          name="campaign"
          required
          className={fieldClass}
          value={campaign ? `${campaign}|||${selected?.name ?? ""}|||${selected?.provider ?? ""}` : ""}
          onChange={(e) => {
            setCampaign(e.target.value.split("|||")[0] ?? "");
            setAdset("");
          }}
        >
          <option value="">Wybierz…</option>
          {campaignOptions.map((c) => (
            <option key={c.id} value={`${c.id}|||${c.name}|||${c.provider ?? ""}`}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {adsetOptions ? (
        <label className={cn("flex min-w-0 flex-col gap-2", className)}>
          <span className={labelClass}>
            {google ? "Grupa reklam (opcjonalnie)" : "Zestaw reklam (opcjonalnie)"}
          </span>
          <select
            name="adset"
            className={fieldClass}
            value={adset}
            onChange={(e) => setAdset(e.target.value)}
            disabled={noAdsets}
            aria-describedby={noAdsets ? "adset-hint" : undefined}
          >
            <option value="">Cała kampania</option>
            {campaign
              ? forCampaign.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))
              : Array.from(groups.entries()).map(([cid, list]) => (
                  <optgroup key={cid} label={campaignName(cid)}>
                    {list.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </select>
          {noAdsets ? (
            <span id="adset-hint" className="text-xs text-ink-3">
              Brak {google ? "grup" : "zestawów"} z wynikami w ostatnich 60 dniach - cel obejmie całą kampanię.
            </span>
          ) : null}
        </label>
      ) : null}
    </>
  );
}
