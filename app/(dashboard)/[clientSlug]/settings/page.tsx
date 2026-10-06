import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

import { SettingsHeading } from "./settings-heading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getClientWebsite } from "@/lib/branding/website";
import { getClientBranding } from "@/lib/dashboard/branding";
import { getClientBySlug } from "@/lib/dashboard/context";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { IntegrationProvider } from "@/lib/types";

import { AccessSettingsSection } from "./access-settings";
import { BrandingSettingsSection } from "./branding-settings";
import { ConnectedToast } from "./connected-toast";
import { ConnectionStability } from "./connection-stability";
import { EcomSettingsSection } from "./ecom-settings";
import { GoalsSettingsSection } from "./goals-settings";
import { CHECKBOX_CLASS } from "./form-styles";
import { SettingsNav } from "./settings-nav";
import { ShareOverviewSection } from "./share-overview";
import { TestAlertButton } from "./test-alert-button";
import { TestConnectionButton } from "./test-connection-button";

// Always render fresh so the account selection reflects the latest save.
export const dynamic = "force-dynamic";
// "Pobierz ze strony" (branding Server Action) fetches the client's site:
// page + manifest + image checks, each capped at 8 s.
export const maxDuration = 60;

interface Account {
  id: string;
  name?: string;
  selected?: boolean;
  video_only?: boolean;
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

  const videoOnly = formData.get("video_only") === "on";
  const accounts = ((data?.account_ids ?? []) as Account[]).map((a) => ({
    ...a,
    selected: selectedIds.includes(String(a.id)),
    // Google-only flag: report just YouTube (VIDEO) campaigns.
    ...(provider === "google_ads" ? { video_only: videoOnly } : {}),
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
      // Kick the sync and stop waiting after a few seconds - the cron endpoint
      // is its own invocation and runs to completion in the background.
      await fetch(`${base}/api/cron/${job}?client=${access.clientId}`, {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
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

  // Caps are entered in PLN, stored in grosze. Empty / 0 = no cap (null).
  const capToMinor = (v: FormDataEntryValue | null) => {
    const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  };
  const rawMult = Number(formData.get("spike_multiplier") ?? 3);
  const multiplier = Number.isFinite(rawMult) && rawMult >= 1.5 ? rawMult : 3;

  const admin = createAdminClient();
  await admin.from("notification_settings").upsert(
    {
      client_id: access.clientId,
      email_enabled: formData.get("email_enabled") === "on",
      emails: parseList(formData.get("emails")),
      whatsapp_enabled: formData.get("whatsapp_enabled") === "on",
      whatsapp_numbers: parseList(formData.get("whatsapp_numbers")),
      telegram_enabled: formData.get("telegram_enabled") === "on",
      telegram_chat_ids: parseList(formData.get("telegram_chat_ids")),
      hour_start: clamp(Number(formData.get("hour_start") ?? 8)),
      hour_end: clamp(Number(formData.get("hour_end") ?? 20)),
      min_severity:
        String(formData.get("min_severity")) === "medium" ? "medium" : "high",
      daily_spend_cap_minor_units: capToMinor(formData.get("campaign_cap")),
      account_daily_spend_cap_minor_units: capToMinor(
        formData.get("account_cap")
      ),
      spike_multiplier: multiplier,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" }
  );

  // Separate write on purpose: the weekly-digest columns arrive with migration
  // 0022, and folding them into the upsert above would make the whole save
  // fail before it's applied. The row exists now, so a failure here (missing
  // column) only drops the digest toggle.
  await admin
    .from("notification_settings")
    .update({
      weekly_digest_enabled: formData.get("weekly_digest_enabled") === "on",
      weekly_digest_emails: parseList(formData.get("weekly_digest_emails")),
    })
    .eq("client_id", access.clientId);

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
      "email_enabled, emails, whatsapp_enabled, whatsapp_numbers, telegram_enabled, telegram_chat_ids, hour_start, hour_end, min_severity, daily_spend_cap_minor_units, account_daily_spend_cap_minor_units, spike_multiplier"
    )
    .eq("client_id", access.clientId)
    .maybeSingle();

  // Read apart from the main settings so a missing 0022 migration can't blank
  // out the alert form; an error just hides the digest toggle.
  const digestRes = await createAdminClient()
    .from("notification_settings")
    .select("weekly_digest_enabled, weekly_digest_emails")
    .eq("client_id", access.clientId)
    .maybeSingle();
  const digestAvailable = !digestRes.error;
  const digest = (digestRes.data ?? null) as {
    weekly_digest_enabled?: boolean;
    weekly_digest_emails?: string[] | null;
  } | null;

  const byProvider = new Map(
    (integrations ?? []).map((row) => [row.provider as string, row])
  );

  // Defensive: client_type arrives with migration 0016.
  const { data: ct } = await createAdminClient()
    .from("clients")
    .select("client_type")
    .eq("id", access.clientId)
    .maybeSingle();
  const isEcommerce =
    (ct as { client_type?: string } | null)?.client_type === "ecommerce";

  // Separate read so a missing 0031 migration only disables this section.
  const [branding, brandedClient, website] = await Promise.all([
    getClientBranding(createAdminClient(), access.clientId),
    getClientBySlug(params.clientSlug),
    getClientWebsite(createAdminClient(), access.clientId),
  ]);

  return (
    <div className="space-y-12 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      <ConnectedToast
        clientSlug={params.clientSlug}
        connected={searchParams.connected}
        error={searchParams.error}
        saved={searchParams.saved}
      />

      <div className="space-y-4">
        <PageHeader
          eyebrow={brandedClient?.name ?? params.clientSlug.toUpperCase()}
          title="Ustawienia"
          description="Integracje, cele, powiadomienia i dostęp tego klienta. Widzi je tylko agencja."
        />

        {/* The page grew to eight sections; jump links beat scrolling, and
            the bar stays put and marks where you are. */}
        <SettingsNav
          links={[
            { id: "integracje", label: "Integracje" },
            { id: "polaczenia", label: "Połączenia" },
            ...(isEcommerce
              ? [{ id: "ecommerce", label: "Marża i cele" }]
              : [{ id: "cele", label: "Cele miesięczne" }]),
            { id: "powiadomienia", label: "Powiadomienia" },
            { id: "wyglad", label: "Wygląd panelu" },
            { id: "udostepnianie", label: "Link dla zarządu" },
            { id: "dostep", label: "Dostęp" },
          ]}
        />
      </div>

      <section id="integracje" aria-label="Integracje" className="scroll-mt-32 space-y-4">
        <SettingsHeading
          kicker="Ustawienia · Integracje"
          title="Integracje"
          description="Połącz konta reklamowe i zaznacz, które należą do tego klienta."
        />
        <div className="grid gap-4 md:grid-cols-2">
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
                      <CheckCircle2 className="h-4 w-4 text-positive" />
                    ) : null}
                  </CardTitle>
                  <CardDescription>{provider.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {connected ? (
                    <>
                      <p className="flex items-center gap-1.5 text-sm text-foreground">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" aria-hidden />
                        Połączono · wybrano {selectedCount} z {accounts.length}{" "}
                        {accounts.length === 1 ? "konta" : "kont"}
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
                        <div className="max-h-64 space-y-1 overflow-y-auto rounded-2xl bg-muted/50 p-2">
                          {accounts.map((account) => (
                            <label
                              key={account.id}
                              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                            >
                              <input
                                type="checkbox"
                                name="account"
                                value={account.id}
                                defaultChecked={account.selected}
                                className={CHECKBOX_CLASS}
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
                        {provider.key === "google_ads" ? (
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="video_only"
                              defaultChecked={accounts.some(
                                (a) => a.selected && a.video_only
                              )}
                              className={CHECKBOX_CLASS}
                            />
                            Tylko kampanie YouTube (VIDEO)
                            <span className="text-xs text-muted-foreground">
                              - gdy resztę konta prowadzi inna agencja
                            </span>
                          </label>
                        ) : null}
                        <Button type="submit" size="pill" className="w-fit">
                          Zapisz wybór kont
                        </Button>
                      </form>

                      <div className="flex flex-wrap gap-2">
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
                            size="pill"
                            className="text-destructive hover:bg-negative-soft hover:text-destructive"
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

        <div className="grid gap-4 md:grid-cols-2">
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
                      <CheckCircle2 className="h-4 w-4 text-positive" />
                    ) : null}
                  </CardTitle>
                  <CardDescription>
                    Ruch na stronie: źródła, urządzenia, podstrony.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {connected ? (
                    <>
                      {ga4Ids.propertyId ? (
                        <p className="flex items-center gap-1.5 text-sm text-foreground">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" aria-hidden />
                          <span className="min-w-0 break-words">
                            Połączono · usługa {propName ?? ga4Ids.propertyId}
                          </span>
                        </p>
                      ) : (
                        <p className="flex items-center gap-1.5 text-sm text-warning">
                          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                          Połączono, ale nie wybrano usługi GA4
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <TestConnectionButton
                          provider="ga4"
                          clientSlug={params.clientSlug}
                        />
                        {multi ? (
                          <Button asChild variant="outline" size="pill">
                            <a href={`/${params.clientSlug}/settings/ga4-select`}>
                              Zmień usługę GA4
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
                            size="pill"
                            className="text-destructive hover:bg-negative-soft hover:text-destructive"
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
      </section>

      <ConnectionStability clientId={access.clientId} clientSlug={params.clientSlug} />

      {isEcommerce ? (
        <EcomSettingsSection clientId={access.clientId} clientSlug={params.clientSlug} />
      ) : (
        <GoalsSettingsSection clientId={access.clientId} clientSlug={params.clientSlug} />
      )}

      {/* Alert notifications */}
      <div id="powiadomienia" className="scroll-mt-32 space-y-4">
        <SettingsHeading
          kicker="Ustawienia · Alerty"
          title="Powiadomienia o alertach"
          description="Wysyłamy alerty (anomalie + „cel zagrożony”) na wskazane kanały, tylko w wybranych godzinach. Jeden alert = maks. raz dziennie."
        />

        <Card className="max-w-2xl">
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
                    className={CHECKBOX_CLASS}
                  />
                  E-mail
                </label>
                <textarea
                  name="emails"
                  rows={2}
                  placeholder="adresy oddzielone przecinkiem lub nową linią"
                  defaultValue={(notif?.emails ?? []).join(", ")}
                  className="rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] p-3 text-sm"
                />
              </div>

              {/* WhatsApp */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="whatsapp_enabled"
                    defaultChecked={notif?.whatsapp_enabled ?? false}
                    className={CHECKBOX_CLASS}
                  />
                  WhatsApp
                </label>
                <textarea
                  name="whatsapp_numbers"
                  rows={2}
                  placeholder="numery z kierunkowym, np. +48600100200"
                  defaultValue={(notif?.whatsapp_numbers ?? []).join(", ")}
                  className="rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] p-3 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Wymaga skonfigurowania WhatsApp Business API (token + numer).
                </p>
              </div>

              {/* Telegram */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="telegram_enabled"
                    defaultChecked={notif?.telegram_enabled ?? false}
                    className={CHECKBOX_CLASS}
                  />
                  Telegram
                </label>
                <textarea
                  name="telegram_chat_ids"
                  rows={2}
                  placeholder="chat ID, np. 123456789 lub -1001234567890 (grupa)"
                  defaultValue={(notif?.telegram_chat_ids ?? []).join(", ")}
                  className="rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] p-3 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Napisz do bota{" "}
                  <code className="rounded bg-muted px-1">/start</code>, potem
                  pobierz chat ID (np. przez @userinfobot). Wymaga
                  TELEGRAM_BOT_TOKEN na serwerze.
                </p>
              </div>

              {/* Weekly digest e-mail */}
              <div className="flex flex-col gap-2 rounded-2xl bg-lime-soft/60 p-4">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="weekly_digest_enabled"
                    defaultChecked={digest?.weekly_digest_enabled ?? false}
                    disabled={!digestAvailable}
                    className={CHECKBOX_CLASS}
                  />
                  Wysyłaj co poniedziałek podsumowanie tygodnia
                </label>
                <p className="text-xs text-muted-foreground">
                  E-mail „Twój tydzień w skrócie” w poniedziałek rano: najważniejsze
                  liczby z poprzedniego tygodnia prostym językiem, dobre wiadomości,
                  rekordy i przycisk do panelu.{" "}
                  <a
                    href={`/${params.clientSlug}/settings/digest-preview`}
                    className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Zobacz podgląd maila
                  </a>
                </p>
                <textarea
                  name="weekly_digest_emails"
                  rows={2}
                  disabled={!digestAvailable}
                  placeholder="odbiorcy podsumowania (puste = adresy z pola E-mail powyżej)"
                  defaultValue={(digest?.weekly_digest_emails ?? []).join(", ")}
                  className="rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] p-3 text-sm"
                />
                {!digestAvailable ? (
                  <p className="text-xs text-warning">
                    Wymaga migracji 0022_weekly_digest.sql w Supabase.
                  </p>
                ) : null}
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
                    className="h-11 rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] px-3 text-sm"
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
                    className="h-11 rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] px-3 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Które alerty</span>
                  <select
                    name="min_severity"
                    defaultValue={notif?.min_severity ?? "high"}
                    className="h-11 rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] px-3 text-sm"
                  >
                    <option value="high">Pilne i ważne</option>
                    <option value="medium">Wszystkie (także informacje)</option>
                  </select>
                </label>
              </div>

              {/* Budget-spike thresholds */}
              <div className="rounded-2xl bg-negative-soft/60 p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium text-negative">
                  <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                  Alerty budżetowe (skok wydatków)
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Wysyłane natychmiast, także poza godzinami ciszy. Zostaw puste,
                  by użyć auto-wykrywania (dzień ≥ {""}
                  {notif?.spike_multiplier ?? 3}x średniej dziennej).
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">
                      Limit / kampania / dzień (zł)
                    </span>
                    <input
                      type="number"
                      name="campaign_cap"
                      min="0"
                      step="any"
                      placeholder="np. 10000"
                      defaultValue={
                        notif?.daily_spend_cap_minor_units
                          ? Number(notif.daily_spend_cap_minor_units) / 100
                          : ""
                      }
                      className="h-11 rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] px-3 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">
                      Limit / całe konto / dzień (zł)
                    </span>
                    <input
                      type="number"
                      name="account_cap"
                      min="0"
                      step="any"
                      placeholder="np. 50000"
                      defaultValue={
                        notif?.account_daily_spend_cap_minor_units
                          ? Number(notif.account_daily_spend_cap_minor_units) /
                            100
                          : ""
                      }
                      className="h-11 rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] px-3 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">
                      Czułość (x średniej)
                    </span>
                    <input
                      type="number"
                      name="spike_multiplier"
                      min="1.5"
                      step="0.5"
                      placeholder="3"
                      defaultValue={notif?.spike_multiplier ?? 3}
                      className="h-11 rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] px-3 text-sm"
                    />
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="pill" className="w-fit">
                  Zapisz powiadomienia
                </Button>
                <TestAlertButton clientSlug={params.clientSlug} />
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <BrandingSettingsSection
        clientSlug={params.clientSlug}
        clientName={brandedClient?.name ?? params.clientSlug.toUpperCase()}
        available={branding.available}
        initialLogoUrl={branding.logoUrl}
        initialBrandColor={branding.brandColor}
        websiteAvailable={website.available}
        initialWebsiteUrl={website.websiteUrl}
        websiteSuggestion={website.suggestion}
      />

      <ShareOverviewSection clientId={access.clientId} clientSlug={params.clientSlug} />

      <AccessSettingsSection clientId={access.clientId} clientSlug={access.clientSlug} />
    </div>
  );
}
