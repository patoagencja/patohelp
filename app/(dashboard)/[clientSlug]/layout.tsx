import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { Toaster } from "sonner";

import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { Button } from "@/components/ui/button";
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
    .select("name")
    .eq("slug", params.clientSlug)
    .single();

  return (
    <div className="flex min-h-screen bg-muted/20">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-5">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          <span className="font-semibold">
            {client?.name ?? "Pato"}
          </span>
        </div>
        <DashboardSidebar
          clientSlug={params.clientSlug}
          isAgency={isAgency}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-4 border-b border-border bg-card px-6">
          {user?.email ? (
            <span className="text-sm text-muted-foreground">{user.email}</span>
          ) : null}
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Wyloguj
            </Button>
          </form>
        </header>

        <main className="flex-1">{children}</main>
      </div>

      <Toaster richColors position="top-right" />
    </div>
  );
}
