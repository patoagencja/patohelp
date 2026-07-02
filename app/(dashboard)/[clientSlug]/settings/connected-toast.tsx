"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const PROVIDER_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
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
    } else if (error) {
      toast.error(
        `Nie udało się połączyć z ${PROVIDER_LABELS[error] ?? error}. Spróbuj ponownie.`
      );
    } else if (saved) {
      toast.success(
        `Zapisano wybór kont dla ${PROVIDER_LABELS[saved] ?? saved}`
      );
    }
  }, [connected, error, saved]);

  return null;
}
