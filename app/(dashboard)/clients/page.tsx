import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LayoutDashboard, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAgencyUser, type UserRole } from "@/lib/types";

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
  const slug = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase()
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
    .select("slug, name")
    .order("name", { ascending: true });

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LayoutDashboard className="h-4 w-4" />
          </span>
          <span className="font-semibold">Pato · Klienci</span>
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

      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Wybierz klienta</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Każdy klient ma własny dashboard, raporty i alerty.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(clients ?? []).map((c) => (
            <Link key={c.slug} href={`/${c.slug}`}>
              <Card className="group h-full transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-1 hover:ring-primary/20">
                <CardContent className="flex items-center justify-between gap-3 p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-sm font-bold uppercase text-accent-foreground">
                      {c.name.slice(0, 2)}
                    </span>
                    <span className="font-medium">{c.name}</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {isAdmin ? (
          <div className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Dodaj klienta
            </h2>
            {searchParams.error ? (
              <p className="mt-2 text-sm text-destructive">{searchParams.error}</p>
            ) : null}
            <form
              action={addClient}
              className="mt-3 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end"
            >
              <label className="flex flex-1 flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Nazwa</span>
                <input
                  name="name"
                  required
                  placeholder="np. DRE"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Slug (adres URL)</span>
                <input
                  name="slug"
                  required
                  placeholder="np. dre"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                />
              </label>
              <Button type="submit" size="sm" className="gap-1.5">
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
