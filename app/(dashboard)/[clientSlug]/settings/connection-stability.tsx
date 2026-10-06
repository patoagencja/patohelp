import { CheckCircle2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsHeading } from "./settings-heading";
import { decrypt } from "@/lib/integrations/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

import { saveMetaSystemToken } from "./meta-token-actions";

/**
 * Why integrations disconnect, per provider, and the one-time fix for each.
 * Tokens expiring is not a bug we can retry around: Google drops refresh
 * tokens after 7 days while the OAuth app is in "Testing", and Meta user
 * tokens last ~60 days. Both have a permanent fix; this card makes it a
 * two-minute job instead of reconnecting forever.
 */
export async function ConnectionStability({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const { data: meta } = await createAdminClient()
    .from("integrations")
    .select("credentials_encrypted")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .maybeSingle();

  let metaExpiresAt: Date | null = null;
  let metaIsSystem = false;
  let metaConnected = false;
  if (meta?.credentials_encrypted) {
    try {
      const creds = JSON.parse(decrypt(meta.credentials_encrypted as string)) as {
        expires_at?: string | null;
        kind?: string;
      };
      metaConnected = true;
      metaIsSystem = creds.kind === "system_user";
      metaExpiresAt = creds.expires_at ? new Date(creds.expires_at) : null;
    } catch {
      // unreadable credentials - treat as not connected
    }
  }
  const metaDaysLeft = metaExpiresAt
    ? Math.ceil((metaExpiresAt.getTime() - Date.now()) / 86_400_000)
    : null;
  const metaPermanent = metaConnected && metaExpiresAt === null;

  return (
    <div id="polaczenia" className="scroll-mt-32 space-y-4">
      <SettingsHeading
        kicker="Ustawienia · Tokeny"
        title="Połączenia bez rozłączeń"
        description="Integracje rozłączają się, bo wygasają tokeny dostępu - to ustawienie po stronie Google i Mety, nie błąd panelu. Każde da się naprawić raz, na stałe."
      />

      <div className="grid max-w-4xl gap-4 md:grid-cols-2">
        {/* Meta */}
        <Card>
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
            {metaPermanent ? (
              <p className="text-muted-foreground">
                {metaIsSystem
                  ? "Połączona tokenem System User bez daty ważności. Nic więcej nie trzeba robić."
                  : "Token nie ma daty ważności."}
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Zwykłe logowanie daje token na ~60 dni. Token <b>System User</b> z
                  Business Managera nie wygasa nigdy:
                </p>
                <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>
                    business.facebook.com → Ustawienia firmy → Użytkownicy →{" "}
                    <b>Użytkownicy systemu</b> → Dodaj (rola: Administrator).
                  </li>
                  <li>
                    <b>Przypisz zasoby</b> → konta reklamowe klienta → „Zarządzanie
                    kampaniami” lub „Wyświetlanie wyników”.
                  </li>
                  <li>
                    <b>Wygeneruj token</b> → wybierz aplikację panelu → wygasanie:{" "}
                    <b>Nigdy</b> → uprawnienia <code>ads_read</code>,{" "}
                    <code>read_insights</code>.
                  </li>
                  <li>Wklej token poniżej. Wybrane konta zostaną zachowane.</li>
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
                  <Button type="submit" size="pill" className="w-fit">
                    Zapisz token na stałe
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>

        {/* Google */}
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p className="font-semibold">Google Analytics 4 i Google Ads</p>
            <p className="text-muted-foreground">
              Jeśli Google rozłącza się co ~7 dni, aplikacja OAuth jest w trybie{" "}
              <b>Testing</b> - Google kasuje wtedy tokeny po tygodniu. Jednorazowa
              zmiana w Google Cloud Console (dla obu aplikacji: GA4 i Google Ads):
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                console.cloud.google.com → wybierz projekt aplikacji → <b>APIs &amp;
                Services</b> → <b>OAuth consent screen</b>.
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
                Połącz GA4 i Google Ads ponownie jeden raz (link w banerze lub
                powyżej) - od tej chwili token nie wygasa.
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
