import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
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
import { AlertsBell, HeaderMenu } from "@/components/dashboard/header-menu";
import { HeaderTitle } from "@/components/dashboard/header-title";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { PresentationMode } from "@/components/dashboard/presentation-mode";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { RefreshButton } from "@/components/dashboard/refresh-button";
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

  const clientName = client?.name ?? "Pato";
  const fallbackMark = (
    <>
      <span className="flex h-8 w-8 items-center justify-center rounded-[0.6rem] bg-primary text-primary-foreground">
        <LayoutDashboard className="h-4 w-4" />
      </span>
      <span className="font-semibold">{clientName}</span>
    </>
  );

  return (
    // --client-accent scopes the client's brand colour to their dashboard.
    // Shell: grey page, borderless sticky sidebar, translucent sticky header.
    <div
      className="flex min-h-screen bg-background"
      style={clientAccentStyle(client?.brandColor)}
    >
      <aside
        data-present-hide
        className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto md:flex print:hidden"
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
          <ClientBrandMark
            name={clientName}
            slug={params.clientSlug}
            logoUrl={client?.logoUrl}
            // Built-in SVG wordmarks keep their h-6; uploaded logos get a bit more
            // room since they often carry padding or a symbol.
            className="h-6 max-w-[11rem] text-foreground [&:is(img)]:h-8"
            fallback={fallbackMark}
          />
        </div>
        {isAgency && allClients && allClients.length > 1 ? (
          <div className="px-3 pb-2">
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
            (portaled to <body>) takes over the controls. At most three
            visible controls: (agency: Odśwież) Prezentuj and one "…" menu
            holding search, the guide, PDF, theme and sign-out. */}
        <header
          data-present-hide
          data-chrome-header
          className="sticky top-0 z-30 border-b border-transparent bg-chrome/75 backdrop-blur-xl backdrop-saturate-150 print:hidden"
        >
          {/* Same column and gutters as <main>, so the title sits exactly
              above the page content. */}
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1.5 px-4 sm:gap-2 sm:px-6 md:h-16 lg:px-8">
            <HeaderTitle
              clientName={clientName}
              base={`/${params.clientSlug}`}
              isEcommerce={isEcommerce}
              isAgency={isAgency}
              brand={
                <ClientBrandMark
                  name={clientName}
                  slug={params.clientSlug}
                  logoUrl={client?.logoUrl}
                  className="h-5 max-w-[8rem] text-foreground [&:is(img)]:h-7"
                  fallback={
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <LayoutDashboard className="h-3.5 w-3.5" />
                    </span>
                  }
                />
              }
            />
            <AutoRefresh initialStamp={lastSyncAt} checkStamp={checkStamp} />
            <span className="flex-1" />
            {/* Overlays and shortcuts stay live (⌘K, "/", first-visit tour);
                their header triggers moved into the "…" menu. */}
            <div className="hidden">
              <CommandPalette
                clientSlug={params.clientSlug}
                isAgency={isAgency}
                isEcommerce={isEcommerce}
                clients={allClients}
              />
              <GuidedTour isAgency={isAgency} overviewPath={`/${params.clientSlug}`} />
            </div>
            {isAgency ? <RefreshButton clientSlug={params.clientSlug} /> : null}
            <AlertsBell href={`/${params.clientSlug}/alerty`} />
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
            <HeaderMenu
              overviewPath={`/${params.clientSlug}`}
              email={user?.email}
              signOut={signOut}
            />
          </div>
        </header>

        <div data-present-hide>
          <MobileNav
            clientSlug={params.clientSlug}
            isAgency={isAgency}
            isEcommerce={isEcommerce}
          />
        </div>

        {/* Pages pad themselves (p-6); the shell caps the reading width so
            cards don't stretch edge to edge on wide screens. */}
        <main className="mx-auto w-full max-w-6xl flex-1 pb-24 md:pb-8 lg:px-2">
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
