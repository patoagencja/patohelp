import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { Toaster } from "sonner";

import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { clientLogo } from "@/components/dashboard/client-logo";
import { ClientSwitcher } from "@/components/dashboard/client-switcher";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Button } from "@/components/ui/button";
import { getLastSyncLabel } from "@/lib/dashboard/overview";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAgencyUser, type UserRole } from "@/lib/types";

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
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("users").select("role").eq("id", user.id).single()
    : { data: null };
  const isAgency = profile ? isAgencyUser(profile.role as UserRole) : false;

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", params.clientSlug)
    .single();

  const lastSync = client ? await getLastSyncLabel(client.id) : null;

  // Agency users get a client switcher in the sidebar.
  const { data: allClients } = isAgency
    ? await createAdminClient()
        .from("clients")
        .select("slug, name")
        .order("name", { ascending: true })
    : { data: null };

  return (
    <div className="flex min-h-screen bg-muted/20">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex print:hidden">
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
          clientSlug={params.clientSlug}
          isAgency={isAgency}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-6 print:hidden">
          <AutoRefresh />
          {lastSync ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {lastSync}
            </span>
          ) : null}
          <span className="flex-1" />
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

        <MobileNav clientSlug={params.clientSlug} isAgency={isAgency} />

        <main className="flex-1">{children}</main>
      </div>

      <Toaster richColors position="top-right" />
    </div>
  );
}
