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
import { TestAlertButton } from "./test-alert-button";
import { TestConnectionButton } from "./test-connection-button";

// Always render fresh so the account selection reflects the latest save.
export const dynamic = "force-dynamic";

interface Account {
  id: string;
  name?: string;
  selected?: boolean;
}

const PROVIDERS: Array<{
  key: Extract<IntegrationProvider, "meta_ads" | "google_ads" | "tiktok_ads">;
  routeSlug: "meta" | "google-ads" | "tiktok";
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
  {
    key: "tiktok_ads",
    routeSlug: "tiktok",
    label: "TikTok Ads",
    description: "Kampanie i statystyki z TikTok Ads.",
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

  // Auto-sync the newly selected accounts so data repopulates immediately
  // (no manual cron run needed).
  const base = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (base && secret) {
    const job =
      provider === "meta_ads"
        ? "refresh-ads-meta"
        : provider === "tiktok_ads"
          ? "refresh-ads-tiktok"
          : "refresh-ads-google";
    try {
      await fetch(`${base}/api/cron/${job}`, {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
    } catch {
      // Best-effort; the scheduled cron will catch up regardless.
    }
  }

  revalidatePath(`/${clientSlug}/settings`);
  revalidatePath(`/${clientSlug}`);
  redirect(`/${clientSlug}/settings?saved=${provider}`);
}

// Server Action: save alert-notification settings (agency only).
async function saveNotificationSettings(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const parseList = (v: FormDataEntryValue | null) =>
    String(v ?? "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const clamp = (n: number) => Math.min(23, Math.max(0, Math.round(n)));

  const admin = createAdminClient();
  await admin.from("notification_settings").upsert(
    {
      client_id: access.clientId,
      email_enabled: formData.get("email_enabled") === "on",
      emails: parseList(formData.get("emails")),
      whatsapp_enabled: formData.get("whatsapp_enabled") === "on",
      whatsapp_numbers: parseList(formData.get("whatsapp_numbers")),
      hour_start: clamp(Number(formData.get("hour_start") ?? 8)),
      hour_end: clamp(Number(formData.get("hour_end") ?? 20)),
      min_severity:
        String(formData.get("min_severity")) === "medium" ? "medium" : "high",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" }
  );

  revalidatePath(`/${clientSlug}/settings`);
  redirect(`/${clientSlug}/settings?saved=notifications`);
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

  // Notification settings live behind RLS with no policy — read via admin.
  const { data: notif } = await createAdminClient()
    .from("notification_settings")
    .select(
      "email_enabled, emails, whatsapp_enabled, whatsapp_numbers, hour_start, hour_end, min_severity"
    )
    .eq("client_id", access.clientId)
    .maybeSingle();

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

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {(() => {
          const ga4 = byProvider.get("ga4");
          const ga4Ids = (ga4?.account_ids ?? {}) as {
            propertyId?: string | null;
            properties?: Array<{ propertyId: string; displayName: string }>;
          };
          const connected = Boolean(ga4);
          const propName = ga4Ids.properties?.find(
            (p) => p.propertyId === ga4Ids.propertyId
          )?.displayName;
          const multi = (ga4Ids.properties?.length ?? 0) > 1;

          return (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Google Analytics 4
                  {connected ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : null}
                </CardTitle>
                <CardDescription>
                  Ruch na stronie: źródła, urządzenia, podstrony.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {connected ? (
                  <>
                    <p className="text-sm text-foreground">
                      {ga4Ids.propertyId
                        ? `✅ Połączono · property ${propName ?? ga4Ids.propertyId}`
                        : "⚠️ Połączono, ale nie wybrano property"}
                    </p>
                    <div className="flex gap-2">
                      <TestConnectionButton
                        provider="ga4"
                        clientSlug={params.clientSlug}
                      />
                      {multi ? (
                        <Button asChild variant="outline" size="sm">
                          <a href={`/${params.clientSlug}/settings/ga4-select`}>
                            Zmień property
                          </a>
                        </Button>
                      ) : null}
                      <form action={disconnectIntegration}>
                        <input
                          type="hidden"
                          name="client"
                          value={params.clientSlug}
                        />
                        <input type="hidden" name="provider" value="ga4" />
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
                      href={`/api/integrations/ga4/connect?client=${params.clientSlug}`}
                    >
                      Połącz GA4
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })()}
      </div>

      {/* Alert notifications */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold">Powiadomienia o alertach</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wysyłamy alerty (anomalie + „nie dowozi") na wskazane kanały, tylko w
          wybranych godzinach. Jeden alert = maks. raz dziennie.
        </p>

        <Card className="mt-4 max-w-2xl">
          <CardContent className="pt-6">
            <form action={saveNotificationSettings} className="flex flex-col gap-5">
              <input type="hidden" name="client" value={params.clientSlug} />

              {/* Email */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="email_enabled"
                    defaultChecked={notif?.email_enabled ?? false}
                    className="h-4 w-4 rounded border-input"
                  />
                  E-mail
                </label>
                <textarea
                  name="emails"
                  rows={2}
                  placeholder="adresy oddzielone przecinkiem lub nową linią"
                  defaultValue={(notif?.emails ?? []).join(", ")}
                  className="rounded-md border border-input bg-background p-2 text-sm"
                />
              </div>

              {/* WhatsApp */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="whatsapp_enabled"
                    defaultChecked={notif?.whatsapp_enabled ?? false}
                    className="h-4 w-4 rounded border-input"
                  />
                  WhatsApp
                </label>
                <textarea
                  name="whatsapp_numbers"
                  rows={2}
                  placeholder="numery z kierunkowym, np. +48600100200"
                  defaultValue={(notif?.whatsapp_numbers ?? []).join(", ")}
                  className="rounded-md border border-input bg-background p-2 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Wymaga skonfigurowania WhatsApp Business API (token + numer).
                </p>
              </div>

              {/* Window + severity */}
              <div className="grid grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Od godziny</span>
                  <input
                    type="number"
                    name="hour_start"
                    min="0"
                    max="23"
                    defaultValue={notif?.hour_start ?? 8}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Do godziny</span>
                  <input
                    type="number"
                    name="hour_end"
                    min="0"
                    max="23"
                    defaultValue={notif?.hour_end ?? 20}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Próg</span>
                  <select
                    name="min_severity"
                    defaultValue={notif?.min_severity ?? "high"}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="high">Tylko wysoki</option>
                    <option value="medium">Wysoki + średni</option>
                  </select>
                </label>
              </div>

              <div className="flex gap-2">
                <Button type="submit" size="sm" className="w-fit">
                  Zapisz powiadomienia
                </Button>
                <TestAlertButton clientSlug={params.clientSlug} />
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
