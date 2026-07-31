import Anthropic from "@anthropic-ai/sdk";

// AI e-commerce analysis: combines the client's own sales data with market /
// industry seasonality (web-searched) into a structured, Polish narrative.

export interface EcomAnalysis {
  headline: string;
  performance: string; // their revenue/ROAS trend, in words
  peaks: Array<{ label: string; note: string }>; // peaks detected in their data
  seasonality: string; // when the industry usually peaks
  market: string; // market / industry trends (web-searched)
  recommendations: string[]; // actionable
}

export interface DailyPoint {
  date: string;
  revenue: number; // PLN (major unit)
  spend: number; // PLN
  transactions: number;
}

export async function generateEcomAnalysis(
  clientName: string,
  daily: DailyPoint[]
): Promise<EcomAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Compact the series so the prompt stays small but keeps the shape/peaks.
  const series = daily
    .map(
      (d) =>
        `${d.date}: przychód ${Math.round(d.revenue)} zł, wydatki ${Math.round(
          d.spend
        )} zł, transakcje ${d.transactions}`
    )
    .join("\n");
  const totalRev = Math.round(daily.reduce((a, d) => a + d.revenue, 0));
  const totalSpend = Math.round(daily.reduce((a, d) => a + d.spend, 0));

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    system:
      "Jesteś analitykiem e-commerce w polskiej agencji marketingowej (patoagencja). Analizujesz dane sprzedażowe klienta i łączysz je z realiami rynku/branży. Piszesz po polsku, konkretnie, bez lania wody i bez długich myślników.",
    messages: [
      {
        role: "user",
        content: `Klient e-commerce: "${clientName}". Poniżej jego dzienne dane (ostatni okres). Suma przychodu: ${totalRev} zł, suma wydatków reklamowych: ${totalSpend} zł.

DANE DZIENNE:
${series}

ZADANIE:
1) Ustal branżę/kategorię tego sklepu (jeśli trzeba - poszukaj marki w sieci).
2) Wskaż PEAKI w JEGO danych (dni/okresy z wyraźnie wyższą sprzedażą) i co mogło je wywołać.
3) Opisz SEZONOWOŚĆ tej branży w Polsce - kiedy zwykle są szczyty sprzedaży (święta, sezony, wydarzenia) i co się zbliża.
4) Dodaj krótko aktualne TRENDY RYNKOWE dla tej branży (poszukaj w sieci - świeże informacje).
5) Daj 3-5 konkretnych REKOMENDACJI pod nadchodzące szczyty i optymalizację ROAS.

Odpowiedz WYŁĄCZNIE poprawnym JSON (bez markdown):
{"headline":"...","performance":"...","peaks":[{"label":"...","note":"..."}],"seasonality":"...","market":"...","recommendations":["...","..."]}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  try {
    const p = JSON.parse(text.slice(s, e + 1)) as Partial<EcomAnalysis>;
    if (!p.headline || !p.performance) return null;
    return {
      headline: String(p.headline),
      performance: String(p.performance),
      peaks: Array.isArray(p.peaks)
        ? p.peaks
            .filter((x) => x && x.label)
            .map((x) => ({ label: String(x.label), note: String(x.note ?? "") }))
        : [],
      seasonality: String(p.seasonality ?? ""),
      market: String(p.market ?? ""),
      recommendations: Array.isArray(p.recommendations)
        ? p.recommendations.map((x) => String(x))
        : [],
    };
  } catch {
    return null;
  }
}
