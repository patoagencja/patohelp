import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import {
  getUnhealthyIntegrations,
  type ProviderHealth,
} from "@/lib/dashboard/integration-health";

function since(h: ProviderHealth): string {
  if (h.hoursSinceSuccess === null) return "nigdy się nie zsynchronizowało";
  const days = Math.floor(h.hoursSinceSuccess / 24);
  if (days >= 1) return `brak danych od ${days} ${days === 1 ? "dnia" : "dni"}`;
  const hours = Math.max(1, Math.round(h.hoursSinceSuccess));
  return `brak danych od ${hours} godz.`;
}

function advice(h: ProviderHealth, clientSlug: string): React.ReactNode {
  if (h.tokenExpired) {
    return (
      <>
        token wygasł -{" "}
        <Link
          href={`/${clientSlug}/settings`}
          className="font-medium underline underline-offset-2"
        >
          rozłącz i połącz ponownie w Ustawieniach
        </Link>
        .
      </>
    );
  }
  return (
    <>
      sprawdź połączenie w{" "}
      <Link
        href={`/${clientSlug}/settings`}
        className="font-medium underline underline-offset-2"
      >
        Ustawieniach
      </Link>
      .
    </>
  );
}

/**
 * Warns when a configured integration has stopped delivering data. The header's
 * "Zaktualizowano X temu" shows the newest success across ALL providers, so one
 * dead source stays invisible there - this names it explicitly instead.
 */
export async function IntegrationHealthBanner({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const unhealthy = await getUnhealthyIntegrations(clientId);
  if (!unhealthy.length) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 print:hidden">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {unhealthy.length === 1
              ? "Jedno źródło danych nie działa"
              : `${unhealthy.length} źródła danych nie działają`}{" "}
            - liczby poniżej są niepełne.
          </p>
          <ul className="mt-1 space-y-0.5 text-amber-800 dark:text-amber-300/90">
            {unhealthy.map((h) => (
              <li key={h.provider}>
                <span className="font-medium">{h.label}</span>: {since(h)},{" "}
                {advice(h, clientSlug)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
