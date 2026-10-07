"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { fetchCampaignAdsets } from "@/app/(dashboard)/[clientSlug]/alerty/adset-actions";
import { SearchCombobox, type ComboOption } from "@/components/dashboard/search-combobox";

/**
 * Campaign + optional ad set (Meta) / ad group (Google) pickers for the
 * "Nowy cel kampanii" form - both searchable (accounts like OLX have
 * hundreds of long campaign names). Once a campaign is picked, the second
 * picker offers only its ad sets - fetched from Meta/Google the moment the
 * campaign is picked, so ad sets that haven't delivered yet are there too
 * (the page only knows ad sets with delivery). Without JS both are native
 * selects and the ad set list holds every known ad set grouped by campaign;
 * the server action rejects an ad set that doesn't belong to the campaign.
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
  /** Polish delivery status from the platform ("aktywny", "wstrzymany"). */
  status?: string | null;
};

const TAG: Record<string, string> = { meta_ads: "Meta", google_ads: "Google" };

function spendMeta(spend?: number): string | null {
  if (spend === undefined) return null;
  if (spend === 0) return "bez wydatków w 60 dni";
  if (spend < 100) return "poniżej 1 zł w 60 dni";
  const zl = Math.round(spend / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${zl} zł w 60 dni`;
}

/** The posted campaign key the server action parses: "id|||name|||provider". */
const campaignKey = (c: CampaignOption) => `${c.id}|||${c.name}|||${c.provider ?? ""}`;

export function GoalTargetFields({
  clientSlug,
  campaignOptions,
  adsetOptions: initialAdsets,
  fieldClass,
  labelClass,
  className,
}: {
  /** For the on-demand ad set fetch; omitted (demo) hides that button. */
  clientSlug?: string;
  campaignOptions: CampaignOption[];
  /** null = ad set level not available yet (migration not run): the field
   *  stays visible but disabled with the reason - an agency user who can't
   *  see it at all has no way to tell "not built" from "not switched on". */
  adsetOptions: AdsetOption[] | null;
  fieldClass: string;
  labelClass: string;
  className?: string;
}) {
  const [campaign, setCampaign] = useState("");
  const [adset, setAdset] = useState("");
  // Ad sets fetched on demand are merged in, so the picker fills without a
  // page reload; null stays null (migration not run).
  const [fetched, setFetched] = useState<AdsetOption[]>([]);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [fetching, startFetch] = useTransition();
  // Campaigns whose full list already came back: no second round trip when
  // the agency flips between campaigns.
  const [loadedFor, setLoadedFor] = useState<Set<string>>(() => new Set());
  // A slow answer for a campaign the user already left must not put its
  // error under the next one.
  const currentRef = useRef("");
  const adsetOptions =
    initialAdsets === null
      ? null
      : [...initialAdsets, ...fetched.filter((f) => !initialAdsets.some((a) => a.id === f.id))];
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
      meta: [spendMeta(a.spend), a.status].filter(Boolean).join(" · ") || null,
      group: campaignName(a.campaignId),
    }));
  const noAdsets = Boolean(campaignId) && adsetCombo.length === 0 && !fetching;

  const loadAdsets = (id: string, provider: string | null | undefined) => {
    if (!clientSlug || !id || !provider || initialAdsets === null) return;
    startFetch(async () => {
      setFetchNote(null);
      const res = await fetchCampaignAdsets({ clientSlug, campaignId: id, provider }).catch(() => ({
        options: [] as AdsetOption[],
        error: "Nie udało się pobrać listy - spróbuj ponownie.",
      }));
      // An empty answer with an error must not hide what the page knew.
      if (res.options.length) {
        setFetched((prev) => [...prev.filter((p) => p.campaignId !== id), ...res.options]);
      }
      if (res.error) {
        if (currentRef.current === id) setFetchNote(res.error);
      } else setLoadedFor((prev) => new Set(prev).add(id));
    });
  };
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
            setFetchNote(null);
            const id = v.split("|||")[0] ?? "";
            currentRef.current = id;
            if (id && !loadedFor.has(id)) {
              loadAdsets(id, campaignOptions.find((c) => c.id === id)?.provider);
            }
          }}
          placeholder="Szukaj kampanii…"
          invalidText="Wybierz kampanię z listy."
          fieldClass={fieldClass}
        />
      </div>

      {!adsetOptions ? (
        <div className={`flex min-w-0 flex-col gap-2 ${className ?? ""}`}>
          <label htmlFor="goal-adset-off" className={labelClass}>
            Zestaw reklam (opcjonalnie)
          </label>
          <select id="goal-adset-off" disabled aria-describedby="goal-adset-off-hint" className={fieldClass}>
            <option>Cała kampania</option>
          </select>
          <span id="goal-adset-off-hint" className="text-xs text-ink-3">
            Cele na poziomie zestawów włączą się po uruchomieniu migracji ALL_RECENT_3.sql w Supabase.
          </span>
        </div>
      ) : (
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
          {campaignId && fetching ? (
            <span className="inline-flex items-center gap-2 text-xs text-ink-3" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Pobieram wszystkie {google ? "grupy reklam" : "zestawy"} tej kampanii…
            </span>
          ) : campaignId && (noAdsets || fetchNote) ? (
            <div id="goal-adset-hint" className="flex flex-col items-start gap-2 text-xs text-ink-3">
              <span>
                {fetchNote ??
                  `Nie mamy jeszcze ${google ? "grup reklam" : "zestawów"} tej kampanii - pobierz je teraz albo zostaw cel na całą kampanię.`}
              </span>
              {clientSlug && selected?.provider ? (
                <button
                  type="button"
                  onClick={() => loadAdsets(campaignId, selected.provider)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-chip px-4 text-sm font-medium text-foreground transition-colors hover:bg-anchor hover:text-anchor-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  {`Pobierz ${google ? "grupy reklam" : "zestawy"} ponownie`}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
