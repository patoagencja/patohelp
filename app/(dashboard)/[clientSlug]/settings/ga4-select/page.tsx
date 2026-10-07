import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

import { selectedGa4Properties } from "@/lib/integrations/ga4-merge";

import { CHECKBOX_CLASS } from "../form-styles";

export const dynamic = "force-dynamic";

interface Ga4AccountIds {
  propertyId: string | null;
  /** Several properties summed (a site per country); see ga4-merge.ts. */
  propertyIds?: string[];
  properties?: Array<{
    propertyId: string;
    displayName: string;
    accountName: string;
  }>;
}

// Server Action: persist the chosen GA4 properties (one or several - Elfi
// runs a site per country, the dashboard sums them).
async function selectProperty(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const picked = Array.from(new Set(formData.getAll("propertyId").map(String)));

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("account_ids")
    .eq("client_id", access.clientId)
    .eq("provider", "ga4")
    .single();

  const accountIds = (data?.account_ids ?? {}) as Ga4AccountIds;
  // Only a property the OAuth callback actually listed for this connection:
  // a crafted post must not point this client's sync (and dashboard) at some
  // other property the agency's Google account happens to reach.
  const listed = new Set((accountIds.properties ?? []).map((p) => p.propertyId));
  const propertyIds = picked.filter((id) => listed.has(id));
  if (propertyIds.length === 0 || propertyIds.length !== picked.length) {
    redirect(`/${access.clientSlug}/settings/ga4-select`);
  }
  await admin
    .from("integrations")
    // propertyId stays the first pick: the readers that need a single
    // property (demographics, website preview) keep working.
    .update({ account_ids: { ...accountIds, propertyId: propertyIds[0], propertyIds } })
    .eq("client_id", access.clientId)
    .eq("provider", "ga4");

  revalidatePath(`/${clientSlug}/settings`);
  redirect(`/${clientSlug}/settings?connected=ga4`);
}

export default async function Ga4SelectPage({
  params,
}: {
  params: { clientSlug: string };
}) {
  const access = await requireAgencyClientAccess(params.clientSlug);
  if (!access.ok) {
    redirect(access.status === 401 ? "/login" : `/${params.clientSlug}`);
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("account_ids")
    .eq("client_id", access.clientId)
    .eq("provider", "ga4")
    .single();

  const accountIds = (data?.account_ids ?? {}) as Ga4AccountIds;
  const properties = accountIds.properties ?? [];
  const chosen = new Set(selectedGa4Properties(accountIds));

  return (
    <div className="space-y-6 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      <Link
        href={`/${params.clientSlug}/settings#integracje`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-chip px-4 text-sm text-ink-2 transition-colors hover:bg-[var(--chip-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Wróć do ustawień
      </Link>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Wybierz usługi GA4</CardTitle>
          <CardDescription>
            Połączone konto Google ma dostęp do kilku usług (property) Google
            Analytics. Zaznacz wszystkie, które należą do tego klienta - np. osobne
            strony dla każdego kraju. Panel zsumuje ich ruch, a przychody w innych
            walutach przeliczy na złote po kursie NBP.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {properties.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nie znaleziono żadnej usługi GA4. Połącz Google Analytics ponownie w
              ustawieniach.
            </p>
          ) : (
            <form action={selectProperty} className="space-y-4">
              <input type="hidden" name="client" value={params.clientSlug} />
              <fieldset className="space-y-2">
                <legend className="sr-only">Usługi GA4</legend>
                {properties.map((p, i) => (
                  <label
                    key={p.propertyId}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[20px] bg-chip p-3.5 text-sm transition-colors hover:bg-[var(--chip-hover)] has-[:checked]:bg-[var(--chip-hover)] has-[:checked]:ring-1 has-[:checked]:ring-anchor"
                  >
                    <input
                      type="checkbox"
                      name="propertyId"
                      value={p.propertyId}
                      defaultChecked={chosen.size ? chosen.has(p.propertyId) : i === 0}
                      className={`mt-0.5 ${CHECKBOX_CLASS}`}
                    />
                    <span className="min-w-0">
                      <span className="block break-words font-medium">{p.displayName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.accountName} · ID {p.propertyId}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <Button type="submit">Zapisz wybór</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
