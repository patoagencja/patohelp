import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BellRing, Target, Trash2 } from "lucide-react";
import { z } from "zod";

import {
  AlertGroups,
  AlertsAllClear,
  alertsHeadline,
} from "@/components/dashboard/alert-explained";
import { Button } from "@/components/ui/button";
import { detectAnomalies, type Anomaly } from "@/lib/alerts/anomalies";
import { detectBudgetSpikes, type BudgetConfig } from "@/lib/alerts/budget";
import { getPacing, type FlightMetric, type PacingFlight } from "@/lib/alerts/pacing";
import { dayMonthPL, plPlural } from "@/lib/dashboard/story";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAgencyUser, type UserRole } from "@/lib/types";
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

const PACING_META: Record<
  PacingFlight["status"],
  { label: string; badge: string; bar: string }
> = {
  behind: {
    label: "Poniżej planu",
    badge: "bg-red-500/10 text-red-700 dark:text-red-400",
    bar: "bg-red-500",
  },
  on_track: {
    label: "Zgodnie z planem",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
  ahead: {
    label: "Szybciej niż plan",
    badge: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    bar: "bg-sky-500",
  },
  upcoming: {
    label: "Jeszcze nie ruszyła",
    badge: "bg-muted text-muted-foreground",
    bar: "bg-slate-400",
  },
  ended: {
    label: "Zakończona",
    badge: "bg-muted text-muted-foreground",
    bar: "bg-slate-400",
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
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
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
      <div className="relative mt-4 h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", meta.bar)}
          style={{ width: `${Math.max(realizedPct, 1)}%` }}
        />
        {f.status !== "upcoming" && f.status !== "ended" ? (
          <span
            className="absolute top-0 h-full w-0.5 bg-foreground/60"
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
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", params.clientSlug)
    .single();

  if (!client) {
    redirect("/login");
  }

  const { data: profile } = user
    ? await supabase.from("users").select("role").eq("id", user.id).single()
    : { data: null };
  const isAgency = profile ? isAgencyUser(profile.role as UserRole) : false;

  // Budget-spike thresholds are configured per client in settings.
  const { data: notif } = await createAdminClient()
    .from("notification_settings")
    .select(
      "daily_spend_cap_minor_units, account_daily_spend_cap_minor_units, spike_multiplier"
    )
    .eq("client_id", client.id)
    .maybeSingle();
  const budgetConfig: BudgetConfig = {
    campaignCap: (notif?.daily_spend_cap_minor_units as number | null) ?? null,
    accountCap:
      (notif?.account_daily_spend_cap_minor_units as number | null) ?? null,
    multiplier:
      notif?.spike_multiplier && Number(notif.spike_multiplier) > 0
        ? Number(notif.spike_multiplier)
        : 3,
  };

  const [spikes, anomalies, pacing] = await Promise.all([
    detectBudgetSpikes(client.id, undefined, budgetConfig),
    detectAnomalies(client.id),
    getPacing(client.id),
  ]);
  // One list, grouped by urgency: the client shouldn't have to know which
  // detector found what. Spend spikes go first within their severity.
  const alerts: Anomaly[] = [...spikes, ...anomalies];

  // Campaign options for the flight form (top spenders, last 30 days).
  let campaignOptions: Array<{ id: string; name: string }> = [];
  if (isAgency) {
    const { data: campRows } = await supabase
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
    campaignOptions = Array.from(byId.entries())
      .sort((a, b) => b[1].spend - a[1].spend)
      .slice(0, 150)
      .map(([id, v]) => ({ id, name: v.name }));
  }

  // Clients only see the goals section once the agency has set goals - an
  // empty "no goals" box is noise for them.
  const showPacing = isAgency || pacing.length > 0;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerty</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Co w kampaniach odbiega od normy - i co z tym robimy. Codziennie
          porównujemy ostatnie dni z poprzednimi dwoma tygodniami.
        </p>
      </div>

      {alerts.length === 0 ? (
        <AlertsAllClear />
      ) : (
        <>
          <p className="text-balance text-base font-medium">{alertsHeadline(alerts)}</p>
          <AlertGroups alerts={alerts} />
        </>
      )}

      {showPacing ? (
        <section>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Target className="h-4 w-4 text-sky-500" aria-hidden />
            Czy kampanie realizują zaplanowane cele
          </h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            Pionowa kreska na pasku pokazuje, gdzie według planu powinniśmy być dzisiaj.
          </p>

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
              className="mt-4 grid gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-6 sm:items-end"
            >
              <input type="hidden" name="client" value={params.clientSlug} />
              <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                <span className="text-muted-foreground">Kampania</span>
                <select
                  name="campaign"
                  required
                  className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
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
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
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
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Start</span>
                <input
                  type="date"
                  name="start"
                  required
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Koniec</span>
                <input
                  type="date"
                  name="end"
                  required
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                />
              </label>
              <Button type="submit" size="sm" className="sm:col-span-6 sm:w-fit">
                Dodaj cel kampanii
              </Button>
            </form>
          ) : null}
        </section>
      ) : null}

      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {isAgency
            ? "Skoki wydatków trafiają natychmiast na e-mail i Telegram - nawet poza godzinami ciszy. Kanały i progi ustawisz w Ustawieniach."
            : "Pilne sprawy, np. nagły skok wydatków, wykrywamy automatycznie - powiadomienie trafia do nas od razu."}
        </span>
      </div>
    </div>
  );
}
