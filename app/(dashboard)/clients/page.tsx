import { redirect } from "next/navigation";
import Link from "next/link";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { AlertTriangle, ArrowRight, LayoutDashboard, Plus, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { detectAnomalies } from "@/lib/alerts/anomalies";
import { detectBudgetSpikes } from "@/lib/alerts/budget";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAgencyUser, type UserRole } from "@/lib/types";
import { cn, formatMoneyPLN } from "@/lib/utils";

export const dynamic = "force-dynamic";

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
  searchParams: { error?: string };
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
  const spendRows = await fetchAll<{ client_id: string; spend_minor_units: number | string }>(
    (from, to) =>
      admin
        .from("ads_daily")
        .select("client_id, spend_minor_units")
        .eq("date", yesterday)
        .order("client_id", { ascending: true })
        .range(from, to)
  );
  const spendByClient = new Map<string, number>();
  for (const r of spendRows) {
    spendByClient.set(
      r.client_id,
      (spendByClient.get(r.client_id) ?? 0) + Number(r.spend_minor_units)
    );
  }

  // Live CRITICAL alert count per client (spend spikes + anomalies), in
  // parallel. Only critical severity is surfaced on the picker.
  const alertCounts = new Map<string, number>();
  await Promise.all(
    clientList.map(async (c) => {
      try {
        const [spikes, anomalies] = await Promise.all([
          detectBudgetSpikes(c.id as string),
          detectAnomalies(c.id as string),
        ]);
        const critical = [...spikes, ...anomalies].filter(
          (a) => a.severity === "critical"
        ).length;
        alertCounts.set(c.id as string, critical);
      } catch {
        alertCounts.set(c.id as string, 0);
      }
    })
  );

  const totalYesterday = [...spendByClient.values()].reduce((a, b) => a + b, 0);
  const totalAlerts = [...alertCounts.values()].reduce((a, b) => a + b, 0);

  // A distinct gradient per client tile, cycled by index - the pop of colour
  // that makes the picker feel alive.
  const GRADIENTS = [
    "from-violet-500 to-indigo-500",
    "from-amber-400 to-orange-500",
    "from-emerald-400 to-teal-500",
    "from-sky-400 to-blue-500",
    "from-pink-500 to-rose-500",
    "from-fuchsia-500 to-purple-600",
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-muted/40 via-background to-background">
      {/* Decorative colour blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full bg-primary/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-10 h-80 w-80 rounded-full bg-violet-400/20 blur-3xl"
      />

      <header className="relative flex h-16 items-center justify-between border-b border-border/60 bg-card/70 px-6 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-lg shadow-primary/20">
            <LayoutDashboard className="h-4 w-4" />
          </span>
          <span className="font-semibold tracking-tight">Pato · Klienci</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {user.email}
          </span>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Wyloguj
            </Button>
          </form>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-6 py-12">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Panel agencji
          </span>
          <h1 className="mt-4 bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
            Wybierz klienta
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            Każdy klient ma własny dashboard, raporty i alerty. Wybierz, żeby
            wejść do jego panelu.
          </p>
        </div>

        {/* Summary strip across all clients */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Klienci
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {clientList.length}
            </p>
          </div>
          <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Wydatki wczoraj (łącznie)
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {formatMoneyPLN(totalYesterday)}
            </p>
          </div>
          <div
            className={cn(
              "rounded-3xl border p-5 shadow-sm",
              totalAlerts > 0
                ? "border-red-500/30 bg-red-500/5"
                : "border-border/70 bg-card"
            )}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <AlertTriangle
                className={cn(
                  "h-3.5 w-3.5",
                  totalAlerts > 0 ? "text-red-500" : "text-muted-foreground"
                )}
              />
              Krytyczne alerty
            </p>
            <p
              className={cn(
                "mt-1 font-mono text-2xl font-bold tabular-nums",
                totalAlerts > 0 && "text-red-600 dark:text-red-400"
              )}
            >
              {totalAlerts}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {clientList.map((c, i) => {
            const grad = GRADIENTS[i % GRADIENTS.length];
            const spend = spendByClient.get(c.id as string) ?? 0;
            const alerts = alertCounts.get(c.id as string) ?? 0;
            return (
              <Link
                key={c.slug}
                href={`/${c.slug}`}
                className={cn(
                  "group relative overflow-hidden rounded-3xl border bg-card p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/10",
                  alerts > 0
                    ? "border-red-500/40"
                    : "border-border/70 hover:border-transparent"
                )}
              >
                <div
                  aria-hidden
                  className={cn(
                    "absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-[0.08]",
                    grad
                  )}
                />

                {/* Red alert badge */}
                {alerts > 0 ? (
                  <span className="absolute right-4 top-4 z-10 inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                    </span>
                    {alerts} {alerts === 1 ? "krytyczny" : "krytycznych"}
                  </span>
                ) : null}

                <div className="relative flex items-center gap-4">
                  <span
                    className={cn(
                      "flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-lg font-bold uppercase text-white shadow-lg transition-transform duration-300 group-hover:scale-105",
                      grad
                    )}
                  >
                    {c.name.slice(0, 2)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">{c.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      /{c.slug}
                    </p>
                  </div>
                </div>

                <div className="relative mt-5 flex items-end justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Wydatki wczoraj
                    </p>
                    <p className="font-mono text-lg font-bold tabular-nums">
                      {formatMoneyPLN(spend)}
                    </p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary transition-all duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {isAdmin ? (
          <div className="mt-12">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Plus className="h-4 w-4" />
              Dodaj klienta
            </h2>
            {searchParams.error ? (
              <p className="mt-2 text-sm text-destructive">{searchParams.error}</p>
            ) : null}
            <form
              action={addClient}
              className="mt-4 flex flex-col gap-4 rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm backdrop-blur sm:flex-row sm:items-end"
            >
              <label className="flex flex-1 flex-col gap-1.5 text-xs">
                <span className="font-medium text-muted-foreground">Nazwa</span>
                <input
                  name="name"
                  required
                  placeholder="np. DRE"
                  className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1.5 text-xs">
                <span className="font-medium text-muted-foreground">
                  Slug (adres URL)
                </span>
                <input
                  name="slug"
                  required
                  placeholder="np. dre"
                  className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <Button type="submit" className="h-10 gap-1.5 rounded-xl">
                <Plus className="h-4 w-4" />
                Dodaj i połącz konta
              </Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              Po dodaniu przejdziesz do Ustawień, żeby połączyć Meta / Google /
              GA4 dla tego klienta.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
