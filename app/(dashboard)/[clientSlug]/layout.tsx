import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LayoutDashboard, LogOut } from "lucide-react";
import { Toaster } from "sonner";

import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { AutoSync } from "@/components/dashboard/auto-sync";
import { ClientBrandMark } from "@/components/dashboard/client-brand-mark";
import {
  IntegrationHealthBanner,
  preloadIntegrationHealth,
} from "@/components/dashboard/integration-health-banner";
import { ClientSwitcher } from "@/components/dashboard/client-switcher";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { GuidedTour } from "@/components/dashboard/guided-tour";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { PresentationMode } from "@/components/dashboard/presentation-mode";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Button } from "@/components/ui/button";
import { clientAccentStyle } from "@/lib/dashboard/branding";
import {
  getClientBySlug,
  getLastSyncAt,
  getViewer,
} from "@/lib/dashboard/context";
import { createClient } from "@/lib/supabase/server";

import { getSyncStamp } from "./live-actions";

// Server Action: sign out and return to the login screen.
async function signOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function ClientDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { clientSlug: string };
}) {
  // The layout holds back the whole shell (the loading skeleton included), so
  // it waits on as few sequential round trips as possible: the viewer's role
  // (two trips: auth -> users) and the client row (one) run side by side, and
  // whatever needs only the client starts the moment that row is in. The page
  // renders in parallel and shares both lookups (React cache).
  const clientPromise = getClientBySlug(params.clientSlug);
  const [viewer, client, lastSyncAt, clientList] = await Promise.all([
    getViewer(),
    clientPromise,
    clientPromise.then((c) => {
      // The health banner streams in after the shell; start its reads now so
      // it lands with the page instead of a couple of round trips later.
      if (c) preloadIntegrationHealth(c.id);
      return c ? getLastSyncAt(c.id) : null;
    }),
    // Agency users get a client switcher in the sidebar. Read through RLS,
    // which gives agency users every client (the same rows the service-role
    // read used to return), so it can start right away instead of waiting
    // for the role. Other viewers only see their own row; dropped below.
    createClient()
      .from("clients")
      .select("slug, name")
      .order("name", { ascending: true })
      .then((r) => r.data),
  ]);
  const isAgency = viewer.isAgency;
  const isEcommerce = client?.clientType === "ecommerce";
  const user = viewer.email ? { email: viewer.email } : null;
  const allClients = isAgency ? clientList : null;
  const checkStamp = getSyncStamp.bind(null, params.clientSlug);

  return (
    // --client-accent scopes the client's brand colour to their dashboard.
    <div
      className="flex min-h-screen bg-muted/20"
      style={clientAccentStyle(client?.brandColor)}
    >
      <aside
        data-present-hide
        className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex print:hidden"
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
          <ClientBrandMark
            name={client?.name ?? "Pato"}
            slug={params.clientSlug}
            logoUrl={client?.logoUrl}
            // Built-in SVG wordmarks keep their h-6; uploaded logos get a bit more
            // room since they often carry padding or a symbol.
            className="h-6 max-w-[11rem] text-foreground [&:is(img)]:h-8"
            fallback={
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <LayoutDashboard className="h-4 w-4" />
                </span>
                <span className="font-semibold">{client?.name ?? "Pato"}</span>
              </>
            }
          />
        </div>
        {isAgency && allClients && allClients.length > 1 ? (
          <div className="border-b border-border p-3">
            <ClientSwitcher clients={allClients} current={params.clientSlug} />
          </div>
        ) : null}
        <DashboardSidebar
          isEcommerce={isEcommerce}
          clientSlug={params.clientSlug}
          isAgency={isAgency}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {isAgency ? <AutoSync clientSlug={params.clientSlug} /> : null}
        {/* Presentation mode hides the whole header; its own floating bar
            (portaled to <body>) takes over the controls. */}
        <header
          data-present-hide
          className="flex h-14 items-center gap-2 border-b border-border bg-card px-4 sm:gap-3 sm:px-6 print:hidden"
        >
          <AutoRefresh initialStamp={lastSyncAt} checkStamp={checkStamp} />
          <span className="flex-1" />
          <CommandPalette
            clientSlug={params.clientSlug}
            isAgency={isAgency}
            isEcommerce={isEcommerce}
            clients={allClients}
          />
          <GuidedTour isAgency={isAgency} overviewPath={`/${params.clientSlug}`} />
          <PresentationMode
            brand={
              client ? (
                <ClientBrandMark
                  name={client.name}
                  slug={params.clientSlug}
                  logoUrl={client.logoUrl}
                  className="h-8"
                  fallback={<span className="text-sm font-semibold">{client.name}</span>}
                />
              ) : null
            }
          />
          <ThemeToggle />
          {isAgency ? <RefreshButton clientSlug={params.clientSlug} /> : null}
          {user?.email ? (
            <div className="hidden items-center gap-2 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground">
                {user.email.charAt(0).toUpperCase()}
              </span>
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {user.email}
              </span>
            </div>
          ) : null}
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm" className="gap-1.5" title="Wyloguj">
              <LogOut className="h-3.5 w-3.5 sm:hidden" />
              <span className="hidden sm:inline">Wyloguj</span>
            </Button>
          </form>
        </header>

        <div data-present-hide>
          <MobileNav
            clientSlug={params.clientSlug}
            isAgency={isAgency}
            isEcommerce={isEcommerce}
          />
        </div>

        <main className="flex-1 pb-24 md:pb-0">
          {client ? (
            // Health checks take a few queries per provider; never hold the
            // page back for them. Hidden on the TV: it's connection
            // housekeeping, not board material.
            <div data-present-hide>
              <Suspense fallback={null}>
                <IntegrationHealthBanner
                  clientId={client.id}
                  clientSlug={params.clientSlug}
                  isAgency={isAgency}
                />
              </Suspense>
            </div>
          ) : null}
          {children}
        </main>
      </div>

      <Toaster richColors position="top-right" />
    </div>
  );
}
