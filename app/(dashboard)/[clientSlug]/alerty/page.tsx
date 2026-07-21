import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  CheckCircle2,
  Target,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { detectAnomalies, type Anomaly } from "@/lib/alerts/anomalies";
import { detectBudgetSpikes, type BudgetConfig } from "@/lib/alerts/budget";
import { getPacing, type FlightMetric, type PacingFlight } from "@/lib/alerts/pacing";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAgencyUser, type UserRole } from "@/lib/types";
import { cn, formatMoneyPLN, formatNumberPL } from "@/lib/utils";

export const dynamic = "force-dynamic";

const METRIC_LABEL: Record<FlightMetric, string> = {
  clicks: "Kliknięcia",
  impressions: "Wyświetlenia",
  spend: "Wydatki",
  conversions: "Konwersje",
};

const fmtFlightValue = (metric: FlightMetric, value: number) =>
  metric === "spend" ? formatMoneyPLN(value) : formatNumberPL(value);

const PACING_META: Record<
  PacingFlight["status"],
  { label: string; badge: string; bar: string }
> = {
  behind: {
    label: "Nie dowozi",
    badge: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
    bar: "bg-red-500",
  },
  on_track: {
    label: "Na czas",
    badge: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
  ahead: {
    label: "Przed planem",
    badge: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400",
    bar: "bg-indigo-500",
  },
  upcoming: {
    label: "Zaplanowana",
    badge: "bg-slate-100 text-slate-500 dark:bg-slate-500/10 dark:text-slate-400",
    bar: "bg-slate-400",
  },
  ended: {
    label: "Zakończona",
    badge: "bg-slate-100 text-slate-500 dark:bg-slate-500/10 dark:text-slate-400",
    bar: "bg-slate-400",
  },
};

// Server action: add a campaign flight target (agency only).
async function addFlight(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const campaignValue = String(formData.get("campaign")); // "id|||name"
  const [campaignId, campaignName] = campaignValue.split("|||");
  const metric = String(formData.get("metric")) as FlightMetric;
  const rawTarget = Number(formData.get("target"));
  const startDate = String(formData.get("start"));
  const endDate = String(formData.get("end"));

  if (!campaignId || !metric || !rawTarget || !startDate || !endDate) return;

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
  const flightId = String(formData.get("flight"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();
  await admin
    .from("campaign_flights")
    .delete()
    .eq("id", flightId)
    .eq("client_id", access.clientId);

  revalidatePath(`/${clientSlug}/alerty`);
}

const SEVERITY_META: Record<
  Anomaly["severity"],
  { label: string; ring: string; badge: string }
> = {
  critical: {
    label: "Krytyczny",
    ring: "border-l-red-600",
    badge: "bg-red-600 text-white dark:bg-red-600 dark:text-white",
  },
  high: {
    label: "Wysoki",
    ring: "border-l-red-500",
    badge: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  },
  medium: {
    label: "Średni",
    ring: "border-l-amber-500",
    badge: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  },
};

function AnomalyCard({ a }: { a: Anomaly }) {
  const meta = SEVERITY_META[a.severity];
  const up = a.direction === "up";
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-l-4 border-border bg-card p-4",
        meta.ring
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          meta.badge
        )}
      >
        {up ? (
          <ArrowUpRight className="h-4 w-4" />
        ) : (
          <ArrowDownRight className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium">{a.title}</p>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              meta.badge
            )}
          >
            {meta.label}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{a.description}</p>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
            {a.scopeLabel}
          </span>
          <span>·</span>
          <span>{a.metric}</span>
        </div>
      </div>
    </div>
  );
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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium" title={f.campaignName}>
            {f.campaignName}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {METRIC_LABEL[f.metric]} · cel {fmtFlightValue(f.metric, f.target)} ·{" "}
            {f.startDate} - {f.endDate}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            meta.badge
          )}
        >
          {meta.label}
        </span>
      </div>

      {/* Progress: realized fill + expected (plan) marker */}
      <div className="relative mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", meta.bar)}
          style={{ width: `${Math.max(realizedPct, 1)}%` }}
        />
        {f.status !== "upcoming" ? (
          <span
            className="absolute top-0 h-full w-0.5 bg-foreground/60"
            style={{ left: `${expectedPct}%` }}
            title={`Plan: ${expectedPct.toFixed(0)}%`}
          />
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {fmtFlightValue(f.metric, f.realized)} /{" "}
          {fmtFlightValue(f.metric, f.target)} ({(f.realizedPct * 100).toFixed(0)}%)
        </span>
        <span className="flex items-center gap-3">
          {f.status === "behind" && f.paceRatio !== null ? (
            <span className="font-medium text-red-500">
              {(f.paceRatio * 100).toFixed(0)}% tempa planu
            </span>
          ) : null}
          {f.status !== "ended" && f.status !== "upcoming" ? (
            <span>{Math.max(f.daysLeft, 0)} dni do końca</span>
          ) : null}
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
        </span>
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
  const high = anomalies.filter((a) => a.severity === "high");
  const medium = anomalies.filter((a) => a.severity === "medium");

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

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Alerty - {client.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Automatyczne wykrywanie anomalii: nagłe skoki i spadki z ostatnich 3
          dni względem poprzednich 2 tygodni.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <BellRing className="h-3.5 w-3.5" />
        Skoki wydatków wysyłamy natychmiast na e-mail (i WhatsApp, gdy podłączony)
        - nawet poza godzinami ciszy. Progi ustawisz w Ustawieniach.
      </div>

      {/* Budget spikes - the critical, "kampania przywiozła 500k" case */}
      {spikes.length > 0 ? (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-600">
            <AlertTriangle className="h-4 w-4" />
            Skoki wydatków - pilne ({spikes.length})
          </h2>
          <div className="grid gap-3">
            {spikes.map((a) => (
              <AnomalyCard key={a.id} a={a} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Campaign pacing (flights) */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Target className="h-4 w-4 text-indigo-500" />
          Realizacja kampanii (pacing)
        </h2>

        {pacing.length > 0 ? (
          <div className="grid gap-3">
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
            Brak ustawionych celów. {isAgency ? "Dodaj cel poniżej, aby śledzić czy kampania dowozi w trakcie lotu." : ""}
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
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
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
              <span className="text-muted-foreground">Metryka</span>
              <select
                name="metric"
                required
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="clicks">Kliknięcia</option>
                <option value="impressions">Wyświetlenia</option>
                <option value="spend">Wydatki (zł)</option>
                <option value="conversions">Konwersje</option>
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

      {anomalies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <CheckCircle2 className="mb-3 h-8 w-8 text-emerald-500" />
          <p className="text-sm font-medium">Brak anomalii</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Wyniki trzymają się normy względem ostatnich dwóch tygodni. Sprawdzimy
            ponownie automatycznie.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {high.length > 0 ? (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Wymaga uwagi ({high.length})
              </h2>
              <div className="grid gap-3">
                {high.map((a) => (
                  <AnomalyCard key={a.id} a={a} />
                ))}
              </div>
            </section>
          ) : null}

          {medium.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                Warte obserwacji ({medium.length})
              </h2>
              <div className="grid gap-3">
                {medium.map((a) => (
                  <AnomalyCard key={a.id} a={a} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
