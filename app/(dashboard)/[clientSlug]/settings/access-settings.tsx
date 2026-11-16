import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { allowedLoginDomains, clientLoginEnabled, isShareViewerEmail } from "@/lib/auth/login-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateWarsaw } from "@/lib/utils";

import {
  cancelClientInvitation,
  inviteClientUser,
  removeClientUserAccess,
} from "./access-actions";
import { AccessRemoveButton } from "./access-remove-button";
import { revokeShareLink } from "./share-link-actions";
import { ShareLinkCreator } from "./share-link-creator";
import { CHECKBOX_CLASS } from "./form-styles";
import { SettingsHeading } from "./settings-heading";

interface AccessUserRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

// Last-sign-in lookups are one Auth API call per person; a client panel has a
// handful of users, so cap it rather than slow the settings page for outliers.
const SIGN_IN_LOOKUP_LIMIT = 25;

/**
 * "Dostęp do panelu": who can log into THIS client's dashboard, plus a form to
 * grant/revoke client access. Rendered only inside the settings page (already
 * behind requireAgencyClientAccess); every action re-checks it. Reads go
 * through the service-role client, so each query is pinned to `clientId`,
 * which the page took from the verified guard result.
 */
export async function AccessSettingsSection({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const admin = createAdminClient();
  const [usersRes, invitesRes] = await Promise.all([
    admin
      .from("users")
      .select("id, email, role, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
    admin
      .from("client_invitations")
      .select("id, email, role, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
  ]);

  const allUsers = (usersRes.data ?? []) as AccessUserRow[];
  // Password-link accounts get their own list below, not the people list.
  const links = allUsers.filter((u) => isShareViewerEmail(u.email));
  const users = allUsers.filter((u) => !isShareViewerEmail(u.email));
  const userEmails = new Set(users.map((u) => u.email.toLowerCase()));
  // An invitation whose person already shows up above is just the mapping
  // record, not something still waiting.
  const pending = ((invitesRes.data ?? []) as InvitationRow[]).filter(
    (i) => !userEmails.has(i.email.toLowerCase())
  );

  // The invitation creates the account before the person ever clicks the
  // link, so "has a row" doesn't mean "has logged in" - show the difference.
  const lastSignIn = new Map<string, string | null>();
  await Promise.all(
    [...users, ...links].slice(0, SIGN_IN_LOOKUP_LIMIT).map(async (u) => {
      const { data } = await admin.auth.admin.getUserById(u.id);
      if (data?.user) lastSignIn.set(u.id, data.user.last_sign_in_at ?? null);
    })
  );

  return (
    <div id="dostep" className="scroll-mt-32 space-y-4">
      <SettingsHeading
        kicker="Ustawienia · Dostęp"
        title="Dostęp do panelu"
        description="Klient loguje się linkiem z e-maila - bez hasła. Widzi tylko swój panel."
      />

      <Card className="max-w-2xl">
        <CardContent className="flex flex-col gap-5 pt-6">
          {allowedLoginDomains() !== "*" ? (
            <p className="rounded-[16px] bg-chip px-4 py-3 text-sm text-ink-2">
              {clientLoginEnabled()
                ? `Zalogować się mogą adresy ${(allowedLoginDomains() as string[]).map((d) => `@${d}`).join(", ")} oraz osoby zaproszone tutaj - dowolną domeną, na stronie logowania swoim adresem. Nikt inny nie dostanie linku do logowania.`
                : `Logowanie e-mailem mają na razie tylko adresy ${(allowedLoginDomains() as string[]).map((d) => `@${d}`).join(", ")} - zaproszenia zadziałają po włączeniu CLIENT_LOGIN_ENABLED. Klientowi daj „Link z hasłem” poniżej.`}
            </p>
          ) : null}
          {invitesRes.error ? (
            <p className="text-sm text-muted-foreground">
              Uruchom w Supabase migrację{" "}
              <code className="rounded bg-muted px-1">0020_client_invitations.sql</code>,
              żeby zarządzać dostępem z panelu.
            </p>
          ) : (
            <form action={inviteClientUser} className="flex flex-col gap-3">
              <input type="hidden" name="client" value={clientSlug} />
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">E-mail osoby po stronie klienta</span>
                  <input
                    type="email"
                    name="email"
                    required
                    maxLength={254}
                    autoComplete="off"
                    placeholder="np. marketing@firma.pl"
                    className="h-11 rounded-[14px] border border-transparent bg-chip transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)] px-3 text-sm"
                  />
                </label>
                <Button type="submit" size="pill">
                  Nadaj dostęp
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="send_email"
                  defaultChecked
                  className={CHECKBOX_CLASS}
                />
                Wyślij e-mail z zaproszeniem
              </label>
              <p className="text-xs text-muted-foreground">
                Tu nadajesz wyłącznie dostęp klienta (tylko ten panel). Dostęp
                agencji do wszystkich klientów mają automatycznie adresy
                @patoagencja.com.
              </p>
            </form>
          )}

          {users.length === 0 && pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nikt po stronie klienta nie ma jeszcze dostępu.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[20px] bg-chip">
              {users.map((u) => {
                const isClient = u.role === "client";
                const signedIn = lastSignIn.get(u.id);
                return (
                  <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{u.email}</span>
                      <span className="text-xs text-muted-foreground">
                        {isClient ? "Klient" : "Agencja"} · dodano{" "}
                        {formatDateWarsaw(u.created_at, "d MMM yyyy")}
                        {lastSignIn.has(u.id)
                          ? signedIn
                            ? ` · ostatnie logowanie ${formatDateWarsaw(signedIn, "d MMM yyyy, HH:mm")}`
                            : " · jeszcze się nie zalogował(a)"
                          : ""}
                      </span>
                    </div>
                    {/* Agency accounts are managed outside a single client's
                        settings - no revoke button for them here. */}
                    {isClient ? (
                      <form action={removeClientUserAccess}>
                        <input type="hidden" name="client" value={clientSlug} />
                        <input type="hidden" name="user_id" value={u.id} />
                        <AccessRemoveButton label="Odbierz dostęp" />
                      </form>
                    ) : null}
                  </li>
                );
              })}
              {pending.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{i.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {i.role === "client" ? "Zaproszenie" : "Zaproszenie (agencja)"} ·
                      czeka na pierwsze logowanie · od{" "}
                      {formatDateWarsaw(i.created_at, "d MMM yyyy")}
                    </span>
                  </div>
                  {i.role === "client" ? (
                    <form action={cancelClientInvitation}>
                      <input type="hidden" name="client" value={clientSlug} />
                      <input type="hidden" name="invitation_id" value={i.id} />
                      <AccessRemoveButton label="Anuluj zaproszenie" />
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div>
            <p className="text-[15px] font-medium">Link z hasłem</p>
            <p className="mt-1 text-sm text-ink-2">
              Jeden adres i hasło dla klienta - bez logowania e-mailem. Otwiera tylko ten
              panel. Wyłączony link przestaje działać od razu, także na otwartych urządzeniach.
            </p>
          </div>
          <ShareLinkCreator clientSlug={clientSlug} />
          {links.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line rounded-[20px] bg-chip">
              {links.map((u) => {
                const signedIn = lastSignIn.get(u.id);
                return (
                  <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium">
                        Link z {formatDateWarsaw(u.created_at, "d MMM yyyy, HH:mm")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {signedIn
                          ? `ostatnio otwarty ${formatDateWarsaw(signedIn, "d MMM yyyy, HH:mm")}`
                          : "jeszcze nieotwarty"}
                      </span>
                    </div>
                    <form action={revokeShareLink}>
                      <input type="hidden" name="client" value={clientSlug} />
                      <input type="hidden" name="user_id" value={u.id} />
                      <AccessRemoveButton label="Wyłącz link" />
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
