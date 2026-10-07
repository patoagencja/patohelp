"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { SYNC_CHECK_EVENT } from "@/components/dashboard/auto-refresh";
import { fixedOthersLabel } from "@/lib/integrations/fixed-label";

const PROVIDER_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  ga4: "Google Analytics 4",
};

/** Saves that put fresh credentials in place - data should follow at once.
 *  Account/property picks (saved=<provider>) count too: new accounts. */
const FRESH_CREDENTIALS = new Set([
  "meta_token",
  "meta_token_expiring",
  "ga4_service_account",
]);

/**
 * Fires a one-time toast based on the ?connected / ?error query params set by
 * the OAuth callback redirects. After new credentials it also pulls the data
 * right away: waiting for the next cron left the "token wygasł" banner and
 * empty charts up for half an hour after a successful reconnect.
 */
export function ConnectedToast({
  clientSlug,
  connected,
  error,
  saved,
  fixed,
}: {
  clientSlug: string;
  connected?: string;
  error?: string;
  saved?: string;
  /** Other clients' connections repaired with the same new token. */
  fixed?: string;
}) {
  const fired = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // Detail params of the shop CSV upload, read here rather than threaded
    // through the page's props.
    const params = new URLSearchParams(window.location.search);
    const rowsParam = params.get("rows");
    const msgParam = params.get("msg");

    // Drop the one-shot params so a reload doesn't repeat the toast and sync.
    if (connected || error || saved) {
      const url = new URL(window.location.href);
      for (const k of ["connected", "error", "saved", "fixed", "rows", "msg"]) url.searchParams.delete(k);
      window.history.replaceState(window.history.state, "", url);
    }

    // "Napraw wszystkie naraz": the same new login was verified on, and
    // applied to, other clients that broke with it.
    const fixedCount = Number(fixed);
    const fixedNote =
      Number.isFinite(fixedCount) && fixedCount > 0 ? fixedOthersLabel(fixedCount) : null;

    if (connected) {
      toast.success(`Połączono z ${PROVIDER_LABELS[connected] ?? connected}`, {
        description: fixedNote ?? undefined,
      });
    } else if (error === "meta_token_invalid") {
      toast.error(
        "Meta odrzuciła ten token. Sprawdź, czy skopiowałeś cały token System User i czy ma uprawnienie ads_read."
      );
    } else if (error === "meta_token_empty") {
      toast.error("Wklej token, zanim zapiszesz.");
    } else if (error === "access_email") {
      toast.error("Ten adres e-mail wygląda na niepoprawny - sprawdź literówki.");
    } else if (error === "access_agency") {
      toast.error(
        "To konto agencji - jego dostępu nie zmienia się w ustawieniach klienta."
      );
    } else if (error === "access_other_client") {
      toast.error(
        "Ten adres ma już dostęp do innego klienta - najpierw odbierz tam dostęp."
      );
    } else if (error === "access_failed") {
      toast.error("Nie udało się zmienić dostępu. Odśwież stronę i spróbuj ponownie.");
    } else if (error === "season_migration") {
      toast.warning(
        "Typ klienta zapisany, ale sezon nie - w bazie brakuje kolumny. Uruchom supabase/migrations/ALL_RECENT_7.sql w Supabase SQL Editor."
      );
    } else if (error === "season_type_migration") {
      toast.error(
        "W bazie brakuje kolumny typu klienta. Uruchom supabase/migrations/0016_ecommerce.sql w Supabase SQL Editor."
      );
    } else if (error === "season_same_day") {
      toast.error("Początek i koniec sezonu muszą być różnymi dniami.");
    } else if (error === "season_bad_date") {
      toast.error("Taki dzień nie istnieje (np. 31 listopada) - popraw daty sezonu.");
    } else if (error === "season_failed") {
      toast.error("Nie udało się zapisać typu i sezonu. Spróbuj ponownie.");
    } else if (error === "shop_csv") {
      // The message rides in the URL, so anyone could craft one: show only
      // the shapes uploadShopSalesCsv produces, and never a link.
      const ownMessage =
        msgParam &&
        /^(Wiersz \d|Plik |Wybierz |Najpierw |Nie udało )/.test(msgParam) &&
        !/https?:|www\./i.test(msgParam);
      toast.error(ownMessage ? msgParam : "Nie udało się wczytać pliku CSV.", { duration: 15000 });
    } else if (error) {
      toast.error(
        `Nie udało się połączyć z ${PROVIDER_LABELS[error] ?? error}. Spróbuj ponownie.`
      );
    } else if (saved === "meta_token") {
      toast.success("Meta połączona tokenem, który nie wygasa - koniec rozłączeń.", {
        description: fixedNote ?? undefined,
      });
    } else if (saved === "meta_token_shared") {
      toast.success(
        fixedNote
          ? `Token System User zastosowany u innych klientów. ${fixedNote}.`
          : "Ten token nie ma dostępu do kont reklamowych innych klientów - nic nie zmieniono."
      );
    } else if (saved === "meta_token_expiring") {
      toast.warning(
        "Token zapisany, ale ma datę ważności. Przy generowaniu tokenu System User wybierz „Nigdy”.",
        { description: fixedNote ?? undefined }
      );
    } else if (saved === "ga4_service_account") {
      toast.success("GA4 połączone przez konto usługi - to połączenie nie wygasa.");
    } else if (saved === "goals") {
      toast.success("Zapisano cele miesięczne");
    } else if (saved === "ecommerce") {
      toast.success("Zapisano marżę i cele sprzedaży");
    } else if (saved === "season") {
      toast.success("Zapisano typ klienta i sezon");
    } else if (saved === "notifications") {
      toast.success("Zapisano ustawienia powiadomień");
    } else if (saved === "shop_csv") {
      const n = Number(rowsParam) || 0;
      const last = n % 10;
      const word =
        n === 1
          ? "wiersz"
          : last >= 2 && last <= 4 && (n % 100 < 12 || n % 100 > 14)
            ? "wiersze"
            : "wierszy";
      toast.success(`Wczytano sprzedaż z CSV: ${n.toLocaleString("pl-PL")} ${word}`);
    } else if (saved?.startsWith("access")) {
      const loginUrl = `${window.location.origin}/login`;
      if (saved === "access_invited") {
        toast.success("Dostęp nadany - wysłaliśmy e-mail z zaproszeniem.");
      } else if (saved === "access_mail_failed") {
        toast.warning(
          `Zaproszenie zapisane, ale e-mail nie wyszedł - poproś, żeby zalogował(a) się na ${loginUrl}`
        );
      } else if (saved === "access_existing") {
        toast.success(
          `Dostęp nadany. To konto już istnieje - wystarczy zalogować się na ${loginUrl}`
        );
      } else if (saved === "access_removed") {
        toast.success("Dostęp odebrany.");
      } else {
        toast.success(
          `Zaproszenie zapisane - poproś, żeby zalogował(a) się na ${loginUrl}`
        );
      }
    } else if (saved) {
      toast.success(
        `Zapisano wybór kont dla ${PROVIDER_LABELS[saved] ?? saved}`
      );
    }

    if (
      connected ||
      (saved && (FRESH_CREDENTIALS.has(saved) || saved in PROVIDER_LABELS))
    ) {
      toast.loading("Pobieram dane po połączeniu…", { id: "post-connect-sync" });
      fetch(`/api/sync/run?client=${encodeURIComponent(clientSlug)}`, {
        method: "POST",
        cache: "no-store",
      })
        .then((res) => {
          if (!res.ok) throw new Error();
          toast.success("Dane pobrane - brakujące dni są już uzupełniane.", {
            id: "post-connect-sync",
          });
        })
        .catch(() => {
          toast.message("Dane spłyną przy najbliższej synchronizacji (do 30 min).", {
            id: "post-connect-sync",
          });
        })
        .finally(() => {
          window.dispatchEvent(new Event(SYNC_CHECK_EVENT));
          router.refresh();
        });
    }
  }, [clientSlug, connected, error, saved, fixed, router]);

  return null;
}
