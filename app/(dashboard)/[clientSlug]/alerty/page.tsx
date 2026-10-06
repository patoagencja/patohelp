import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { z } from "zod";

import {
  AlertGroups,
  AlertsAllClear,
  alertsHeadline,
} from "@/components/dashboard/alert-explained";
import { Button } from "@/components/ui/button";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { getCurrentAlerts } from "@/lib/alerts/current";
import { getPacing, type FlightMetric, type PacingFlight } from "@/lib/alerts/pacing";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { dayMonthPL, plPlural } from "@/lib/dashboard/story";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cn, formatNumberPL } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Always group thousands ("7 581 zł"): pl-PL Intl skips grouping for 4-digit
// numbers, which looks inconsistent next to "50 000 zł" in the same line.
function wholePln(minorUnits: number): string {
  const n = Math.round(minorUnits / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n} zł`;
}

/** "10 000 kliknięć", "5 000 zł" - the goal in words, not "Kliknięcia · cel 10000". */
function targetText(metric: FlightMetric, value: number): string {
  switch (metric) {
    case "spend":
      return wholePln(value);
    case "clicks":
      return `${formatNumberPL(value)} ${plPlural(value, "kliknięcie", "kliknięcia", "kliknięć")}`;
    case "impressions":
      return `${formatNumberPL(value)} ${plPlural(value, "wyświetlenie", "wyświetlenia", "wyświetleń")}`;
    case "conversions":
      return `${formatNumberPL(value)} ${plPlural(value, "działanie", "działania", "działań")} na stronie`;
  }
}

// v2: meaning tokens for the pill, striped fills for the bar (same language
// as the overview's "Plan miesiąca" card). Ahead of plan is good news too,
// so it shares the lime fill; the pill words tell the two apart.
const PACING_META: Record<
  PacingFlight["status"],
  { label: string; badge: string; bar: string }
> = {
  behind: {
    label: "Poniżej planu",
    badge: "bg-warning-soft text-warning",
    bar: "bg-warning-fill",
  },
  on_track: {
    label: "Zgodnie z planem",
    badge: "bg-positive-soft text-positive",
    bar: "bg-lime",
  },
  ahead: {
    label: "Szybciej niż plan",
    badge: "bg-accent text-accent-foreground",
    bar: "bg-lime",
  },
  upcoming: {
    label: "Jeszcze nie ruszyła",
    badge: "bg-muted text-muted-foreground",
    bar: "bg-chart-muted",
  },
  ended: {
    label: "Zakończona",
    badge: "bg-muted text-muted-foreground",
    bar: "bg-chart-muted",
  },
};

/** One sentence a manager can repeat: how far along vs how far we should be. */
function pacingSentence(f: PacingFlight): string {
  const done = Math.round(f.realizedPct * 100);
  const plan = Math.round(Math.min(f.expectedPct, 1) * 100);
  switch (f.status) {
    case "behind":
      return `Zrealizowano ${done}% celu, a według planu powinno być już ${plan}%. Sprawdzamy, co hamuje kampanię.`;
    case "ahead":
      return `Zrealizowano ${done}% celu - szybciej niż zakładał plan (${plan}%).`;
    case "on_track":
      return `Zrealizowano ${done}% celu - zgodnie z planem (${plan}%).`;
    case "upcoming":
      return `Kampania rusza ${dayMonthPL(f.startDate)}.`;
    case "ended":
      return `Kampania zakończona - zrealizowano ${done}% celu.`;
  }
}

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

function PacingCard({
  f,
  clientSlug,
  isAgency,
}: {
  f: PacingFlight;
  clientSlug: string;
  isAgency: boolean;
}) {
  const meta = PACING_META[f.status];
  const realizedPct = Math.min(f.realizedPct * 100, 100);
  const expectedPct = Math.min(f.expectedPct * 100, 100);

  return (
    <div className="surface p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-medium leading-snug">{f.campaignName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            Cel: {targetText(f.metric, f.target)} · {dayMonthPL(f.startDate)} -{" "}
            {dayMonthPL(f.endDate)}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
            meta.badge
          )}
        >
          {meta.label}
        </span>
      </div>

      {/* Realized fill + a "plan na dziś" tick, same idea as the budget bar. */}
      <div className="relative mt-4 h-3 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn("bg-stripes block h-full rounded-full", meta.bar)}
          style={{ width: `${Math.max(realizedPct, 1)}%` }}
        />
        {f.status !== "upcoming" && f.status !== "ended" ? (
          <span
            className="absolute top-0 h-full w-[3px] -translate-x-1/2 rounded-full bg-foreground"
            style={{ left: `${expectedPct}%` }}
            title={`Plan na dziś: ${expectedPct.toFixed(0)}%`}
          />
        ) : null}
      </div>

      <p className="mt-3 text-sm leading-snug tabular-nums">{pacingSentence(f)}</p>

      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums">
        <span>
          {targetText(f.metric, f.realized)} z {targetText(f.metric, f.target)}
          {f.status !== "ended" && f.status !== "upcoming"
            ? ` · ${Math.max(f.daysLeft, 0)} ${plPlural(Math.max(f.daysLeft, 0), "dzień", "dni", "dni")} do końca`
            : ""}
        </span>
        {isAgency ? (
          <form action={deleteFlight}>
            <input type="hidden" name="client" value={clientSlug} />
            <input type="hidden" name="flight" value={f.id} />
            <button
              type="submit"
              className="text-muted-foreground hover:text-destructive"
              aria-label="Usuń cel"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
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
      <PageHeader
        title="Alerty"
        description="Co w kampaniach odbiega od normy i co z tym robimy."
      />

      {alerts.length === 0 ? (
        <AlertsAllClear />
      ) : (
        <div className="space-y-6">
          <p className="text-balance text-base font-medium">{alertsHeadline(alerts)}</p>
          <AlertGroups alerts={alerts} />
        </div>
      )}

      {showPacing ? (
        <section className="space-y-4">
          <SectionHeader
            title="Czy kampanie realizują zaplanowane cele"
            description="Pionowa kreska na pasku pokazuje, gdzie według planu powinniśmy być dzisiaj."
          />

          {pacing.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {pacing.map((f) => (
                <PacingCard
                  key={f.id}
                  f={f}
                  clientSlug={params.clientSlug}
                  isAgency={isAgency}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Brak ustawionych celów. Dodaj cel poniżej, aby śledzić, czy kampania
              dowozi w trakcie trwania.
            </p>
          )}

          {isAgency ? (
            <form
              action={addFlight}
              data-present-hide
              data-print-hide
              className="surface grid gap-2 p-4 sm:grid-cols-6 sm:items-end sm:p-5"
            >
              <input type="hidden" name="client" value={params.clientSlug} />
              <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                <span className="text-muted-foreground">Kampania</span>
                <select
                  name="campaign"
                  required
                  className="h-9 min-w-0 rounded-xl border border-transparent bg-muted px-3 text-sm hover:bg-secondary focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-muted"
                >
                  <option value="">Wybierz…</option>
                  {campaignOptions.map((c) => (
                    <option key={c.id} value={`${c.id}|||${c.name}`}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Co mierzymy</span>
                <select
                  name="metric"
                  required
                  className="h-9 rounded-xl border border-transparent bg-muted px-3 text-sm hover:bg-secondary focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-muted"
                >
                  <option value="clicks">Kliknięcia</option>
                  <option value="impressions">Wyświetlenia</option>
                  <option value="spend">Wydatki (zł)</option>
                  <option value="conversions">Działania na stronie</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Cel</span>
                <input
                  type="number"
                  name="target"
                  required
                  min="1"
                  step="any"
                  className="h-9 rounded-xl border border-transparent bg-muted px-3 text-sm hover:bg-secondary focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-muted"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Start</span>
                <input
                  type="date"
                  name="start"
                  required
                  className="h-9 rounded-xl border border-transparent bg-muted px-3 text-sm hover:bg-secondary focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-muted"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Koniec</span>
                <input
                  type="date"
                  name="end"
                  required
                  className="h-9 rounded-xl border border-transparent bg-muted px-3 text-sm hover:bg-secondary focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-muted"
                />
              </label>
              <Button type="submit" size="sm" className="sm:col-span-6 sm:w-fit">
                Dodaj cel kampanii
              </Button>
            </form>
          ) : null}
        </section>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        {isAgency
          ? "Skoki wydatków trafiają natychmiast na e-mail i Telegram - nawet poza godzinami ciszy. Kanały i progi ustawisz w Ustawieniach."
          : "Codziennie porównujemy ostatnie dni z poprzednimi dwoma tygodniami. Pilne sprawy, np. nagły skok wydatków, trafiają do nas od razu."}
      </p>
    </div>
  );
}
