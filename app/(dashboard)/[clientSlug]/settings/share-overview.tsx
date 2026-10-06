import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateWarsaw } from "@/lib/utils";

import { createOverviewShareLink, revokeOverviewShareLink } from "./share-actions";
import { ShareCopyButton } from "./share-copy-button";

interface OverviewLinkRow {
  token: string;
  created_at: string;
  expires_at: string | null;
  last_viewed_at: string | null;
}

/**
 * "Link dla zarządu": agency-only management of read-only overview links
 * (/s/<token>) the client's marketing manager can forward to their board.
 * Rendered only inside the settings page, which already requires
 * requireAgencyClientAccess; the actions re-check it on every call.
 */
export async function ShareOverviewSection({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  // share_links has RLS with no policies (tokens are credentials) - admin read.
  const { data, error } = await createAdminClient()
    .from("share_links")
    .select("token, created_at, expires_at, last_viewed_at")
    .eq("client_id", clientId)
    .eq("kind", "overview")
    .eq("revoked", false)
    .order("created_at", { ascending: false });

  const now = Date.now();
  const links = ((data ?? []) as OverviewLinkRow[]).filter(
    (l) => !l.expires_at || new Date(l.expires_at).getTime() > now
  );
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <div id="udostepnianie" className="scroll-mt-32 space-y-4">
      <SectionHeader
        title="Link dla zarządu"
        description="Podgląd przeglądu tylko do odczytu, bez logowania - do wysłania np. zarządowi klienta. Bez ustawień, alertów i budżetów; każdy link można w każdej chwili unieważnić."
      />

      <Card className="max-w-2xl">
        <CardContent className="flex flex-col gap-5 pt-6">
          {error ? (
            <p className="text-sm text-muted-foreground">
              Uruchom w Supabase migrację{" "}
              <code className="rounded bg-muted px-1">0026_share_overview.sql</code>,
              żeby włączyć linki dla zarządu.
            </p>
          ) : (
            <>
              <form
                action={createOverviewShareLink}
                className="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="client" value={clientSlug} />
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Ważność linku</span>
                  <select
                    name="expiry"
                    defaultValue="30"
                    className="h-9 rounded-xl border border-transparent bg-muted transition-shadow hover:bg-secondary focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-muted px-3 text-sm"
                  >
                    <option value="7">7 dni</option>
                    <option value="30">30 dni</option>
                    <option value="none">Bez limitu</option>
                  </select>
                </label>
                <Button type="submit" size="sm">
                  Utwórz link
                </Button>
              </form>

              {links.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Brak aktywnych linków.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border rounded-2xl bg-muted/50">
                  {links.map((l) => {
                    const url = `${base}/s/${l.token}`;
                    return (
                      <li key={l.token} className="flex flex-col gap-2 p-3">
                        <input
                          readOnly
                          value={url}
                          aria-label="Link dla zarządu"
                          className="h-9 min-w-0 rounded-full border border-transparent bg-card px-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-secondary"
                        />
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                          <span>
                            Utworzono {formatDateWarsaw(l.created_at, "d MMM yyyy, HH:mm")}
                          </span>
                          <span>
                            {l.expires_at
                              ? `Wygasa ${formatDateWarsaw(l.expires_at, "d MMM yyyy, HH:mm")}`
                              : "Bez daty ważności"}
                          </span>
                          <span>
                            {l.last_viewed_at
                              ? `Ostatnio otwarty ${formatDateWarsaw(l.last_viewed_at, "d MMM yyyy, HH:mm")}`
                              : "Jeszcze nieotwarty"}
                          </span>
                          <span className="flex-1" />
                          <ShareCopyButton url={url} />
                          <form action={revokeOverviewShareLink}>
                            <input type="hidden" name="client" value={clientSlug} />
                            <input type="hidden" name="token" value={l.token} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-negative-soft hover:text-destructive"
                            >
                              Unieważnij
                            </Button>
                          </form>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
