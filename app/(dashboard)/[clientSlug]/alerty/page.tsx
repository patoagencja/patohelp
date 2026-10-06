import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AlertsBoard } from "@/components/dashboard/alert-explained";
import { CampaignGoals } from "@/components/dashboard/campaign-goals";
import { getCurrentAlerts } from "@/lib/alerts/current";
import { getPacing, type FlightMetric } from "@/lib/alerts/pacing";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Server actions are public POST endpoints: the form's <select>/<input type=
// date> constraints don't bind a crafted request, so validate here.
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const addFlightSchema = z
  .object({
    campaign: z.string().min(1).max(600), // "id|||name"
    metric: z.enum(["spend", "clicks", "impressions", "conversions"]),
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
    metric: formData.get("metric"),
    target: formData.get("target"),
    start: formData.get("start"),
    end: formData.get("end"),
  });
  if (!parsed.success) return;

  const [campaignId, campaignName] = parsed.data.campaign.split("|||");
  const metric: FlightMetric = parsed.data.metric;
  const rawTarget = parsed.data.target;
  const startDate = parsed.data.start;
  const endDate = parsed.data.end;

  if (!campaignId) return;

  // Spend is entered in PLN, stored in grosze.
  const targetValue = metric === "spend" ? Math.round(rawTarget * 100) : Math.round(rawTarget);

  const admin = createAdminClient();
  await admin.from("campaign_flights").insert({
    client_id: access.clientId,
    campaign_id: campaignId,
    campaign_name: campaignName ?? campaignId,
    target_metric: metric,
    target_value: targetValue,
    start_date: startDate,
    end_date: endDate,
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

  // Campaign options for the flight form (agency only; top spenders). Needs
  // the role, not the alerts, so it starts as soon as the role is known.
  const campaignOptionsPromise = viewerPromise.then(async (viewer) => {
    if (!viewer.isAgency) return [] as Array<{ id: string; name: string }>;
    const { data: campRows } = await createClient()
      .from("ads_daily")
      .select("campaign_id, campaign_name, spend_minor_units")
      .eq("client_id", client.id)
      .order("spend_minor_units", { ascending: false })
      .limit(2000);
    const byId = new Map<string, { name: string; spend: number }>();
    for (const r of campRows ?? []) {
      const id = r.campaign_id as string;
      const c = byId.get(id) ?? {
        name: (r.campaign_name as string) || id,
        spend: 0,
      };
      c.spend += Number(r.spend_minor_units);
      byId.set(id, c);
    }
    return Array.from(byId.entries())
      .sort((a, b) => b[1].spend - a[1].spend)
      .slice(0, 150)
      .map(([id, v]) => ({ id, name: v.name }));
  });

  // One list, grouped by urgency: the client shouldn't have to know which
  // detector found what. Spend spikes go first within their severity. Shared
  // (per request) with the header bell's count.
  const [alerts, pacing, viewer, campaignOptions] = await Promise.all([
    getCurrentAlerts(client.id),
    getPacing(client.id),
    viewerPromise,
    campaignOptionsPromise,
  ]);
  const isAgency = viewer.isAgency;

  // Clients only see the goals section once the agency has set goals - an
  // empty "no goals" box is noise for them.
  const showPacing = isAgency || pacing.length > 0;

  return (
    <div className="space-y-8 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      <AlertsBoard alerts={alerts} />

      {showPacing ? (
        <CampaignGoals
          pacing={pacing}
          isAgency={isAgency}
          clientSlug={params.clientSlug}
          campaignOptions={campaignOptions}
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
