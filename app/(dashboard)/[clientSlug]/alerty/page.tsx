import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AlertsBoard } from "@/components/dashboard/alert-explained";
import {
  CampaignGoals,
  type AdsetOption,
  type CampaignOption,
} from "@/components/dashboard/campaign-goals";
import { GoalTiles } from "@/components/dashboard/goal-tiles";
import { getCurrentAlerts } from "@/lib/alerts/current";
import { FLIGHT_METRICS, getPacing, type FlightMetric } from "@/lib/alerts/pacing";
import { buildGoalTiles } from "@/lib/dashboard/campaign-goals";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { syncCached } from "@/lib/dashboard/sync-cache";
import { listCampaignAdsets } from "@/lib/integrations/adset-sync";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { hasClicksAllColumn } from "@/lib/integrations/link-clicks";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllByDateChunks } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";
// The goal form's on-demand ad set fetch (a server action) runs under this
// page's limit; the platform default is too short for a big account.
export const maxDuration = 60;

// Server actions are public POST endpoints: the form's <select>/<input type=
// date> constraints don't bind a crafted request, so validate here.
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const addFlightSchema = z
  .object({
    campaign: z.string().min(1).max(600), // "id|||name|||provider"
    // Optional ad set (Meta) / ad group (Google) id; "" = whole campaign.
    adset: z.string().max(100).optional(),
    // clicks = link clicks; clicks_all = Meta clicks (all), migration 0034.
    metric: z.enum(FLIGHT_METRICS),
    target: z.coerce.number().finite().positive().max(1e12),
    start: DATE,
    end: DATE,
  })
  .refine((v) => v.start <= v.end);

// Server action: add a campaign flight target (agency only).
async function addFlight(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const parsed = addFlightSchema.safeParse({
    campaign: formData.get("campaign"),
    adset: formData.get("adset") ?? undefined,
    metric: formData.get("metric"),
    target: formData.get("target"),
    start: formData.get("start"),
    end: formData.get("end"),
  });
  if (!parsed.success) return;

  const [campaignId, campaignName, rawProvider] = parsed.data.campaign.split("|||");
  const provider =
    rawProvider === "meta_ads" || rawProvider === "google_ads" ? rawProvider : null;
  const metric: FlightMetric = parsed.data.metric;
  const rawTarget = parsed.data.target;
  const startDate = parsed.data.start;
  const endDate = parsed.data.end;

  if (!campaignId) return;

  // "Wszystkie kliknięcia" needs ads_daily.clicks_all (migration 0034); the
  // form hides it until then, a crafted post must not save an unmeasurable goal.
  const admin = createAdminClient();
  if (metric === "clicks_all" && !(await hasClicksAllColumn(admin, "ads_daily"))) return;

  // Spend is entered in PLN, stored in grosze.
  const targetValue = metric === "spend" ? Math.round(rawTarget * 100) : Math.round(rawTarget);

  // Ad set level: trust our own synced row (or the platform), not the posted
  // name, and make sure the ad set really belongs to the chosen campaign
  // (the no-JS list offers every ad set).
  let adset: { adset_id: string; adset_name: string | null; provider: string } | null = null;
  const adsetId = parsed.data.adset?.trim();
  if (adsetId) {
    const { data: row, error } = await admin
      .from("ads_adset_daily")
      .select("adset_id, adset_name, campaign_id, provider")
      .eq("client_id", access.clientId)
      .eq("adset_id", adsetId)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return;
    if (row) {
      if (row.campaign_id !== campaignId) return;
      adset = {
        adset_id: row.adset_id as string,
        adset_name: (row.adset_name as string | null) ?? null,
        provider: row.provider as string,
      };
    } else {
      // Not delivered yet, so not in our table: the platform's own list of
      // the campaign's ad sets is the proof it belongs there.
      if (!provider) return;
      const listed = await listCampaignAdsets(admin, access.clientId, provider, campaignId);
      const hit = listed.adsets.find((a) => a.id === adsetId);
      if (!hit) return;
      adset = { adset_id: hit.id, adset_name: hit.name, provider };
    }
  }

  await admin.from("campaign_flights").insert({
    client_id: access.clientId,
    campaign_id: campaignId,
    campaign_name: campaignName ?? campaignId,
    provider: adset?.provider ?? provider,
    target_metric: metric,
    target_value: targetValue,
    start_date: startDate,
    end_date: endDate,
    // Only sent for ad set goals, so campaign goals still save on a
    // database without migration 0033.
    ...(adset ? { adset_id: adset.adset_id, adset_name: adset.adset_name } : {}),
  });

  revalidatePath(`/${clientSlug}/alerty`);
}

// Server action: remove a flight (agency only).
async function deleteFlight(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const flightId = z.string().uuid().safeParse(formData.get("flight"));
  if (!flightId.success) return;
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();
  await admin
    .from("campaign_flights")
    .delete()
    .eq("id", flightId.data)
    .eq("client_id", access.clientId);

  revalidatePath(`/${clientSlug}/alerty`);
}

export default async function AlertyPage({
  params,
}: {
  params: { clientSlug: string };
}) {
  // Shared per-request lookups (the layout asks the same). The role decides
  // only what to render and which extras to read, so it no longer sits in
  // front of the alert scans: this used to be seven sequential round trips
  // (user -> client -> role -> caps -> scans -> ecom check -> campaigns).
  const viewerPromise = getViewer();
  // Awaited below; this only stops Node flagging an early rejection.
  viewerPromise.catch(() => {});
  const client = await getClientBySlug(params.clientSlug);

  if (!client) {
    redirect("/login");
  }

  // Campaign options for the goal form (agency only): every campaign with
  // delivery in the last 60 days, biggest recent spend first (the picker is
  // searchable, so long lists are fine). Paginated: PostgREST caps at 1000.
  const campaignOptionsPromise = viewerPromise.then((viewer) =>
    viewer.isAgency ? getCampaignOptions(client.id) : ([] as CampaignOption[])
  );

  // Ad sets / ad groups for the goal form's optional second picker (agency
  // only). null hides the picker: migration 0033 not run yet (no table or
  // no adset columns on campaign_flights) or the read failed.
  const adsetOptionsPromise = viewerPromise.then((viewer) =>
    viewer.isAgency
      ? // null (not migrated / read failed) is never cached: it throws past
        // the cache and is turned back into null here.
        syncCached("goal-adset-options", client.id, [], async () => {
          const options = await getAdsetOptions(client.id);
          if (!options) throw new Error("no ad set options");
          return options;
        }).catch(() => null)
      : null
  );
  // "Wszystkie kliknięcia" goal option: only once migration 0034 has run.
  const clicksAllPromise = viewerPromise.then((viewer) =>
    viewer.isAgency ? hasClicksAllColumn(createAdminClient(), "ads_daily") : false
  );

  // One list, grouped by urgency: the client shouldn't have to know which
  // detector found what. Spend spikes go first within their severity. Shared
  // (per request) with the header bell's count.
  const [alerts, pacing, viewer, campaignOptions, adsetOptions, clicksAllAvailable] =
    await Promise.all([
      getCurrentAlerts(client.id),
      getPacing(client.id),
      viewerPromise,
      campaignOptionsPromise,
      adsetOptionsPromise,
      clicksAllPromise,
    ]);
  const isAgency = viewer.isAgency;
  const goalTiles = buildGoalTiles(
    pacing,
    formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd")
  );

  // Clients only see the goals section once the agency has set goals - an
  // empty "no goals" box is noise for them.
  const showPacing = isAgency || pacing.length > 0;

  return (
    <div className="space-y-8 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      {/* Running goals first: "are we on plan" before "what went wrong". */}
      <GoalTiles goals={goalTiles} />

      <AlertsBoard alerts={alerts} />

      {showPacing ? (
        <CampaignGoals
          pacing={pacing}
          isAgency={isAgency}
          clientSlug={params.clientSlug}
          campaignOptions={campaignOptions}
          adsetOptions={adsetOptions}
          clicksAllAvailable={clicksAllAvailable}
          addAction={addFlight}
          deleteAction={deleteFlight}
        />
      ) : null}

      <p className="max-w-3xl text-[13px] leading-relaxed text-ink-3">
        {isAgency
          ? "Skoki wydatków trafiają natychmiast na e-mail i Telegram - nawet poza godzinami ciszy. Kanały i progi ustawisz w Ustawieniach."
          : "Codziennie porównujemy ostatnie dni z poprzednimi dwoma tygodniami. Pilne sprawy, np. nagły skok wydatków, trafiają do nas od razu."}
      </p>
    </div>
  );
}

/**
 * Campaign options for the goal form: every campaign with delivery in the
 * last 60 days, biggest recent spend first (the picker is searchable, so
 * long lists are fine). Shared per sync stamp; service-role read of a client
 * the page resolved through RLS (agency viewers only reach this).
 */
function getCampaignOptions(clientId: string): Promise<CampaignOption[]> {
  return syncCached("goal-campaign-options", clientId, [], async () => {
    const since = formatInTimeZone(subDays(new Date(), 60), "Europe/Warsaw", "yyyy-MM-dd");
    const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
    const admin = createAdminClient();
    // Two-week chunks side by side, oldest first (same rows and order as one
    // paged read); the last chunk stays open-ended like the original read.
    const campRows = await fetchAllByDateChunks<Record<string, unknown>>(
      since,
      today,
      14,
      (s, e) => (from, to) => {
        const q = admin
          .from("ads_daily")
          .select("campaign_id, campaign_name, provider, spend_minor_units, date")
          .eq("client_id", clientId)
          .gte("date", s);
        return (e < today ? q.lte("date", e) : q)
          .order("date", { ascending: true })
          .order("provider", { ascending: true })
          .order("campaign_id", { ascending: true })
          .range(from, to);
      }
    ).catch(() => [] as Record<string, unknown>[]);
    const byId = new Map<string, { name: string; provider: string | null; spend: number }>();
    for (const r of campRows) {
      const id = r.campaign_id as string;
      const c = byId.get(id) ?? { name: id, provider: null, spend: 0 };
      // Oldest first: the latest name wins (campaigns get renamed).
      c.name = (r.campaign_name as string) || c.name;
      c.provider = (r.provider as string | null) ?? c.provider;
      c.spend += Number(r.spend_minor_units ?? 0);
      byId.set(id, c);
    }
    return Array.from(byId.entries())
      .sort((a, b) => b[1].spend - a[1].spend)
      .slice(0, 1500)
      .map(([id, v]) => ({ id, name: v.name, provider: v.provider, spend: v.spend }));
  });
}

/**
 * Ad sets (Meta) / ad groups (Google) with delivery in the last 60 days,
 * distinct, biggest spend first. null when ad set goals aren't available on
 * this database yet (migration 0033) - the form then stays campaign-level.
 */
async function getAdsetOptions(clientId: string): Promise<AdsetOption[] | null> {
  const admin = createAdminClient();
  const probe = await admin.from("campaign_flights").select("adset_id").limit(1);
  if (probe.error) return null;
  const since = formatInTimeZone(subDays(new Date(), 60), "Europe/Warsaw", "yyyy-MM-dd");
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  try {
    // Two-week chunks side by side, oldest first (same rows and order as one
    // paged read); the last chunk stays open-ended like the original read.
    const rows = await fetchAllByDateChunks<Record<string, unknown>>(
      since,
      today,
      14,
      (s, e) => (from, to) => {
        const q = admin
          .from("ads_adset_daily")
          .select("provider, campaign_id, adset_id, adset_name, spend_minor_units, date")
          .eq("client_id", clientId)
          .gte("date", s);
        return (e < today ? q.lte("date", e) : q)
          .order("date", { ascending: true })
          .order("provider", { ascending: true })
          .order("adset_id", { ascending: true })
          .range(from, to);
      }
    );
    const byId = new Map<string, AdsetOption & { spend: number }>();
    for (const r of rows) {
      const id = r.adset_id as string;
      const cur = byId.get(id);
      if (!cur) {
        byId.set(id, {
          id,
          name: (r.adset_name as string) || id,
          campaignId: (r.campaign_id as string) ?? "",
          provider: r.provider as string,
          spend: Number(r.spend_minor_units ?? 0),
        });
        continue;
      }
      cur.spend += Number(r.spend_minor_units ?? 0);
      // Rows come oldest first: the latest name/campaign wins (renames).
      cur.name = (r.adset_name as string) || cur.name;
      cur.campaignId = (r.campaign_id as string) ?? cur.campaignId;
    }
    return Array.from(byId.values())
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 1500)
      .map(({ id, name, campaignId, provider, spend }) => ({ id, name, campaignId, provider, spend }));
  } catch (err) {
    console.error("[alerty] ad set options failed", (err as Error).message);
    return null;
  }
}
