import Anthropic from "@anthropic-ai/sdk";

import type { DashboardData } from "@/lib/dashboard/metrics";
import type { WebsiteData } from "@/lib/dashboard/ga4-metrics";

// Hard-coding one client here meant every other client's report was written
// as if they were a non-ecom door manufacturer.
function systemPrompt(clientName: string, isShop: boolean): string {
  const kind = isShop
    ? `Klient to sklep internetowy ${clientName} - liczy się sprzedaż i to, ile sprzedaży przynoszą reklamy.`
    : `Klient to firma ${clientName} - nie sprzedaje online, mierzymy ruch, zasięg i zainteresowanie. Nigdy nie pisz o zwrocie z reklam, przychodzie ani sprzedaży.`;
  return `Jesteś strategiem marketingu przygotowującym raport okresowy dla klienta agencji patoagencja.
${kind}
Napisz zwięzły raport po polsku (3 krótkie akapity):
1. Podsumowanie okresu - najważniejsze liczby (wydatki, kliknięcia, klikalność, koszt kliknięcia, wizyty na stronie) i zmiana względem poprzedniego okresu.
2. Co się wyróżniło - najlepsze/najsłabsze kampanie, skąd przyszedł ruch.
3. Rekomendacje - 2-3 konkretne rzeczy do rozważenia w kolejnym okresie.
Pisz dla odbiorcy bez wiedzy marketingowej (zarząd): zamiast CTR - "klikalność", zamiast CPC - "koszt kliknięcia", zamiast sesji/GA4 - "wizyty na stronie", bez innych skrótów i angielskich terminów. Kwoty w pełnych złotych.
Ton: profesjonalny, konkretny. Bez emoji, bez markdown, bez nagłówków - czysty tekst z akapitami oddzielonymi pustą linią.`;
}

const pln = (minor: number) => `${(minor / 100).toFixed(2)} PLN`;
const pct = (v: number) => `${v.toFixed(2)}%`;
const delta = (d: number | null) =>
  d === null ? "brak danych porównawczych" : `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;

/**
 * Generate a Polish period report narrative from already-computed dashboard
 * data (no extra DB round-trips). Used by the on-demand report generator.
 */
export async function generatePeriodReport(
  clientName: string,
  data: DashboardData,
  website: WebsiteData | null,
  isShop = false
): Promise<string> {
  const k = data.kpis;

  const topCampaigns = [...data.campaigns]
    .sort((a, b) => b.spendMinorUnits - a.spendMinorUnits)
    .slice(0, 5)
    .map(
      (c) =>
        `- ${c.name} [${
          c.provider === "meta_ads" ? "Meta" : c.provider === "tiktok_ads" ? "TikTok" : "Google"
        }]: ${pln(
          c.spendMinorUnits
        )}, ${c.clicks} kliknięć, CTR ${pct(c.ctr)}`
    );

  const sources =
    website && website.hasData
      ? website.sources
          .sort((a, b) => b.sessions - a.sessions)
          .map((s) => `- ${s.category}: ${s.sessions} sesji`)
      : ["- brak danych GA4"];

  const context = [
    `KLIENT: ${clientName}`,
    `OKRES: ${data.rangeLabel} (${data.rangeStart} - ${data.rangeEnd})`,
    "",
    "METRYKI (wartość, zmiana vs poprzedni okres):",
    `- Wydatki: ${pln(k.spendMinorUnits.value)} (${delta(k.spendMinorUnits.deltaPercent)})`,
    `- Kliknięcia: ${k.clicks.value} (${delta(k.clicks.deltaPercent)})`,
    `- CTR: ${pct(k.ctr.value)} (${delta(k.ctr.deltaPercent)})`,
    `- CPC: ${pln(k.cpcMinorUnits.value)} (${delta(k.cpcMinorUnits.deltaPercent)})`,
    k.sessions.value > 0
      ? `- Sesje GA4: ${k.sessions.value} (${delta(k.sessions.deltaPercent)})`
      : `- Sesje GA4: brak danych`,
    "",
    "TOP 5 KAMPANII (wg wydatków):",
    ...topCampaigns,
    "",
    // The source breakdown is GA4's rolling 30-day snapshot, whatever the
    // report period - say so, or the model presents it as the period's split.
    "ŹRÓDŁA RUCHU (GA4, ostatnie 30 dni - nie ten sam okres co metryki wyżej):",
    ...sources,
  ].join("\n");

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 900,
    system: systemPrompt(clientName, isShop),
    messages: [
      {
        role: "user",
        content: `Przygotuj raport okresowy na podstawie danych:\n\n${context}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text.trim() ?? "";
  if (!text) throw new Error("Empty report from model");
  return text;
}
