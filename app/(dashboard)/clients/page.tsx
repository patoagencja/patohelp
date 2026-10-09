import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  LayoutDashboard,
  Plus,
} from "lucide-react";

import {
  AgencyTodoChipAsync,
  AgencyTodoChipSkeleton,
  AgencyTodoSection,
  AgencyTodoSkeleton,
  CLIENT_AVATAR,
} from "@/components/dashboard/agency-todo";
import { RECONNECT_PATH } from "@/components/dashboard/integration-health-banner";
import { getAgencyTodo } from "@/lib/agency/todo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sky } from "@/components/ui/sky";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { readAlertAdsWindow } from "@/lib/alerts/ads-window";
import { detectAnomalies } from "@/lib/alerts/anomalies";
import { detectBudgetSpikes } from "@/lib/alerts/budget";
import {
  AD_PROVIDERS,
  getExpiringTokens,
  getUnhealthyIntegrations,
  type AdProviderKey,
  type ExpiringToken,
  type ProviderHealth,
} from "@/lib/dashboard/integration-health";
import { getSpendByClientOnDate } from "@/lib/dashboard/ads-totals";
import { syncCached } from "@/lib/dashboard/sync-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { plPlural } from "@/lib/dashboard/story";
import { isAgencyUser, type UserRole } from "@/lib/types";
import { cn, formatMoneyPLN } from "@/lib/utils";

import { BrandingFillButton } from "./branding-fill-button";
import { ConnectionsPanel, type UnselectedIntegration } from "./connections-panel";

export const dynamic = "force-dynamic";
// "Uzupełnij brandingi" fetches several client websites in one Server Action.
export const maxDuration = 120;

// Sign out and return to login.
async function signOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// Create a new client (admin only). Slug is normalised to a URL-safe form.
async function addClient(formData: FormData) {
  "use server";
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || (profile.role as UserRole) !== "admin") return;

  const name = String(formData.get("name") ?? "").trim();
  // Tolerate pasting a URL: strip protocol/www/path and the domain suffix so
  // "https://www.olx.pl" becomes "olx", not "https-www-olx-pl".
  const slug = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(".")[0]
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name || !slug) return;

  const admin = createAdminClient();
  const { error } = await admin.from("clients").insert({ name, slug });
  if (error) {
    redirect(`/clients?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/${slug}/settings`);
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: {
    error?: string;
    /** Set by an OAuth callback started from the Połączenia panel. */
    reconnected?: string;
    fixed?: string;
    conn_error?: string;
  };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role, client_id")
    .eq("id", user.id)
    .single();

  // Client users don't get a picker — send them to their own dashboard.
  if (!profile || !isAgencyUser(profile.role as UserRole)) {
    if (profile?.client_id) {
      const { data: c } = await supabase
        .from("clients")
        .select("slug")
        .eq("id", profile.client_id)
        .single();
      if (c?.slug) redirect(`/${c.slug}`);
    }
    redirect("/login");
  }

  const isAdmin = (profile.role as UserRole) === "admin";
  const admin = createAdminClient();
  const { data: clients } = await admin
    .from("clients")
    .select("id, slug, name")
    .order("name", { ascending: true });

  const clientList = clients ?? [];

  // Yesterday's total spend per client (one paginated query, summed in JS).
  const yesterday = formatInTimeZone(
    subDays(new Date(), 1),
    "Europe/Warsaw",
    "yyyy-MM-dd"
  );
  // Per-day totals view (one row per client and platform; raw-row fallback
  // with a total order - client_id alone could repeat/skip rows across pages).
  // Started now, awaited after the per-client checks: independent reads.
  const spendPromise = getSpendByClientOnDate(admin, yesterday);
  // Awaited below; this only stops Node flagging an early rejection.
  spendPromise.catch(() => {});

  // Ad integrations with nothing ticked: connected, yet every sync pulls
  // nothing (DRE sat at "0 of 46 selected" after a token change). Agency
  // viewer verified above; account lists only, never credentials. `.then`
  // starts the request now, alongside the per-client checks; a failed read
  // just hides the list instead of breaking the page.
  const selectionPromise = admin
    .from("integrations")
    .select("client_id, provider, account_ids")
    .in("provider", [...AD_PROVIDERS])
    .then(
      (r) => r.data ?? [],
      () => []
    );

  // Live CRITICAL alert count per client (spend spikes + anomalies), in
  // parallel. Only critical severity is surfaced on the picker.
  const alertCounts = new Map<string, number>();
  // Integration health per client: the one place to see every broken or
  // soon-to-expire connection across the agency, with a one-click fix.
  const healthByClient = new Map<
    string,
    { down: ProviderHealth[]; expiring: ExpiringToken[] }
  >();
  await Promise.all(
    clientList.map(async (c) => {
      // Health and the alert scan are independent: side by side.
      const healthPromise = Promise.all([
        getUnhealthyIntegrations(c.id as string).then((hs) => hs.filter((h) => !h.reconnected)),
        getExpiringTokens(c.id as string),
      ]).then(([down, expiring]) => {
        healthByClient.set(c.id as string, { down, expiring });
      });
      try {
        // Default caps (as before), three weeks of rows per client: shared
        // per sync stamp so revisiting the picker doesn't rescan everyone.
        // Agency viewer verified above; service-role read of listed clients.
        const all = await syncCached("alerts-default-caps", c.id as string, [], async () => {
          // One read of the three weeks both detectors look at.
          const shared = readAlertAdsWindow(admin, c.id as string);
          const [spikes, anomalies] = await Promise.all([
            detectBudgetSpikes(c.id as string, admin, undefined, shared),
            detectAnomalies(c.id as string, admin, shared),
          ]);
          return [...spikes, ...anomalies];
        });
        const critical = all.filter((a) => a.severity === "critical").length;
        alertCounts.set(c.id as string, critical);
      } catch {
        alertCounts.set(c.id as string, 0);
      }
      await healthPromise;
    })
  );

  const spendByClient = await spendPromise;

  const selectionRows = await selectionPromise;
  // In client-name order, so the panel lists them the way the tiles do.
  const nothingSelected: UnselectedIntegration[] = clientList.flatMap((c) =>
    selectionRows
      .filter((row) => row.client_id === c.id)
      .flatMap((row) => {
        const accounts = Array.isArray(row.account_ids)
          ? (row.account_ids as Array<{ selected?: unknown } | null>)
          : [];
        const selected = accounts.filter((a) => a?.selected === true).length;
        if (accounts.length === 0 || selected > 0) return [];
        return [
          {
            slug: c.slug as string,
            name: c.name as string,
            provider: row.provider as AdProviderKey,
            total: accounts.length,
          },
        ];
      })
  );

  // Not awaited: the to-do checks stream in under Suspense, so the tiles
  // (already computed above) render without waiting for them. Health and
  // critical counts are handed over rather than refetched.
  const todo = getAgencyTodo(
    clientList.map((c) => ({
      id: c.id as string,
      slug: c.slug as string,
      name: c.name as string,
      health: healthByClient.get(c.id as string),
      criticalAlerts: alertCounts.get(c.id as string) ?? 0,
    }))
  );
  const clientSlugs = clientList.map((c) => c.slug as string);

  const totalYesterday = [...spendByClient.values()].reduce((a, b) => a + b, 0);
  const totalAlerts = [...alertCounts.values()].reduce((a, b) => a + b, 0);
  const totalBroken = [...healthByClient.values()].reduce((a, h) => a + h.down.length, 0);
  const totalExpiring = [...healthByClient.values()].reduce(
    (a, h) => a + h.expiring.length,
    0
  );

  return (
    // relative + isolate: the pastel sky sits under the content, above the
    // wrapper's own background (same as the dashboard shell).
    <div className="relative isolate min-h-screen bg-background">
      <Sky />
      <div className="pointer-events-none sticky top-0 z-30 mx-auto w-full max-w-6xl px-3 pt-2.5 sm:px-6 md:pt-3.5 lg:px-8 print:hidden">
      <header
        data-chrome-header
        className="glass glass-blur pointer-events-auto rounded-full"
      >
        <div className="flex min-h-[62px] w-full items-center justify-between gap-3 py-[7px] pl-4 pr-2 md:min-h-16 md:pl-[18px]">
          <div className="flex items-center gap-2.5">
            {/* Agency mark: the anchor tile with the lime dot, same "selected"
                language as the client dashboard's sidebar pill. */}
            <span className="relative flex h-8 w-8 items-center justify-center rounded-[0.6rem] bg-anchor text-anchor-foreground">
              <LayoutDashboard className="h-4 w-4" aria-hidden />
              <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-anchor-dot ring-2 ring-background" />
            </span>
            <span className="font-semibold tracking-[-0.02em]">Pato</span>
            <span className="kick hidden sm:inline">· Agencja</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-3 sm:inline">
              {user.email}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="chip" size="pill">
                Wyloguj
              </Button>
            </form>
          </div>
        </div>
      </header>
      </div>

      <main className="mx-auto max-w-6xl space-y-10 px-4 pb-16 pt-6 sm:px-6 md:pt-8 lg:px-8">
        <PageHeader
          eyebrow={<span className="kick">Panel agencji · {clientList.length} klientów</span>}
          title="Wybierz klienta"
          description="Każdy klient ma własny panel, raporty i alerty - wybierz, żeby do niego wejść."
        />

        <Suspense fallback={<AgencyTodoSkeleton />}>
          <AgencyTodoSection todo={todo} clientSlugs={clientSlugs} />
        </Suspense>

        {/* Summary strip across all clients */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-[22px]">
            <p className="kick">Klienci</p>
            <p className="mt-3 text-[2.5rem] font-light leading-none tracking-[-0.05em] tabular-nums">{clientList.length}</p>
          </Card>
          <Card className="p-[22px]">
            <p className="kick">Wydatki wczoraj · łącznie</p>
            <p className="mt-3 text-[2.5rem] font-light leading-none tracking-[-0.05em] tabular-nums">
              {formatMoneyPLN(totalYesterday)}
            </p>
          </Card>
          <Card className="p-[22px]">
            <p className="kick flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 rounded-full ring-[3px]",
                  totalAlerts > 0 ? "bg-negative ring-negative-soft" : "bg-lime ring-lime-soft"
                )}
              />
              Krytyczne alerty
            </p>
            <p
              className={cn(
                "mt-3 text-[2.5rem] font-light leading-none tracking-[-0.05em] tabular-nums",
                totalAlerts > 0 && "text-negative"
              )}
            >
              {totalAlerts}
            </p>
          </Card>
          <Card className="p-[22px]">
            <p className="kick flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 rounded-full ring-[3px]",
                  totalBroken > 0 ? "bg-warning-fill ring-warning-soft" : "bg-lime ring-lime-soft"
                )}
              />
              Połączenia
            </p>
            <p
              className={cn(
                "mt-3 text-[2.5rem] font-light leading-none tracking-[-0.05em] tabular-nums",
                totalBroken > 0 && "text-warning"
              )}
            >
              {totalBroken > 0 ? `${totalBroken} do naprawy` : "Wszystkie działają"}
            </p>
            {totalExpiring > 0 ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tokeny wygasające w ciągu 14 dni: {totalExpiring}
              </p>
            ) : null}
          </Card>
        </div>

        <ConnectionsPanel
          clients={clientList.map((c) => ({
            slug: c.slug as string,
            name: c.name as string,
            down: healthByClient.get(c.id as string)?.down ?? [],
          }))}
          nothingSelected={nothingSelected}
          reconnected={searchParams.reconnected}
          fixed={searchParams.fixed}
          connError={searchParams.conn_error}
        />

        <section aria-labelledby="klienci-title" className="space-y-4">
          <div className="px-1">
            <p className="kick">Twoi klienci</p>
            <h2 id="klienci-title" className="mt-2 text-[22px] font-medium tracking-[-0.03em]">
              Klienci
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clientList.map((c) => {
            const spend = spendByClient.get(c.id as string) ?? 0;
            const alerts = alertCounts.get(c.id as string) ?? 0;
            const health = healthByClient.get(c.id as string) ?? { down: [], expiring: [] };
            return (
              <Card
                key={c.slug}
                className="group relative p-[22px] transition-[box-shadow,transform] duration-200 focus-within:ring-2 focus-within:ring-ring hover:-translate-y-0.5 hover:shadow-lime-ring motion-reduce:hover:translate-y-0 sm:p-6"
              >
                {/* Whole tile opens the client; the reconnect links below sit
                    above this layer so they stay clickable on their own. */}
                <Link
                  href={`/${c.slug}`}
                  aria-label={`Otwórz panel ${c.name}`}
                  className="absolute inset-0 z-0 rounded-card focus-visible:outline-none"
                />

                <div className="pointer-events-none relative flex items-center gap-3">
                  <span aria-hidden className={cn(CLIENT_AVATAR, "h-11 w-11 text-sm")}>
                    {c.name.slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[17px] font-medium tracking-[-0.015em]">{c.name}</p>
                    <p className="truncate font-mono text-xs text-ink-3">/{c.slug}</p>
                  </div>
                  <ArrowRight
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
                  />
                </div>

                <div className="pointer-events-none relative z-10 mt-4 flex flex-wrap gap-1.5">
                  {alerts > 0 ? (
                    <Pill tone="negative" className="tabular-nums">
                      {alerts} {plPlural(alerts, "krytyczny", "krytyczne", "krytycznych")}
                    </Pill>
                  ) : null}
                  <Suspense fallback={<AgencyTodoChipSkeleton />}>
                    <AgencyTodoChipAsync todo={todo} clientSlug={c.slug as string} />
                  </Suspense>
                </div>

                <div className="pointer-events-none relative mt-4">
                  <p className="kick !text-[11px]">Wydatki wczoraj</p>
                  <p className="mt-1.5 text-[1.75rem] font-light leading-none tracking-[-0.045em] tabular-nums">{formatMoneyPLN(spend)}</p>
                </div>

                <div className="relative z-10 mt-4 border-t border-line pt-3 text-xs">
                  {health.down.length === 0 && health.expiring.length === 0 ? (
                    <p className="pointer-events-none flex items-center gap-1.5 text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-positive" aria-hidden />
                      Wszystkie połączenia działają
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {health.down.map((h) => {
                        const path = RECONNECT_PATH[h.provider];
                        return (
                          <li key={h.provider} className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5 text-warning">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              <span className="truncate" title={h.lastError ?? undefined}>
                                {h.label}:{" "}
                                {h.tokenExpired ? "token wygasł" : "brak danych"}
                              </span>
                            </span>
                            {path ? (
                              <a
                                href={`${path}?client=${c.slug}`}
                                className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 font-medium text-warning transition-colors hover:bg-anchor hover:text-anchor-foreground"
                              >
                                Połącz
                              </a>
                            ) : null}
                          </li>
                        );
                      })}
                      {health.expiring.map((e) => (
                        <li key={`exp-${e.provider}`} className="flex items-center justify-between gap-2">
                          <span className="truncate text-muted-foreground">
                            {e.label}: token wygasa za {e.daysLeft} {e.daysLeft === 1 ? "dzień" : "dni"}
                          </span>
                          <Link
                            href={`/${c.slug}/settings#polaczenia`}
                            className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium hover:bg-secondary"
                          >
                            Napraw
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            );
          })}
          </div>
          <BrandingFillButton />
        </section>

        {isAdmin ? (
          <section aria-labelledby="dodaj-klienta-title" className="space-y-4">
            <div className="px-1">
              <p className="kick">Tylko admin</p>
              <h2 id="dodaj-klienta-title" className="mt-2 text-[22px] font-medium tracking-[-0.03em]">
                Dodaj klienta
              </h2>
              <p className="mt-1.5 text-[15px] text-ink-2">
                Po dodaniu przejdziesz do Ustawień, żeby połączyć Meta / Google / GA4 dla tego klienta.
              </p>
            </div>
            {searchParams.error ? (
              <p className="text-sm text-destructive">{searchParams.error}</p>
            ) : null}
            <form
              action={addClient}
              className="glass flex flex-col gap-4 rounded-card p-5 sm:flex-row sm:items-end sm:p-6"
            >
              <label className="flex flex-1 flex-col gap-1.5 text-xs">
                <span className="kick">Nazwa</span>
                <input
                  name="name"
                  required
                  placeholder="np. DRE"
                  className="h-11 rounded-[14px] border border-transparent bg-chip px-3.5 text-[15px] outline-none transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus:bg-card focus:ring-2 focus:ring-ring dark:focus:bg-[var(--chip-hover)]"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1.5 text-xs">
                <span className="kick">Slug (adres URL)</span>
                <input
                  name="slug"
                  required
                  placeholder="np. dre"
                  className="h-11 rounded-[14px] border border-transparent bg-chip px-3.5 text-[15px] outline-none transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus:bg-card focus:ring-2 focus:ring-ring dark:focus:bg-[var(--chip-hover)]"
                />
              </label>
              <Button type="submit" size="pill" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Dodaj i połącz konta
              </Button>
            </form>
          </section>
        ) : null}
      </main>
    </div>
  );
}
