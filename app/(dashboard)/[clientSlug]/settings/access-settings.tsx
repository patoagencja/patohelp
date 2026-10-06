import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateWarsaw } from "@/lib/utils";

import {
  cancelClientInvitation,
  inviteClientUser,
  removeClientUserAccess,
} from "./access-actions";
import { AccessRemoveButton } from "./access-remove-button";

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

  const users = (usersRes.data ?? []) as AccessUserRow[];
  const userEmails = new Set(users.map((u) => u.email.toLowerCase()));
  // An invitation whose person already shows up above is just the mapping
  // record, not something still waiting.
  const pending = ((invitesRes.data ?? []) as InvitationRow[]).filter(
    (i) => !userEmails.has(i.email.toLowerCase())
  );

  // inviteUserByEmail creates the account before the person ever clicks the
  // link, so "has a row" doesn't mean "has logged in" - show the difference.
  const lastSignIn = new Map<string, string | null>();
  await Promise.all(
    users.slice(0, SIGN_IN_LOOKUP_LIMIT).map(async (u) => {
      const { data } = await admin.auth.admin.getUserById(u.id);
      if (data?.user) lastSignIn.set(u.id, data.user.last_sign_in_at ?? null);
    })
  );

  return (
    <div id="dostep" className="mt-8 scroll-mt-6">
      <h2 className="text-lg font-semibold">Dostęp do panelu</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Klient loguje się linkiem z e-maila - bez hasła. Widzi tylko swój panel.
      </p>

      <Card className="mt-4 max-w-2xl">
        <CardContent className="flex flex-col gap-5 pt-6">
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
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </label>
                <Button type="submit" size="sm">
                  Nadaj dostęp
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="send_email"
                  defaultChecked
                  className="h-4 w-4 rounded border-input"
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
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
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
    </div>
  );
}
