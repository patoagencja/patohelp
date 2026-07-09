import Anthropic from "@anthropic-ai/sdk";

import type { DashboardData } from "@/lib/dashboard/metrics";
import type { WebsiteData } from "@/lib/dashboard/ga4-metrics";

const SYSTEM_PROMPT = `Jesteś strategiem performance marketingu przygotowującym raport okresowy dla klienta agencji Pato.
Klient to firma DRE (producent drzwi, non-ecom - mierzymy ruch, zasięg i engagement, NIE sprzedaż. Nigdy nie pisz o ROAS, przychodzie ani konwersjach sprzedażowych).
Napisz zwięzły raport po polsku (3 krótkie akapity):
1. Podsumowanie okresu - najważniejsze liczby (wydatki, kliknięcia, CTR, CPC, sesje) i zmiana względem poprzedniego okresu.
2. Co się wyróżniło - najlepsze/najsłabsze kampanie, skąd przyszedł ruch.
3. Rekomendacje - 2-3 konkretne rzeczy do rozważenia w kolejnym okresie.
Ton: profesjonalny, konkretny, dla odbiorcy biznesowego (klient wyśle to swojemu zespołowi). Bez emoji, bez markdown, bez nagłówków - czysty tekst z akapitami oddzielonymi pustą linią.`;

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
  website: WebsiteData | null
): Promise<string> {
  const k = data.kpis;

  const topCampaigns = [...data.campaigns]
    .sort((a, b) => b.spendMinorUnits - a.spendMinorUnits)
    .slice(0, 5)
    .map(
      (c) =>
        `- ${c.name} [${c.provider === "meta_ads" ? "Meta" : "Google"}]: ${pln(
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
    "ŹRÓDŁA RUCHU (GA4):",
    ...sources,
  ].join("\n");

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 900,
    system: SYSTEM_PROMPT,
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
