import type { DashboardData } from "@/lib/dashboard/metrics";
import { formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

export const CHAT_SYSTEM_PROMPT = `Jesteś asystentem AI w dashboardzie marketingowym agencji Pato. Pomagasz klientowi zrozumieć jego kampanie reklamowe (Meta Ads i Google Ads). Odpowiadasz po polsku — zwięźle, rzeczowo, konkretnie.

Zasady:
- Opieraj się WYŁĄCZNIE na danych z sekcji "DANE KAMPANII" poniżej. Nie zmyślaj żadnych liczb.
- To klient typu engagement/traffic — NIE mów o ROAS ani przychodach ze sprzedaży (nie mamy takich danych). Skupiaj się na wydatkach, kliknięciach, CTR, statusach kampanii.
- Jeśli pytanie wykracza poza dostępne dane, powiedz to wprost zamiast zgadywać.
- Kwoty podawaj w PLN. Unikaj marketingowego bełkotu i ogólników.
- Gdy to pomocne, wskaż konkretne kampanie po nazwie.`;

/** Compact, model-readable snapshot of the client's current ad data. */
export function buildDashboardContext(
  clientName: string,
  data: DashboardData
): string {
  const k = data.kpis;
  const statusPl: Record<string, string> = {
    active: "aktywna",
    paused: "wstrzymana",
    off: "nieaktywna",
  };
  const providerPl: Record<string, string> = {
    meta_ads: "Meta",
    google_ads: "Google",
  };

  const lines: string[] = [
    `Klient: ${clientName}`,
    "",
    "PODSUMOWANIE (bieżący miesiąc vs poprzedni):",
    `- Wydatki: ${formatMoneyPLN(k.spendMinorUnits.value)} (poprzedni: ${formatMoneyPLN(k.spendMinorUnits.previous)})`,
    `- Kliknięcia: ${formatNumberPL(k.clicks.value)} (poprzedni: ${formatNumberPL(k.clicks.previous)})`,
    `- Średni CTR: ${formatPercent(k.ctr.value)} (poprzedni: ${formatPercent(k.ctr.previous)})`,
    "",
    `KAMPANIE (bieżący miesiąc, ${data.campaigns.length} szt.):`,
  ];

  for (const c of data.campaigns.slice(0, 50)) {
    lines.push(
      `- ${c.name} [${providerPl[c.provider]}, ${statusPl[c.status]}]: ` +
        `wydatki ${formatMoneyPLN(c.spendMinorUnits)}, ` +
        `kliknięcia ${formatNumberPL(c.clicks)}, CTR ${formatPercent(c.ctr)}`
    );
  }

  return lines.join("\n");
}
