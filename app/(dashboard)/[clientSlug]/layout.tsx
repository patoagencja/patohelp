import { formatInTimeZone } from "date-fns-tz";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";

import { AppShell } from "@/components/dashboard/app-shell";
import { AutoRefresh, LiveStamp } from "@/components/dashboard/auto-refresh";
import { AutoSync } from "@/components/dashboard/auto-sync";
import { ClientBrandMark } from "@/components/dashboard/client-brand-mark";
import {
  IntegrationHealthBanner,
  preloadIntegrationHealth,
} from "@/components/dashboard/integration-health-banner";
import { ClientSwitcher } from "@/components/dashboard/client-switcher";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { GuidedTour } from "@/components/dashboard/guided-tour";
import { AlertsBellLive } from "@/components/dashboard/alerts-bell-live";
import { AlertsBell, HeaderMenu, SearchButton } from "@/components/dashboard/header-menu";
import { PresentationMode } from "@/components/dashboard/presentation-mode";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { Snowfall } from "@/components/dashboard/season/festive";
import { Toaster } from "@/components/ui/toaster";
import { clientAccentStyle } from "@/lib/dashboard/branding";
import {
  getClientBySlug,
  getLastSyncAt,
  getViewer,
} from "@/lib/dashboard/context";
import { seasonState } from "@/lib/season/config";
import { coversWigilia } from "@/lib/season/festive";
import { getClientSeason } from "@/lib/season/load";
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
  const [viewer, client, lastSyncAt, clientList, season] = await Promise.all([
    getViewer(),
    clientPromise,
    clientPromise.then((c) => {
      // The health banner streams in after the shell; start its reads now so
      // it lands with the page instead of a couple of round trips later.
      if (c) preloadIntegrationHealth(c.id);
      return c ? getLastSyncAt(c.id) : null;
    }),
    // Agency users get a client switcher in the top bar. Read through RLS,
    // which gives agency users every client (the same rows the service-role
    // read used to return), so it can start right away instead of waiting
    // for the role. Other viewers only see their own row; dropped below.
    createClient()
      .from("clients")
      .select("slug, name")
      .order("name", { ascending: true })
      .then((r) => r.data),
    // Sezon in the nav: one more read that needs only the client id, so it
    // rides alongside the sync stamp. React-cached: the season page reuses it.
    clientPromise.then((c) => (c ? getClientSeason(c.id) : null)),
  ]);
  const isAgency = viewer.isAgency;
  const isEcommerce = client?.clientType === "ecommerce";
  const isSeasonal = season !== null;
  // Christmas-season clients (Elfi) get falling snow while their season runs.
  const seasonNow = season
    ? seasonState(season, formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd"))
    : null;
  const snowing = !!seasonNow && seasonNow.phase === "in" && coversWigilia(seasonNow.current);
  const user = viewer.email ? { email: viewer.email } : null;
  const allClients = isAgency ? clientList : null;
  const checkStamp = getSyncStamp.bind(null, params.clientSlug);

  const clientName = client?.name ?? "Pato";
  const base = `/${params.clientSlug}`;
  const fallbackMark = (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-anchor text-anchor-foreground">
        <LayoutDashboard className="h-4 w-4" />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.02em]">{clientName}</span>
    </span>
  );

  return (
    // --client-accent scopes the client's brand colour to their dashboard.
    <AppShell
      style={clientAccentStyle(client?.brandColor)}
      base={base}
      isEcommerce={isEcommerce}
      isSeasonal={isSeasonal}
      isAgency={isAgency}
      brand={
        <ClientBrandMark
          name={clientName}
          slug={params.clientSlug}
          logoUrl={client?.logoUrl}
          // Built-in SVG wordmarks keep their h-6; uploaded logos get a bit
          // more room since they often carry padding or a symbol.
          className="h-6 max-w-[10rem] text-foreground [&:is(img)]:h-8"
          fallback={fallbackMark}
        />
      }
      phoneBrand={
        <ClientBrandMark
          name={clientName}
          slug={params.clientSlug}
          logoUrl={client?.logoUrl}
          className="h-5 max-w-[5.5rem] text-foreground [&:is(img)]:h-6"
          fallback={
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-anchor text-anchor-foreground">
              <LayoutDashboard className="h-3.5 w-3.5" />
            </span>
          }
        />
      }
      live={
        <LiveStamp
          initialStamp={lastSyncAt}
          // Agency bars carry the client switcher and Odśwież: the dot alone
          // (time in its tooltip) keeps every button inside the bar.
          textClassName={isAgency ? "sr-only" : "sr-only xl:not-sr-only xl:whitespace-nowrap"}
        />
      }
      phoneLive={<LiveStamp initialStamp={lastSyncAt} className="gap-1.5 text-[11.5px]" textClassName="truncate" />}
      extras={
        <>
          {isAgency && allClients && allClients.length > 1 ? (
            <div className="hidden w-40 2xl:block">
              <ClientSwitcher clients={allClients} current={params.clientSlug} />
            </div>
          ) : null}
          {isAgency ? <RefreshButton clientSlug={params.clientSlug} /> : null}
        </>
      }
      search={<SearchButton />}
      bell={
        // Count streams in after the shell; plain bell until then.
        <Suspense fallback={<AlertsBell href={`${base}/alerty`} />}>
          {client ? (
            <AlertsBellLive clientId={client.id} href={`${base}/alerty`} />
          ) : (
            <AlertsBell href={`${base}/alerty`} />
          )}
        </Suspense>
      }
      presentation={
        <PresentationMode
          className={isAgency ? "max-md:w-11 max-md:px-0 xl:w-11 xl:px-0" : "max-md:w-11 max-md:px-0"}
          labelClassName={
            // Agency bars also carry Odśwież (+ the client switcher at 2xl):
            // the word only fits next to them on the widest screens.
            isAgency ? "hidden md:max-xl:inline" : "hidden md:max-xl:inline xl:inline"
          }
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
      }
      menu={
        <HeaderMenu
          overviewPath={base}
          email={user?.email}
          signOut={signOut}
          isEcommerce={isEcommerce}
          isSeasonal={isSeasonal}
          isAgency={isAgency}
        />
      }
      overlays={
        <>
          {isAgency ? <AutoSync clientSlug={params.clientSlug} /> : null}
          <AutoRefresh initialStamp={lastSyncAt} checkStamp={checkStamp} headless />
          {/* Overlays and shortcuts stay live (⌘K, "/", first-visit tour). */}
          <CommandPalette
            clientSlug={params.clientSlug}
            isAgency={isAgency}
            isEcommerce={isEcommerce}
            isSeasonal={isSeasonal}
            clients={allClients}
          />
          <GuidedTour isAgency={isAgency} overviewPath={base} />
          {snowing ? <Snowfall /> : null}
        </>
      }
      banner={
        client ? (
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
        ) : null
      }
      // Pages pad themselves (px-4 sm:px-6); phones clear the floating tab bar.
      mainClassName="pb-32 md:pb-12"
      after={<Toaster />}
    >
      {children}
    </AppShell>
  );
}
