import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

// Server Action: sign out and return to the login screen.
async function signOut() {
  "use server";
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen bg-muted/20">
      {/* Sidebar — navigation links land in later phases. */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-6">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          <span className="font-semibold">Pato</span>
        </div>
      </aside>

      {/* Main column */}
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
    </div>
  );
}
