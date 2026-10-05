import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { Toaster } from "sonner";

import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { AutoSync } from "@/components/dashboard/auto-sync";
import { clientLogo } from "@/components/dashboard/client-logo";
import { IntegrationHealthBanner } from "@/components/dashboard/integration-health-banner";
import { ClientSwitcher } from "@/components/dashboard/client-switcher";
import { GuidedTour } from "@/components/dashboard/guided-tour";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { PresentationMode } from "@/components/dashboard/presentation-mode";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  getClientBySlug,
  getLastSyncAt,
  getViewer,
} from "@/lib/dashboard/context";
import { createAdminClient } from "@/lib/supabase/admin";
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
  // Everything below is independent once we know who is asking - fetch it in
  // one round instead of six sequential ones.
  const [viewer, client] = await Promise.all([
    getViewer(),
    getClientBySlug(params.clientSlug),
  ]);
  const isAgency = viewer.isAgency;
  const isEcommerce = client?.clientType === "ecommerce";
  const user = viewer.email ? { email: viewer.email } : null;

  const [lastSyncAt, allClients] = await Promise.all([
    client ? getLastSyncAt(client.id) : Promise.resolve(null),
    // Agency users get a client switcher in the sidebar.
    isAgency
      ? createAdminClient()
          .from("clients")
          .select("slug, name")
          .order("name", { ascending: true })
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);
  const checkStamp = getSyncStamp.bind(null, params.clientSlug);

  return (
    <div className="flex min-h-screen bg-muted/20">
      <aside
        data-present-hide
        className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex print:hidden"
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
          {(() => {
            const Logo = clientLogo(params.clientSlug);
            if (Logo) {
              return <Logo className="h-6 w-auto text-foreground" />;
            }
            return (
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <LayoutDashboard className="h-4 w-4" />
                </span>
                <span className="font-semibold">{client?.name ?? "Pato"}</span>
              </>
            );
          })()}
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
          className="flex h-14 items-center gap-3 border-b border-border bg-card px-6 print:hidden"
        >
          <AutoRefresh initialStamp={lastSyncAt} checkStamp={checkStamp} />
          <span className="flex-1" />
          <GuidedTour isAgency={isAgency} overviewPath={`/${params.clientSlug}`} />
          <PresentationMode />
          <ThemeToggle />
          {isAgency ? <RefreshButton clientSlug={params.clientSlug} /> : null}
          {user?.email ? (
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground">
                {user.email.charAt(0).toUpperCase()}
              </span>
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {user.email}
              </span>
            </div>
          ) : null}
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Wyloguj
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
