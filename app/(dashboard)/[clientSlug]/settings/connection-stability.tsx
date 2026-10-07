import { CheckCircle2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { decrypt } from "@/lib/integrations/encryption";
import {
  googleOAuthClientInfo,
  googleOAuthClientsShared,
} from "@/lib/integrations/google-identity";
import { getServiceAccountEmail } from "@/lib/integrations/ga4";
import { createAdminClient } from "@/lib/supabase/admin";

import { CHECKBOX_CLASS } from "./form-styles";
import { saveMetaSystemToken, shareMetaSystemToken } from "./meta-token-actions";
import { SettingsHeading } from "./settings-heading";

type Creds = Record<string, unknown>;

function readCreds(encrypted: unknown): Creds | null {
  if (typeof encrypted !== "string" || !encrypted) return null;
  try {
    return JSON.parse(decrypt(encrypted)) as Creds;
  } catch {
    return null;
  }
}

/**
 * Why integrations disconnect, per provider, and the one-time fix for each.
 * Tokens expiring is not a bug we can retry around: Google drops refresh
 * tokens after 7 days while the OAuth app is in "Testing", Meta user tokens
 * last ~60 days, and both die at once when the agency person changes their
 * password. Each has a permanent fix; this card makes it a two-minute job
 * instead of reconnecting every client forever.
 */
export async function ConnectionStability({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const { data: rows } = await createAdminClient()
    .from("integrations")
    .select("provider, credentials_encrypted")
    .eq("client_id", clientId)
    .in("provider", ["meta_ads", "google_ads", "ga4"]);
  const byProvider = new Map((rows ?? []).map((r) => [r.provider as string, r]));

  const metaRow = byProvider.get("meta_ads");
  const metaCreds = readCreds(metaRow?.credentials_encrypted);
  const metaConnected = !!metaCreds;
  const metaIsSystem = metaCreds?.kind === "system_user";
  const metaExpiresAt =
    typeof metaCreds?.expires_at === "string" ? new Date(metaCreds.expires_at) : null;
  const metaIdentity = metaCreds?.identity as { id?: string; name?: string | null } | undefined;
  const metaDaysLeft = metaExpiresAt
    ? Math.ceil((metaExpiresAt.getTime() - Date.now()) / 86_400_000)
    : null;
  const metaPermanent = metaConnected && metaExpiresAt === null;
  const metaAppId = process.env.META_APP_ID?.trim() || null;

  const googleEmail = (provider: string): string | null => {
    const c = readCreds(byProvider.get(provider)?.credentials_encrypted);
    if (c?.mode === "service_account") return "konto usługi (nie wygasa)";
    return typeof c?.account_email === "string" ? c.account_email : null;
  };
  const adsLogin = byProvider.has("google_ads") ? googleEmail("google_ads") : null;
  const ga4Login = byProvider.has("ga4") ? googleEmail("ga4") : null;
  const googleClients = googleOAuthClientInfo();
  const googleShared = googleOAuthClientsShared();
  const serviceAccountEmail = getServiceAccountEmail();

  return (
    <div id="polaczenia" className="scroll-mt-32 space-y-4">
      <SettingsHeading
        kicker="Ustawienia · Tokeny"
        title="Połączenia bez rozłączeń"
        description="Integracje rozłączają się, bo wygasają tokeny dostępu - zwykle wszystkie naraz, bo każdy klient jest podpięty tym samym prywatnym logowaniem. To ustawienie po stronie Google i Mety, nie błąd panelu. Każde da się naprawić raz, na stałe."
      />

      <div className="grid max-w-4xl gap-4 md:grid-cols-2">
        {/* Meta */}
        <Card id="meta-system-token" className="scroll-mt-32">
          <CardContent className="space-y-3 pt-6 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">Meta Ads</p>
              {metaPermanent ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-positive">
                  <CheckCircle2 className="h-3.5 w-3.5" /> nie wygasa
                </span>
              ) : metaDaysLeft !== null ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  wygasa za {Math.max(0, metaDaysLeft)} {metaDaysLeft === 1 ? "dzień" : "dni"}
                </span>
              ) : null}
            </div>
            {metaIdentity?.id ? (
              <p className="text-xs text-muted-foreground">
                Połączone jako: {metaIdentity.name ?? "?"} (ID {metaIdentity.id})
              </p>
            ) : null}
            {metaPermanent ? (
              <>
                <p className="text-muted-foreground">
                  {metaIsSystem
                    ? "Połączona tokenem System User bez daty ważności. Nic więcej nie trzeba robić."
                    : "Token nie ma daty ważności."}
                </p>
                {metaIsSystem ? (
                  <form action={shareMetaSystemToken} className="space-y-1.5">
                    <input type="hidden" name="client" value={clientSlug} />
                    <Button type="submit" variant="outline" size="pill" className="w-fit">
                      Użyj tego tokenu u wszystkich klientów
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Sprawdzimy każde wybrane konto reklamowe innych klientów i podmienimy
                      token tylko tam, gdzie ma do niego dostęp.
                    </p>
                  </form>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Zwykłe logowanie daje token na ~60 dni i ginie od razu, gdy ktoś zmieni
                  hasło do Facebooka (błąd „The session has been invalidated”). Token{" "}
                  <b>System User</b> z Business Managera nie wygasa i nie zależy od niczyjego
                  hasła:
                </p>
                <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>
                    business.facebook.com → <b>Ustawienia firmy</b> (Business Settings) →{" "}
                    <b>Użytkownicy</b> → <b>Użytkownicy systemu</b> → <b>Dodaj</b> → rola{" "}
                    <b>Administrator</b>.
                  </li>
                  <li>
                    <b>Przypisz zasoby</b> (Add assets) → <b>Konta reklamowe</b> → zaznacz
                    konta klientów → uprawnienie <b>„Wyświetlanie wyników”</b> (View
                    performance).
                  </li>
                  <li>
                    <b>Wygeneruj token</b> → aplikacja: <b>nasza aplikacja panelu</b>
                    {metaAppId ? <> (App ID {metaAppId})</> : null} → wygasanie:{" "}
                    <b>Nigdy</b> → uprawnienia <code>ads_read</code> i{" "}
                    <code>business_management</code>.
                  </li>
                  <li>
                    Skopiuj token i wklej poniżej. Wybrane konta zostaną zachowane.
                  </li>
                </ol>
                <form action={saveMetaSystemToken} className="flex flex-col gap-2 pt-1">
                  <input type="hidden" name="client" value={clientSlug} />
                  <input
                    name="token"
                    type="password"
                    autoComplete="off"
                    placeholder="Token System User (EAA...)"
                    className="h-11 rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] px-3 text-sm"
                  />
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      name="apply_all"
                      defaultChecked
                      className={`mt-px ${CHECKBOX_CLASS}`}
                    />
                    <span>
                      Zastosuj też u wszystkich innych klientów, do których kont reklamowych
                      ten token ma dostęp (sprawdzamy każde konto przed podmianą).
                    </span>
                  </label>
                  <Button type="submit" size="pill" className="w-fit">
                    Zapisz token na stałe
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>

        {/* Google */}
        <Card id="google-stability" className="scroll-mt-32">
          <CardContent className="space-y-3 pt-6 text-sm">
            <p className="font-semibold">Google Analytics 4 i Google Ads</p>
            {adsLogin || ga4Login ? (
              <p className="text-xs text-muted-foreground">
                {adsLogin ? <>Google Ads połączone jako: {adsLogin}. </> : null}
                {ga4Login ? <>GA4: {ga4Login}.</> : null}
              </p>
            ) : null}
            <p className="text-muted-foreground">
              Jeśli Google rozłącza się co ~7 dni, aplikacja OAuth jest w trybie{" "}
              <b>Testing</b> - Google kasuje wtedy tokeny po tygodniu. Jednorazowa
              zmiana w Google Cloud Console:
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                console.cloud.google.com → wybierz projekt o numerze z ramki poniżej →{" "}
                <b>APIs &amp; Services</b> → <b>OAuth consent screen</b>.
              </li>
              <li>
                Jeśli łączycie konta z domeny patoagencja.com w Google Workspace:
                ustaw <b>User type: Internal</b> - bez weryfikacji, tokeny nie wygasają.
              </li>
              <li>
                W innym razie: <b>Publishing status → Publish app</b> (In production).
                Google może pokazać ekran „niezweryfikowana aplikacja” - dla
                wewnętrznego użytku agencji można go przejść.
              </li>
              <li>
                Połącz Google ponownie jeden raz - panel sam podmieni token u wszystkich
                klientów podpiętych tym samym kontem Google.
              </li>
            </ol>

            <div className="space-y-1 rounded-[18px] bg-chip p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Klient OAuth używany przez panel</p>
              {googleClients.map((c) => (
                <p key={c.envVar} className="break-all">
                  <code>{c.envVar}</code>:{" "}
                  {c.clientId ? (
                    <>
                      {c.clientId}
                      {c.projectNumber ? <> · numer projektu {c.projectNumber}</> : null}
                    </>
                  ) : (
                    <span className="text-warning">nie ustawiono</span>
                  )}
                </p>
              ))}
              <p>
                {googleShared
                  ? "Google Ads i GA4 używają tego samego klienta OAuth - jedno połączenie naprawia oba."
                  : "Google Ads i GA4 używają różnych klientów OAuth - każdy łączy się osobno (i każdy projekt trzeba opublikować)."}
              </p>
            </div>

            <p className="text-muted-foreground">
              GA4 może też działać bez logowania:{" "}
              <a
                href={`/${clientSlug}/settings/ga4-service-account`}
                className="font-medium text-foreground underline underline-offset-2"
              >
                połącz przez konto usługi (nie wygasa)
              </a>
              {serviceAccountEmail ? null : " - wymaga zmiennej GOOGLE_SERVICE_ACCOUNT_JSON"}.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
