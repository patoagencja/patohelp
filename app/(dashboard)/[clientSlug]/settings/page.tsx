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

// Server Action: disconnect an integration (delete the stored credentials).
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

  redirect(`/${clientSlug}/settings`);
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { connected?: string; error?: string };
}) {
  const access = await requireAgencyClientAccess(params.clientSlug);
  if (!access.ok) {
    // Clients (and anyone without agency access) don't see settings.
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
      />

      <h1 className="text-lg font-semibold">Integracje</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Połącz konta reklamowe klienta, aby zasilić dashboard danymi.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const integration = byProvider.get(provider.key);
          const accountIds = Array.isArray(integration?.account_ids)
            ? (integration!.account_ids as unknown[])
            : [];
          const connected = Boolean(integration);

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
                      ✅ Połączono, {accountIds.length}{" "}
                      {accountIds.length === 1 ? "konto" : "konta/kont"}
                    </p>
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
