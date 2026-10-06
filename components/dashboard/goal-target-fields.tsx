"use client";

import { useState } from "react";

import { SearchCombobox, type ComboOption } from "@/components/dashboard/search-combobox";

/**
 * Campaign + optional ad set (Meta) / ad group (Google) pickers for the
 * "Nowy cel kampanii" form - both searchable (accounts like OLX have
 * hundreds of long campaign names). Once a campaign is picked, the second
 * picker offers only its ad sets. Without JS both are native selects and the
 * ad set list holds every ad set grouped by campaign; the server action
 * rejects an ad set that doesn't belong to the chosen campaign.
 */

export type CampaignOption = {
  id: string;
  name: string;
  provider?: string | null;
  /** Recent spend in grosze (sort + hint). */
  spend?: number;
};
export type AdsetOption = {
  id: string;
  name: string;
  campaignId: string;
  provider: string;
  spend?: number;
};

const TAG: Record<string, string> = { meta_ads: "Meta", google_ads: "Google" };

function spendMeta(spend?: number): string | null {
  if (spend === undefined) return null;
  const zl = Math.round(spend / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${zl} zł w 60 dni`;
}

/** The posted campaign key the server action parses: "id|||name|||provider". */
const campaignKey = (c: CampaignOption) => `${c.id}|||${c.name}|||${c.provider ?? ""}`;

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
  const campaignId = campaign.split("|||")[0] ?? "";
  const selected = campaignOptions.find((c) => c.id === campaignId);
  const google = selected?.provider === "google_ads";
  const campaignName = (id: string) => campaignOptions.find((c) => c.id === id)?.name ?? id;

  const campaignCombo: ComboOption[] = campaignOptions.map((c) => ({
    value: campaignKey(c),
    label: c.name,
    tag: c.provider ? TAG[c.provider] : null,
    meta: spendMeta(c.spend),
  }));
  // Picked campaign: its ad sets only. Nothing picked (and the no-JS
  // select): all of them, grouped by campaign.
  const adsetCombo: ComboOption[] = (adsetOptions ?? [])
    .filter((a) => !campaignId || a.campaignId === campaignId)
    .map((a) => ({
      value: a.id,
      label: a.name,
      tag: TAG[a.provider] ?? null,
      meta: spendMeta(a.spend),
      group: campaignName(a.campaignId),
    }));
  const noAdsets = Boolean(campaignId) && adsetCombo.length === 0;
  const adsetLabel = google ? "Grupa reklam (opcjonalnie)" : "Zestaw reklam (opcjonalnie)";

  return (
    <>
      <div className={`flex min-w-0 flex-col gap-2 ${className ?? ""}`}>
        <label htmlFor="goal-campaign" className={labelClass}>
          Kampania
        </label>
        <SearchCombobox
          id="goal-campaign"
          name="campaign"
          required
          options={campaignCombo}
          value={campaign}
          onChange={(v) => {
            setCampaign(v);
            setAdset("");
          }}
          placeholder="Szukaj kampanii…"
          invalidText="Wybierz kampanię z listy."
          fieldClass={fieldClass}
        />
      </div>

      {adsetOptions ? (
        <div className={`flex min-w-0 flex-col gap-2 ${className ?? ""}`}>
          <label htmlFor="goal-adset" className={labelClass}>
            {adsetLabel}
          </label>
          <SearchCombobox
            id="goal-adset"
            name="adset"
            options={adsetCombo}
            value={adset}
            onChange={setAdset}
            disabled={!campaignId || noAdsets}
            emptyOption="Cała kampania"
            placeholder={campaignId ? "Cała kampania - lub szukaj…" : "Najpierw wybierz kampanię"}
            fieldClass={fieldClass}
            describedBy={noAdsets ? "goal-adset-hint" : undefined}
          />
          {noAdsets ? (
            <span id="goal-adset-hint" className="text-xs text-ink-3">
              Brak {google ? "grup" : "zestawów"} z wynikami w ostatnich 60 dniach - cel obejmie całą kampanię.
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
