import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

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
import { createClient } from "@/lib/supabase/server";
import type { IntegrationProvider } from "@/lib/types";

import { ConnectedToast } from "./connected-toast";
import { TestConnectionButton } from "./test-connection-button";

// Always render fresh so the account selection reflects the latest save.
export const dynamic = "force-dynamic";

interface Account {
  id: string;
  name?: string;
  selected?: boolean;
}

const PROVIDERS: Array<{
  key: Extract<IntegrationProvider, "meta_ads" | "google_ads">;
  routeSlug: "meta" | "google-ads";
  label: string;
  description: string;
}> = [
  {
    key: "meta_ads",
    routeSlug: "meta",
    label: "Meta Ads",
    description: "Kampanie z Facebooka i Instagrama.",
  },
  {
    key: "google_ads",
    routeSlug: "google-ads",
    label: "Google Ads",
    description: "Kampanie z wyszukiwarki i sieci Google.",
  },
];

// Server Action: disconnect an integration.
async function disconnectIntegration(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const provider = String(formData.get("provider")) as IntegrationProvider;

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();
  await admin
    .from("integrations")
    .delete()
    .eq("client_id", access.clientId)
    .eq("provider", provider);

  revalidatePath(`/${clientSlug}/settings`);
  redirect(`/${clientSlug}/settings`);
}

// Server Action: save which accounts belong to this client. Everything not
// ticked is ignored by the sync. Also purges existing metrics for the provider
// so rows from deselected accounts disappear (the cron repopulates the rest).
async function saveAccounts(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const provider = String(formData.get("provider")) as IntegrationProvider;
  const selectedIds = formData.getAll("account").map(String);

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("account_ids")
    .eq("client_id", access.clientId)
    .eq("provider", provider)
    .single();

  const accounts = ((data?.account_ids ?? []) as Account[]).map((a) => ({
    ...a,
    selected: selectedIds.includes(String(a.id)),
  }));

  await admin
    .from("integrations")
    .update({ account_ids: accounts })
    .eq("client_id", access.clientId)
    .eq("provider", provider);

  await admin
    .from("ads_daily")
    .delete()
    .eq("client_id", access.clientId)
    .eq("provider", provider);

  revalidatePath(`/${clientSlug}/settings`);
  revalidatePath(`/${clientSlug}`);
  redirect(`/${clientSlug}/settings?saved=${provider}`);
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { connected?: string; error?: string; saved?: string };
}) {
  const access = await requireAgencyClientAccess(params.clientSlug);
  if (!access.ok) {
    redirect(access.status === 401 ? "/login" : `/${params.clientSlug}`);
  }

  const supabase = createClient();
  const { data: integrations } = await supabase
    .from("integrations")
    .select("provider, account_ids")
    .eq("client_id", access.clientId);

  const byProvider = new Map(
    (integrations ?? []).map((row) => [row.provider as string, row])
  );

  return (
    <div className="p-6">
      <ConnectedToast
        connected={searchParams.connected}
        error={searchParams.error}
        saved={searchParams.saved}
      />

      <h1 className="text-lg font-semibold">Integracje</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Połącz konta reklamowe i zaznacz, które należą do tego klienta.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const integration = byProvider.get(provider.key);
          const accounts = (
            Array.isArray(integration?.account_ids)
              ? (integration!.account_ids as Account[])
              : []
          )
            .slice()
            .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
          const connected = Boolean(integration);
          const selectedCount = accounts.filter((a) => a.selected).length;

          return (
            <Card key={provider.key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {provider.label}
                  {connected ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : null}
                </CardTitle>
                <CardDescription>{provider.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {connected ? (
                  <>
                    <p className="text-sm text-foreground">
                      ✅ Połączono · {selectedCount} z {accounts.length} kont
                      wybranych
                    </p>

                    <form action={saveAccounts} className="flex flex-col gap-3">
                      <input
                        type="hidden"
                        name="client"
                        value={params.clientSlug}
                      />
                      <input
                        type="hidden"
                        name="provider"
                        value={provider.key}
                      />
                      <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                        {accounts.map((account) => (
                          <label
                            key={account.id}
                            className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                          >
                            <input
                              type="checkbox"
                              name="account"
                              value={account.id}
                              defaultChecked={account.selected}
                              className="h-4 w-4 rounded border-input"
                            />
                            <span className="truncate">
                              {account.name || account.id}
                            </span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              {account.id}
                            </span>
                          </label>
                        ))}
                      </div>
                      <Button type="submit" size="sm" className="w-fit">
                        Zapisz wybór kont
                      </Button>
                    </form>

                    <div className="flex gap-2">
                      <TestConnectionButton
                        provider={provider.routeSlug}
                        clientSlug={params.clientSlug}
                      />
                      <form action={disconnectIntegration}>
                        <input
                          type="hidden"
                          name="client"
                          value={params.clientSlug}
                        />
                        <input
                          type="hidden"
                          name="provider"
                          value={provider.key}
                        />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                        >
                          Rozłącz
                        </Button>
                      </form>
                    </div>
                  </>
                ) : (
                  <Button asChild className="w-fit">
                    <a
                      href={`/api/integrations/${provider.routeSlug}/connect?client=${params.clientSlug}`}
                    >
                      Połącz {provider.label}
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
