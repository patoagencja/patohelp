import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

export const dynamic = "force-dynamic";

interface Ga4AccountIds {
  propertyId: string | null;
  properties?: Array<{
    propertyId: string;
    displayName: string;
    accountName: string;
  }>;
}

// Server Action: persist the chosen GA4 property.
async function selectProperty(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const propertyId = String(formData.get("propertyId"));

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
  await admin
    .from("integrations")
    .update({ account_ids: { ...accountIds, propertyId } })
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

  return (
    <div className="p-6">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Wybierz property GA4</CardTitle>
          <CardDescription>
            Twoje konto ma dostęp do kilku property. Zaznacz to, które należy do
            tego klienta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {properties.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nie znaleziono żadnych property. Spróbuj połączyć ponownie.
            </p>
          ) : (
            <form action={selectProperty} className="space-y-3">
              <input type="hidden" name="client" value={params.clientSlug} />
              <div className="space-y-2">
                {properties.map((p, i) => (
                  <label
                    key={p.propertyId}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm hover:bg-muted"
                  >
                    <input
                      type="radio"
                      name="propertyId"
                      value={p.propertyId}
                      defaultChecked={i === 0}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">{p.displayName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.accountName} · ID {p.propertyId}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <Button type="submit">Zapisz wybór</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
