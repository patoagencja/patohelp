import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { decrypt } from "@/lib/integrations/encryption";
import {
  getServiceAccountEmail,
  isServiceAccountCredentials,
  type Ga4Property,
} from "@/lib/integrations/ga4";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

import { CopyTextButton } from "../copy-text-button";
import { FIELD_CLASS } from "../form-styles";
import { saveGa4ServiceAccount } from "../ga4-service-account-actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  ga4_sa_property: "Podaj numer usługi GA4 - same cyfry, np. 312345678.",
  ga4_sa_missing:
    "Na serwerze brakuje zmiennej GOOGLE_SERVICE_ACCOUNT_JSON (albo jest nieczytelna) - zobacz kroki poniżej.",
  ga4_sa_denied:
    "Konto usługi nie ma jeszcze dostępu do tej usługi GA4. Sprawdź, czy dodałeś jego e-mail jako Wyświetlający (Viewer) w TEJ usłudze i czy numer usługi się zgadza. Dostęp działa zwykle od razu, czasem po kilku minutach.",
  ga4_sa_taken:
    "Ta usługa GA4 jest już podpięta u innego klienta. Sprawdź numer - jedna usługa może należeć tylko do jednego klienta.",
};

/**
 * GA4 through the agency's service account: no refresh token, nothing to
 * expire and no dependency on anyone's Google password or the OAuth app's
 * Testing mode. The client (or we) add one email as Viewer on the property.
 */
export default async function Ga4ServiceAccountPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { error?: string };
}) {
  const access = await requireAgencyClientAccess(params.clientSlug);
  if (!access.ok) {
    redirect(access.status === 401 ? "/login" : `/${params.clientSlug}`);
  }

  const email = getServiceAccountEmail();

  const { data } = await createAdminClient()
    .from("integrations")
    .select("account_ids, credentials_encrypted")
    .eq("client_id", access.clientId)
    .eq("provider", "ga4")
    .maybeSingle();
  const accountIds = (data?.account_ids ?? {}) as {
    propertyId?: string | null;
    properties?: Ga4Property[];
  };
  let usesServiceAccount = false;
  if (data?.credentials_encrypted) {
    try {
      usesServiceAccount = isServiceAccountCredentials(
        JSON.parse(decrypt(data.credentials_encrypted as string))
      );
    } catch {
      // unreadable credentials - just don't claim service-account mode
    }
  }
  const properties = accountIds.properties ?? [];
  const errorText = searchParams.error ? ERRORS[searchParams.error] : null;

  return (
    <div className="space-y-6 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      <Link
        href={`/${params.clientSlug}/settings#integracje`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-chip px-4 text-sm text-ink-2 transition-colors hover:bg-[var(--chip-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Wróć do ustawień
      </Link>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            GA4 przez konto usługi
            {usesServiceAccount ? (
              <CheckCircle2 className="h-4 w-4 text-positive" aria-hidden />
            ) : null}
          </CardTitle>
          <CardDescription>
            Połączenie, które nie wygasa: zamiast logowania kontem Google (token
            ginie przy zmianie hasła albo po 7 dniach w trybie Testing) panel
            czyta GA4 przez techniczne konto usługi agencji.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          {errorText ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[18px] bg-warning-soft p-3.5 text-foreground"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              {errorText}
            </p>
          ) : null}

          {usesServiceAccount ? (
            <p className="flex items-center gap-1.5 text-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" aria-hidden />
              Ten klient już korzysta z konta usługi (usługa {accountIds.propertyId ?? "-"}).
              Możesz zmienić usługę poniżej.
            </p>
          ) : null}

          {email ? (
            <>
              <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                <li>
                  Skopiuj e-mail konta usługi:
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <code className="break-all rounded-[10px] bg-chip px-2.5 py-1.5 text-foreground">
                      {email}
                    </code>
                    <CopyTextButton text={email} />
                  </span>
                </li>
                <li>
                  W GA4 klienta: <b>Administracja</b> → (kolumna Usługa){" "}
                  <b>Zarządzanie dostępem do usługi</b> → <b>+</b> →{" "}
                  <b>Dodaj użytkowników</b> → wklej e-mail → rola{" "}
                  <b>Wyświetlający (Viewer)</b> → odznacz powiadomienie e-mailem →{" "}
                  <b>Dodaj</b>. Może to zrobić klient albo ktoś z agencji z rolą
                  Administratora w tej usłudze.
                </li>
                <li>
                  Numer usługi: <b>Administracja</b> → <b>Szczegóły usługi</b> →{" "}
                  „Identyfikator usługi” (same cyfry, np. 312345678).
                </li>
                <li>Wpisz go poniżej - sprawdzimy dostęp małym raportem i zapiszemy.</li>
              </ol>

              <form action={saveGa4ServiceAccount} className="flex flex-col gap-3">
                <input type="hidden" name="client" value={params.clientSlug} />
                <label className="flex flex-col gap-1.5">
                  <span className="kick">Identyfikator usługi GA4</span>
                  <input
                    name="propertyId"
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    list="ga4-known-properties"
                    defaultValue={accountIds.propertyId ?? ""}
                    placeholder="np. 312345678"
                    className={`${FIELD_CLASS} max-w-xs`}
                  />
                  {properties.length ? (
                    <datalist id="ga4-known-properties">
                      {properties.map((p) => (
                        <option key={p.propertyId} value={p.propertyId}>
                          {p.displayName}
                        </option>
                      ))}
                    </datalist>
                  ) : null}
                </label>
                <Button type="submit" size="pill" className="w-fit">
                  Sprawdź dostęp i zapisz
                </Button>
                <p className="text-xs text-muted-foreground">
                  Zapis zastępuje logowanie kontem Google dla tego klienta. Wybrana
                  usługa i historia danych zostają.
                </p>
              </form>
            </>
          ) : (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 font-medium text-warning">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                Konto usługi nie jest jeszcze skonfigurowane na serwerze.
              </p>
              <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
                <li>
                  console.cloud.google.com → projekt panelu → <b>IAM i administracja</b> →{" "}
                  <b>Konta usługi</b> → <b>Utwórz konto usługi</b> (bez ról w projekcie).
                </li>
                <li>
                  Na koncie usługi: <b>Klucze</b> → <b>Dodaj klucz</b> → <b>Utwórz nowy klucz</b>{" "}
                  → JSON (plik pobierze się na dysk).
                </li>
                <li>
                  W tym projekcie włącz <b>Google Analytics Data API</b> i{" "}
                  <b>Google Analytics Admin API</b> (APIs &amp; Services → Library).
                </li>
                <li>
                  Vercel → projekt → Settings → Environment Variables → dodaj{" "}
                  <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> = cała zawartość pliku JSON →
                  Redeploy.
                </li>
                <li>Wróć tutaj - pojawi się e-mail do dodania w GA4.</li>
              </ol>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
