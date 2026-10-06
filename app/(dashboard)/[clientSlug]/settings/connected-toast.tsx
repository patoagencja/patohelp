"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const PROVIDER_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  ga4: "Google Analytics 4",
};

/**
 * Fires a one-time toast based on the ?connected / ?error query params set by
 * the OAuth callback redirects.
 */
export function ConnectedToast({
  connected,
  error,
  saved,
}: {
  connected?: string;
  error?: string;
  saved?: string;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    if (connected) {
      toast.success(`Połączono z ${PROVIDER_LABELS[connected] ?? connected}`);
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
    } else if (error) {
      toast.error(
        `Nie udało się połączyć z ${PROVIDER_LABELS[error] ?? error}. Spróbuj ponownie.`
      );
    } else if (saved === "meta_token") {
      toast.success("Meta połączona tokenem, który nie wygasa - koniec rozłączeń.");
    } else if (saved === "meta_token_expiring") {
      toast.warning(
        "Token zapisany, ale ma datę ważności. Przy generowaniu tokenu System User wybierz „Nigdy”."
      );
    } else if (saved === "goals") {
      toast.success("Zapisano cele miesięczne");
    } else if (saved === "ecommerce") {
      toast.success("Zapisano marżę i cele sprzedaży");
    } else if (saved === "notifications") {
      toast.success("Zapisano ustawienia powiadomień");
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
  }, [connected, error, saved]);

  return null;
}
